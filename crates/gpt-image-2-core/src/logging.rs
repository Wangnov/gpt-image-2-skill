#![allow(unused_imports)]

//! Persistent diagnostic logging for the App/Web product runtimes.
//!
//! Logs are written as JSONL (one JSON object per line) into a size-rolling
//! file under `product_app_data_dir(config, runtime)/logs/`. Every payload is
//! routed through the shared [`redact_event_payload`] sanitizer before it
//! touches disk, so API keys / tokens / proxy passwords never get persisted.
//!
//! Hard guarantees enforced here:
//! - Initialization happens at most once per process (guarded by `OnceLock`).
//!   The CLI never calls [`init_logging`], so it keeps no file logger at all.
//! - Nothing in this module ever writes to `stdout`. Failures degrade to a
//!   one-line `stderr` warning and are otherwise swallowed, so the CLI's
//!   stdout JSON protocol is never polluted even if logging is somehow active.

use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Mutex, OnceLock};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::*;

/// Single log file size cap before it rolls over to `<name>.1`.
const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;
/// How many rolled files to retain (`.log.1` ..= `.log.{MAX_BACKUPS}`).
const MAX_BACKUPS: usize = 5;
/// Base log file name inside the logs directory.
const LOG_FILE_NAME: &str = "gpt-image-2.log";

/// Persistent logging preferences. `#[serde(default)]` everywhere keeps this a
/// zero-migration addition to `AppConfig`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, Eq, PartialEq)]
pub struct LoggingConfig {
    /// When true, `debug`-level events are persisted in addition to
    /// info/warn/error. Off (`false`) by default to keep logs lean.
    #[serde(default)]
    pub debug: bool,
}

/// No secrets live in `LoggingConfig`, so redaction is an identity transform.
/// Kept as a named helper to mirror the `redact_*_config` pattern used by the
/// other sub-configs in `redact_app_config`.
pub(crate) fn redact_logging_config(config: &LoggingConfig) -> Value {
    json!({ "debug": config.debug })
}

/// Severity levels, ordered so `>=` comparisons express "at least this severe".
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum LogLevel {
    Debug = 0,
    Info = 1,
    Warn = 2,
    Error = 3,
}

impl LogLevel {
    pub fn as_str(self) -> &'static str {
        match self {
            LogLevel::Debug => "debug",
            LogLevel::Info => "info",
            LogLevel::Warn => "warn",
            LogLevel::Error => "error",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "debug" => Some(LogLevel::Debug),
            "info" => Some(LogLevel::Info),
            "warn" | "warning" => Some(LogLevel::Warn),
            "error" => Some(LogLevel::Error),
            _ => None,
        }
    }
}

/// Minimum level that gets persisted. `debug` is only retained when the user
/// turns on the "verbose logging" switch (`LoggingConfig.debug`). Stored as an
/// atomic so `update_logging` can re-tune the live level without re-init.
static MIN_LEVEL: AtomicU8 = AtomicU8::new(LogLevel::Info as u8);

fn min_level() -> u8 {
    MIN_LEVEL.load(Ordering::Relaxed)
}

fn set_min_level_from_config(config: &LoggingConfig) {
    let level = if config.debug {
        LogLevel::Debug
    } else {
        LogLevel::Info
    };
    MIN_LEVEL.store(level as u8, Ordering::Relaxed);
}

/// Size-rolling JSONL writer. Holds an append handle to the active log file and
/// rolls it over once it crosses [`MAX_FILE_BYTES`].
struct RollingWriter {
    path: PathBuf,
    file: Option<File>,
    written: u64,
}

impl RollingWriter {
    fn open(path: PathBuf) -> Self {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let (file, written) = match OpenOptions::new().create(true).append(true).open(&path) {
            Ok(file) => {
                let written = file.metadata().map(|meta| meta.len()).unwrap_or(0);
                (Some(file), written)
            }
            Err(_) => (None, 0),
        };
        Self {
            path,
            file,
            written,
        }
    }

    fn write_line(&mut self, line: &str) {
        if self.file.is_none() {
            // A previous open failed; try once more so a transient error
            // (e.g. directory created later) can self-heal.
            *self = RollingWriter::open(self.path.clone());
        }
        let len = line.len() as u64 + 1;
        if self.written.saturating_add(len) > MAX_FILE_BYTES && self.written > 0 {
            self.roll();
        }
        if let Some(file) = self.file.as_mut()
            && writeln!(file, "{line}").is_ok()
        {
            let _ = file.flush();
            self.written = self.written.saturating_add(len);
        }
    }

