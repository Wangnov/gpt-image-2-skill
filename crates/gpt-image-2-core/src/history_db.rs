use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, params};
use serde_json::{Value, json};

use crate::errors::AppError;
use crate::paths::history_db_path;
use crate::util::now_iso;

pub(crate) fn open_history_db() -> Result<Connection, AppError> {
    let path = history_db_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            AppError::new("history_open_failed", "Unable to create history directory.").with_detail(
                json!({"history_file": path.display().to_string(), "error": error.to_string()}),
            )
        })?;
    }
    let conn = Connection::open(&path).map_err(|error| {
        AppError::new("history_open_failed", "Unable to open history database.").with_detail(
            json!({"history_file": path.display().to_string(), "error": error.to_string()}),
        )
    })?;
    conn.busy_timeout(Duration::from_secs(5)).map_err(|error| {
        AppError::new(
            "history_migration_failed",
            "Unable to configure history database busy timeout.",
        )
        .with_detail(json!({"error": error.to_string()}))
    })?;
    conn.pragma_update(None, "journal_mode", "WAL".to_string())
        .map_err(|error| {
            AppError::new(
                "history_migration_failed",
                "Unable to configure history database journal mode.",
            )
            .with_detail(json!({"error": error.to_string()}))
        })?;
    conn.pragma_update(None, "synchronous", "NORMAL".to_string())
        .map_err(|error| {
            AppError::new(
                "history_migration_failed",
                "Unable to configure history database synchronous mode.",
            )
            .with_detail(json!({"error": error.to_string()}))
        })?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            command TEXT NOT NULL,
            provider TEXT NOT NULL,
            status TEXT NOT NULL,
            output_path TEXT,
            created_at TEXT NOT NULL,
            metadata TEXT NOT NULL
        )",
        [],
    )
    .map_err(|error| {
        AppError::new(
            "history_migration_failed",
            "Unable to initialize history database.",
        )
        .with_detail(json!({"error": error.to_string()}))
    })?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_jobs_created_at_id ON jobs (created_at DESC, id DESC)",
        [],
    )
    .map_err(|error| {
        AppError::new(
            "history_migration_failed",
            "Unable to initialize history indexes.",
        )
        .with_detail(json!({"error": error.to_string()}))
    })?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_jobs_status_created_at_id ON jobs (status, created_at DESC, id DESC)",
        [],
    )
    .map_err(|error| {
        AppError::new(
            "history_migration_failed",
            "Unable to initialize history indexes.",
        )
        .with_detail(json!({"error": error.to_string()}))
    })?;
    // Soft-delete migration: add `deleted_at TEXT` column. SQLite returns
    // "duplicate column name" if the column already exists — swallow only
    // that case so the migration is idempotent.
    match conn.execute("ALTER TABLE jobs ADD COLUMN deleted_at TEXT", []) {
        Ok(_) => {}
        Err(rusqlite::Error::SqliteFailure(_, Some(msg)))
            if msg.contains("duplicate column name") => {}
        Err(error) => {
            return Err(AppError::new(
                "history_migration_failed",
                "Unable to add deleted_at column.",
            )
            .with_detail(json!({"error": error.to_string()})));
        }
    }
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_jobs_deleted_at_created_at ON jobs (deleted_at, created_at DESC, id DESC)",
        [],
    )
    .map_err(|error| {
        AppError::new(
            "history_migration_failed",
            "Unable to initialize history indexes.",
        )
        .with_detail(json!({"error": error.to_string()}))
    })?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS output_uploads (
            job_id TEXT NOT NULL,
            output_index INTEGER NOT NULL,
            target TEXT NOT NULL,
            target_type TEXT NOT NULL,
            status TEXT NOT NULL,
            url TEXT,
            error TEXT,
            bytes INTEGER,
            attempts INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL,
            metadata TEXT NOT NULL DEFAULT '{}',
            PRIMARY KEY (job_id, output_index, target),
            FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
        )",
        [],
    )
    .map_err(|error| {
        AppError::new(
            "history_migration_failed",
            "Unable to initialize output upload history.",
        )
        .with_detail(json!({"error": error.to_string()}))
    })?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_output_uploads_job_output ON output_uploads (job_id, output_index)",
        [],
    )
        .map_err(|error| {
        AppError::new(
            "history_migration_failed",
            "Unable to initialize output upload indexes.",
        )
        .with_detail(json!({"error": error.to_string()}))
    })?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS job_events (
            job_id TEXT NOT NULL,
            seq INTEGER NOT NULL,
            kind TEXT NOT NULL,
            event_type TEXT NOT NULL,
            data TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (job_id, seq),
            FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
        )",
        [],
    )
    .map_err(|error| {
        AppError::new(
            "history_migration_failed",
            "Unable to initialize job event history.",
        )
        .with_detail(json!({"error": error.to_string()}))
    })?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_job_events_job_created ON job_events (job_id, created_at)",
        [],
    )
    .map_err(|error| {
        AppError::new(
            "history_migration_failed",
            "Unable to initialize job event indexes.",
        )
        .with_detail(json!({"error": error.to_string()}))
    })?;
    Ok(conn)
}