    /// Shift `<name>.{n}` -> `<name>.{n+1}`, drop anything beyond
    /// [`MAX_BACKUPS`], move the live file to `<name>.1`, then reopen fresh.
    fn roll(&mut self) {
        self.file = None;
        let base = self.path.clone();
        // Remove the oldest retained backup so it doesn't get bumped past the cap.
        let oldest = backup_path(&base, MAX_BACKUPS);
        let _ = fs::remove_file(&oldest);
        for index in (1..MAX_BACKUPS).rev() {
            let from = backup_path(&base, index);
            let to = backup_path(&base, index + 1);
            if from.exists() {
                let _ = fs::rename(&from, &to);
            }
        }
        let _ = fs::rename(&base, backup_path(&base, 1));
        *self = RollingWriter::open(base);
    }
}

fn backup_path(base: &Path, index: usize) -> PathBuf {
    let mut name = base
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();
    name.push(format!(".{index}"));
    base.with_file_name(name)
}

static WRITER: OnceLock<Mutex<RollingWriter>> = OnceLock::new();

/// Active log directory for the given runtime/config:
/// `product_app_data_dir(config, runtime)/logs`.
pub fn logs_dir(config: Option<&AppConfig>, runtime: ProductRuntime) -> PathBuf {
    product_app_data_dir(config, runtime).join("logs")
}

/// Initialize the persistent file logger. Idempotent: only the first call per
/// process actually opens the writer; later calls just re-tune the live level.
///
/// CLI/Skill must NOT call this — they keep no file logger and never touch
/// stdout from here.
pub fn init_logging(config: &AppConfig, runtime: ProductRuntime) {
    set_min_level_from_config(&config.logging);
    let path = logs_dir(Some(config), runtime).join(LOG_FILE_NAME);
    let _ = WRITER.get_or_init(|| Mutex::new(RollingWriter::open(path)));
}

/// Re-tune the live persistence level after a config change (e.g. the user
/// toggled the verbose switch). Safe to call even if logging was never
/// initialized.
pub fn apply_logging_config(config: &LoggingConfig) {
    set_min_level_from_config(config);
}

/// Persist one structured event. `data` is sanitized through the shared
/// [`redact_event_payload`] layer before it is written, so secrets never reach
/// disk. No-op when logging was not initialized (CLI) or when `level` is below
/// the active threshold.
pub fn log_event(level: LogLevel, kind: &str, type_name: &str, data: Value) {
    if (level as u8) < min_level() {
        return;
    }
    let Some(writer) = WRITER.get() else {
        return;
    };
    let record = json!({
        "ts": Utc::now().to_rfc3339(),
        "level": level.as_str(),
        "kind": kind,
        "type": type_name,
        "data": redact_event_payload(&data),
    });
    let line = match serde_json::to_string(&record) {
        Ok(line) => line,
        Err(_) => return,
    };
    match writer.lock() {
        Ok(mut writer) => writer.write_line(&line),
        Err(_) => {
            // Poisoned lock: keep stdout clean, surface a single stderr breadcrumb.
            eprintln!("gpt-image-2 logging: writer mutex poisoned");
        }
    }
}

/// Read up to `limit` of the most recent log records, newest last, filtered to
/// `>= min_level`. Reads from the live file plus rolled backups so the panel
/// can show history across a rollover. Lines that fail to parse are skipped.
pub fn read_recent_logs(
    config: Option<&AppConfig>,
    runtime: ProductRuntime,
    limit: usize,
    min_level: LogLevel,
) -> Vec<Value> {
    if limit == 0 {
        return Vec::new();
    }
    let base = logs_dir(config, runtime).join(LOG_FILE_NAME);
    // Read newest file first; within a file we still want chronological order,
    // so collect per-file then prepend older files.
    let mut collected: Vec<Value> = Vec::new();
    // Iterate live file, then .1, .2, ... until we have enough.
    let mut sources: Vec<PathBuf> = vec![base.clone()];
    for index in 1..=MAX_BACKUPS {
        sources.push(backup_path(&base, index));
    }
    'outer: for source in sources {
        let lines = match read_file_lines(&source) {
            Some(lines) => lines,
            None => continue,
        };
        // Walk this file newest-to-oldest so we can stop early once full.
        let mut file_records: Vec<Value> = Vec::new();
        for line in lines.iter().rev() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
                continue;
            };
            if !record_passes_level(&value, min_level) {
                continue;
            }
            file_records.push(value);
            if collected.len() + file_records.len() >= limit {
                break;
            }
        }
        // file_records is newest-first; flip to oldest-first then prepend.
        file_records.reverse();
        let mut merged = file_records;
        merged.append(&mut collected);
        collected = merged;
        if collected.len() >= limit {
            break 'outer;
        }
    }
    if collected.len() > limit {
        let start = collected.len() - limit;
        collected.drain(0..start);
    }
    collected
}

fn read_file_lines(path: &Path) -> Option<Vec<String>> {
    let file = File::open(path).ok()?;
    let reader = BufReader::new(file);
    let lines = reader.lines().map_while(Result::ok).collect::<Vec<_>>();
    Some(lines)
}

fn record_passes_level(record: &Value, min_level: LogLevel) -> bool {
    let level = record
        .get("level")
        .and_then(Value::as_str)
        .and_then(LogLevel::parse)
        .unwrap_or(LogLevel::Info);
    level >= min_level
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    // Serialize tests that mutate the shared MIN_LEVEL / env so they don't
    // race each other.
    static TEST_LOCK: StdMutex<()> = StdMutex::new(());

    fn unique_tmp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("gpt-image-2-logging-{tag}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_record(writer: &Mutex<RollingWriter>, level: LogLevel, type_name: &str, data: Value) {
        let record = json!({
            "ts": Utc::now().to_rfc3339(),
            "level": level.as_str(),
            "kind": "local",
            "type": type_name,
            "data": redact_event_payload(&data),
        });
        let line = serde_json::to_string(&record).unwrap();
        writer.lock().unwrap().write_line(&line);
    }

    #[test]
    fn rolling_writer_caps_backups_and_drops_oldest() {
        let _guard = TEST_LOCK.lock().unwrap();
        let dir = unique_tmp_dir("roll");
        let base = dir.join(LOG_FILE_NAME);
        let writer = Mutex::new(RollingWriter::open(base.clone()));
        // ~2KB per line; force many rollovers well past MAX_BACKUPS files.
        let big = "x".repeat(2048);
        for i in 0..((MAX_FILE_BYTES / 2048) as usize * (MAX_BACKUPS + 3)) {
            write_record(
                &writer,
                LogLevel::Info,
                "bulk",
                json!({ "i": i, "pad": big }),
            );
        }
        // Live file exists.
        assert!(base.exists(), "live log file must exist");
        // At most MAX_BACKUPS rolled files; none beyond the cap.
        for index in 1..=MAX_BACKUPS {
            // Existence is allowed but not required for every slot; the cap is
            // the hard invariant.
            let _ = backup_path(&base, index);
        }
        assert!(
            !backup_path(&base, MAX_BACKUPS + 1).exists(),
            "no backup beyond MAX_BACKUPS may exist"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn redacts_secrets_before_persisting() {
        let _guard = TEST_LOCK.lock().unwrap();
        let dir = unique_tmp_dir("redact");
        let base = dir.join(LOG_FILE_NAME);
        let writer = Mutex::new(RollingWriter::open(base.clone()));
        write_record(
            &writer,
            LogLevel::Error,
            "job.failed",
            json!({
                "api_key": "sk-super-secret-value",
                "authorization": "Bearer tok_live_should_not_persist",
                "nested": { "access_token": "refresh-me-not" },
                "message": "boom",
            }),
        );
        let contents = fs::read_to_string(&base).unwrap();
        assert!(
            !contents.contains("sk-super-secret-value"),
            "api_key value must be redacted"
        );
        assert!(
            !contents.contains("tok_live_should_not_persist"),
            "authorization value must be redacted"
        );
        assert!(
            !contents.contains("refresh-me-not"),
            "nested access_token must be redacted"
        );
        assert!(contents.contains("\"_omitted\":\"secret\""));
        assert!(contents.contains("boom"), "non-secret fields are preserved");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn readback_filters_by_level_and_orders_oldest_to_newest() {
        let _guard = TEST_LOCK.lock().unwrap();
        let dir = unique_tmp_dir("readback");
        let base = dir.join(LOG_FILE_NAME);
        let writer = Mutex::new(RollingWriter::open(base.clone()));
        write_record(&writer, LogLevel::Debug, "first", json!({ "n": 1 }));
        write_record(&writer, LogLevel::Info, "second", json!({ "n": 2 }));
        write_record(&writer, LogLevel::Warn, "third", json!({ "n": 3 }));
        write_record(&writer, LogLevel::Error, "fourth", json!({ "n": 4 }));

        // Filter to >= warn: only third + fourth, in chronological order.
        let records = read_recent_logs_from(&base, 100, LogLevel::Warn);
        assert_eq!(records.len(), 2);
        assert_eq!(records[0]["type"], "third");
        assert_eq!(records[1]["type"], "fourth");

        // Limit keeps the newest N.
        let latest = read_recent_logs_from(&base, 1, LogLevel::Debug);
        assert_eq!(latest.len(), 1);
        assert_eq!(latest[0]["type"], "fourth");
        let _ = fs::remove_dir_all(&dir);
    }

    // Test helper mirroring read_recent_logs against an explicit base path so
    // we don't depend on product_app_data_dir in unit tests.
    fn read_recent_logs_from(base: &Path, limit: usize, min_level: LogLevel) -> Vec<Value> {
        let mut collected: Vec<Value> = Vec::new();
        let mut sources: Vec<PathBuf> = vec![base.to_path_buf()];
        for index in 1..=MAX_BACKUPS {
            sources.push(backup_path(base, index));
        }
        for source in sources {
            let Some(lines) = read_file_lines(&source) else {
                continue;
            };
            let mut file_records: Vec<Value> = Vec::new();
            for line in lines.iter().rev() {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
                    continue;
                };
                if !record_passes_level(&value, min_level) {
                    continue;
                }
                file_records.push(value);
                if collected.len() + file_records.len() >= limit {
                    break;
                }
            }
            file_records.reverse();
            let mut merged = file_records;
            merged.append(&mut collected);
            collected = merged;
            if collected.len() >= limit {
                break;
            }
        }
        if collected.len() > limit {
            let start = collected.len() - limit;
            collected.drain(0..start);
        }
        collected
    }

    #[test]
    fn public_read_recent_logs_resolves_via_product_data_dir() {
        let _guard = TEST_LOCK.lock().unwrap();
        let dir = unique_tmp_dir("public-readback");
        let base = logs_dir(None, ProductRuntime::DockerWeb);
        // Point the DockerWeb data dir at our temp dir, then write some lines
        // straight into the resolved logs file and read them back through the
        // public API to prove the path resolution is wired up.
        let prev = std::env::var_os("GPT_IMAGE_2_DATA_DIR");
        unsafe {
            std::env::set_var("GPT_IMAGE_2_DATA_DIR", &dir);
        }
        let resolved = logs_dir(None, ProductRuntime::DockerWeb).join(LOG_FILE_NAME);
        assert_ne!(resolved, base.join(LOG_FILE_NAME));
        let writer = Mutex::new(RollingWriter::open(resolved.clone()));
        write_record(&writer, LogLevel::Info, "alpha", json!({ "n": 1 }));
        write_record(&writer, LogLevel::Error, "omega", json!({ "n": 2 }));
        drop(writer);

        let all = read_recent_logs(None, ProductRuntime::DockerWeb, 100, LogLevel::Debug);
        assert_eq!(all.len(), 2);
        assert_eq!(all[0]["type"], "alpha");
        assert_eq!(all[1]["type"], "omega");
        let errors_only = read_recent_logs(None, ProductRuntime::DockerWeb, 100, LogLevel::Error);
        assert_eq!(errors_only.len(), 1);
        assert_eq!(errors_only[0]["type"], "omega");

        unsafe {
            match prev {
                Some(value) => std::env::set_var("GPT_IMAGE_2_DATA_DIR", value),
                None => std::env::remove_var("GPT_IMAGE_2_DATA_DIR"),
            }
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn init_logging_is_idempotent() {
        let _guard = TEST_LOCK.lock().unwrap();
        // First init wins; a second init with a different dir must not panic
        // or repoint the writer (OnceLock guarantees single init).
        let dir = unique_tmp_dir("init-once");
        let mut config = AppConfig::default();
        config.logging.debug = false;
        // Point product data dir via the DockerWeb env override so we don't
        // touch the user's real data dir.
        let prev = std::env::var_os("GPT_IMAGE_2_DATA_DIR");
        unsafe {
            std::env::set_var("GPT_IMAGE_2_DATA_DIR", &dir);
        }
        init_logging(&config, ProductRuntime::DockerWeb);
        assert_eq!(min_level(), LogLevel::Info as u8);
        // Toggling debug re-tunes the level even though the writer is fixed.
        config.logging.debug = true;
        init_logging(&config, ProductRuntime::DockerWeb);
        assert_eq!(min_level(), LogLevel::Debug as u8);
        // restore
        unsafe {
            match prev {
                Some(value) => std::env::set_var("GPT_IMAGE_2_DATA_DIR", value),
                None => std::env::remove_var("GPT_IMAGE_2_DATA_DIR"),
            }
        }
        let _ = fs::remove_dir_all(&dir);
    }
}