pub(crate) fn record_history_job(
    command_name: &str,
    provider: &str,
    status: &str,
    output_path: Option<&Path>,
    metadata: Value,
) -> Result<String, AppError> {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let job_id = format!("job-{}-{}", unique, std::process::id());
    upsert_history_job(
        &job_id,
        command_name,
        provider,
        status,
        output_path,
        None,
        metadata,
    )?;
    Ok(job_id)
}

pub fn upsert_history_job(
    job_id: &str,
    command_name: &str,
    provider: &str,
    status: &str,
    output_path: Option<&Path>,
    created_at: Option<&str>,
    metadata: Value,
) -> Result<(), AppError> {
    let conn = open_history_db()?;
    let timestamp = created_at
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(now_iso);
    conn.execute(
        "INSERT INTO jobs (id, command, provider, status, output_path, created_at, metadata)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
            command = excluded.command,
            provider = excluded.provider,
            status = excluded.status,
            output_path = excluded.output_path,
            created_at = excluded.created_at,
            metadata = excluded.metadata",
        params![
            job_id,
            command_name,
            provider,
            status,
            output_path.map(|path| path.display().to_string()),
            timestamp,
            serde_json::to_string(&metadata).unwrap_or_else(|_| "{}".to_string()),
        ],
    )
    .map_err(|error| {
        AppError::new("history_write_failed", "Unable to record history job.")
            .with_detail(json!({"error": error.to_string()}))
    })?;
    Ok(())
}

pub fn delete_history_job(job_id: &str) -> Result<usize, AppError> {
    // This only deletes local SQLite history. Remote Origin/Archive objects
    // referenced by output_uploads stay untouched by design.
    let conn = open_history_db()?;
    conn.execute("DELETE FROM job_events WHERE job_id = ?1", params![job_id])
        .map_err(|error| {
            AppError::new(
                "history_delete_failed",
                "Unable to delete job event history.",
            )
            .with_detail(json!({"error": error.to_string()}))
        })?;
    conn.execute(
        "DELETE FROM output_uploads WHERE job_id = ?1",
        params![job_id],
    )
    .map_err(|error| {
        AppError::new(
            "history_delete_failed",
            "Unable to delete output upload history.",
        )
        .with_detail(json!({"error": error.to_string()}))
    })?;
    conn.execute("DELETE FROM jobs WHERE id = ?1", params![job_id])
        .map_err(|error| {
            AppError::new("history_delete_failed", "Unable to delete history job.")
                .with_detail(json!({"error": error.to_string()}))
        })
}

pub fn append_history_job_event(job_id: &str, event: &Value) -> Result<(), AppError> {
    let seq = event.get("seq").and_then(Value::as_u64).unwrap_or(0) as i64;
    if seq <= 0 {
        return Ok(());
    }
    let kind = event
        .get("kind")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .unwrap_or("local");
    let event_type = event
        .get("type")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .unwrap_or("job.event");
    let data = event.get("data").cloned().unwrap_or_else(|| json!({}));
    let conn = open_history_db()?;
    conn.execute(
        "INSERT OR REPLACE INTO job_events (job_id, seq, kind, event_type, data, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            job_id,
            seq,
            kind,
            event_type,
            serde_json::to_string(&data).unwrap_or_else(|_| "{}".to_string()),
            now_iso(),
        ],
    )
    .map_err(|error| {
        AppError::new("history_write_failed", "Unable to record job event.")
            .with_detail(json!({"error": error.to_string()}))
    })?;
    Ok(())
}

pub fn list_history_job_events(job_id: &str) -> Result<Vec<Value>, AppError> {
    let conn = open_history_db()?;
    let mut stmt = conn
        .prepare(
            "SELECT seq, kind, event_type, data FROM job_events WHERE job_id = ?1 ORDER BY seq ASC",
        )
        .map_err(|error| {
            AppError::new("history_query_failed", "Unable to query job events.")
                .with_detail(json!({"error": error.to_string()}))
        })?;
    let rows = stmt
        .query_map(params![job_id], |row| {
            let data_raw: String = row.get(3)?;
            let data = serde_json::from_str::<Value>(&data_raw).unwrap_or_else(|_| json!({}));
            Ok(json!({
                "seq": row.get::<_, i64>(0)?,
                "kind": row.get::<_, String>(1)?,
                "type": row.get::<_, String>(2)?,
                "data": data,
            }))
        })
        .map_err(|error| {
            AppError::new("history_query_failed", "Unable to query job events.")
                .with_detail(json!({"error": error.to_string()}))
        })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|error| {
        AppError::new("history_query_failed", "Unable to read job events.")
            .with_detail(json!({"error": error.to_string()}))
    })
}

/// Mark a history row as soft-deleted by stamping `deleted_at` with the
/// current epoch seconds. Already-deleted rows are not re-stamped, keeping
/// the original deletion time intact for trash retention windows.

pub fn soft_delete_history_job(job_id: &str) -> Result<usize, AppError> {
    let conn = open_history_db()?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string();
    conn.execute(
        "UPDATE jobs SET deleted_at = ?1 WHERE id = ?2 AND deleted_at IS NULL",
        params![now, job_id],
    )
    .map_err(|error| {
        AppError::new(
            "history_soft_delete_failed",
            "Unable to soft-delete history job.",
        )
        .with_detail(json!({"error": error.to_string()}))
    })
}

/// Clear `deleted_at` so the row reappears in the default listing. Idempotent.

pub fn restore_deleted_history_job(job_id: &str) -> Result<usize, AppError> {
    let conn = open_history_db()?;
    conn.execute(
        "UPDATE jobs SET deleted_at = NULL WHERE id = ?1",
        params![job_id],
    )
    .map_err(|error| {
        AppError::new("history_restore_failed", "Unable to restore history job.")
            .with_detail(json!({"error": error.to_string()}))
    })
}

/// Return the IDs of soft-deleted history jobs whose `deleted_at` epoch
/// timestamp is at or before `threshold_epoch_secs` (i.e. their undo window
/// has elapsed). Used by the trash GC worker so the cutoff is anchored to
/// when the row was soft-deleted, not to the trash directory's filesystem
/// mtime (which `fs::rename` doesn't update).

pub fn list_expired_deleted_history_jobs(
    threshold_epoch_secs: u64,
) -> Result<Vec<String>, AppError> {
    let conn = open_history_db()?;
    let mut stmt = conn
        .prepare(
            "SELECT id FROM jobs WHERE deleted_at IS NOT NULL AND CAST(deleted_at AS INTEGER) <= ?1",
        )
        .map_err(|error| {
            AppError::new(
                "history_expired_query_failed",
                "Unable to query expired trash entries.",
            )
            .with_detail(json!({"error": error.to_string()}))
        })?;
    let rows = stmt
        .query_map(params![threshold_epoch_secs as i64], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|error| {
            AppError::new(
                "history_expired_query_failed",
                "Unable to query expired trash entries.",
            )
            .with_detail(json!({"error": error.to_string()}))
        })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|error| {
        AppError::new(
            "history_expired_query_failed",
            "Unable to read expired trash rows.",
        )
        .with_detail(json!({"error": error.to_string()}))
    })
}
