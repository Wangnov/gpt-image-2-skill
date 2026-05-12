use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::{DateTime, Utc};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{AppError, open_history_db};

use super::history::{OutputUploadRecord, list_output_upload_records_with_conn};
use super::types::{CleanupMode, PipelineMode, StorageConfig};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StorageCacheCleanupOutcome {
    pub deleted_files: Vec<String>,
    pub retained_files: usize,
    pub skipped_reason: Option<String>,
}

#[derive(Debug, Clone)]
struct CacheEntry {
    job_id: String,
    output_index: usize,
    path: PathBuf,
    created_at: u64,
    bytes: u64,
}

pub fn cleanup_storage_cache(
    config: &StorageConfig,
    trigger_job: Option<&Value>,
) -> Result<StorageCacheCleanupOutcome, AppError> {
    let pipeline = config.effective_pipeline();
    if !matches!(pipeline.mode, PipelineMode::CloudPrimary) {
        return Ok(skipped("not_cloud_primary"));
    }
    if matches!(pipeline.cleanup.mode, CleanupMode::Never) {
        return Ok(skipped("cleanup_disabled"));
    }
    let Some(origin) = pipeline.origin.as_deref().filter(|value| !value.is_empty()) else {
        return Ok(skipped("origin_missing"));
    };
    let expected_targets = expected_targets(origin, &pipeline.archives);
    match pipeline.cleanup.mode {
        CleanupMode::Never => unreachable!("handled above"),
        CleanupMode::AfterArchiveSuccess => {
            let Some(job) = trigger_job else {
                return Ok(skipped("trigger_job_missing"));
            };
            cleanup_entries(protected_cache_entries_for_job(job, &expected_targets)?)
        }
        CleanupMode::ByAge => {
            let retention_days = pipeline.cleanup.retention_days.unwrap_or(30) as u64;
            let cutoff = now_secs().saturating_sub(retention_days.saturating_mul(86_400));
            let entries = all_protected_cache_entries(&expected_targets)?
                .into_iter()
                .filter(|entry| entry.created_at <= cutoff)
                .collect::<Vec<_>>();
            cleanup_entries(entries)
        }
        CleanupMode::BySize => {
            let max_bytes = (pipeline.cleanup.max_origin_gb.unwrap_or(10) as u64)
                .saturating_mul(1024)
                .saturating_mul(1024)
                .saturating_mul(1024);
            let mut entries = all_protected_cache_entries(&expected_targets)?;
            let mut total = entries.iter().map(|entry| entry.bytes).sum::<u64>();
            entries.sort_by(|a, b| {
                a.created_at
                    .cmp(&b.created_at)
                    .then_with(|| a.job_id.cmp(&b.job_id))
                    .then_with(|| a.output_index.cmp(&b.output_index))
            });
            let mut delete = Vec::new();
            for entry in entries {
                if total <= max_bytes {
                    break;
                }
                total = total.saturating_sub(entry.bytes);
                delete.push(entry);
            }
            cleanup_entries(delete)
        }
    }
}

fn skipped(reason: &str) -> StorageCacheCleanupOutcome {
    StorageCacheCleanupOutcome {
        skipped_reason: Some(reason.to_string()),
        ..StorageCacheCleanupOutcome::default()
    }
}

fn expected_targets(origin: &str, archives: &[String]) -> Vec<String> {
    let mut out = vec![origin.to_string()];
    for archive in archives {
        if !out.iter().any(|existing| existing == archive) {
            out.push(archive.clone());
        }
    }
    out
}

fn cleanup_entries(entries: Vec<CacheEntry>) -> Result<StorageCacheCleanupOutcome, AppError> {
    let mut deleted_files = Vec::new();
    let mut retained_files = 0usize;
    for entry in entries {
        if !entry.path.is_file() {
            retained_files += 1;
            continue;
        }
        fs::remove_file(&entry.path).map_err(|error| {
            AppError::new(
                "storage_cache_cleanup_failed",
                "Unable to delete local output cache.",
            )
            .with_detail(
                json!({"path": entry.path.display().to_string(), "error": error.to_string()}),
            )
        })?;
        deleted_files.push(entry.path.display().to_string());
    }
    Ok(StorageCacheCleanupOutcome {
        deleted_files,
        retained_files,
        skipped_reason: None,
    })
}

fn protected_cache_entries_for_job(
    job: &Value,
    expected_targets: &[String],
) -> Result<Vec<CacheEntry>, AppError> {
    let job_id = job.get("id").and_then(Value::as_str).ok_or_else(|| {
        AppError::new(
            "storage_cache_cleanup_job_invalid",
            "Job id is required for cache cleanup.",
        )
    })?;
    let uploads = super::history::list_output_upload_records(job_id)?;
    Ok(cache_entries_from_job(job, &uploads, expected_targets))
}

fn all_protected_cache_entries(expected_targets: &[String]) -> Result<Vec<CacheEntry>, AppError> {
    let conn = open_history_db()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, command, provider, status, output_path, created_at, metadata
             FROM jobs
             WHERE status IN ('completed', 'partial_failed') AND deleted_at IS NULL
             ORDER BY created_at ASC, id ASC",
        )
        .map_err(|error| {
            AppError::new(
                "storage_cache_cleanup_query_failed",
                "Unable to query history for cache cleanup.",
            )
            .with_detail(json!({"error": error.to_string()}))
        })?;
    let rows = stmt
        .query_map(params![], crate::history_list::history_row_to_value)
        .map_err(|error| {
            AppError::new(
                "storage_cache_cleanup_query_failed",
                "Unable to query history for cache cleanup.",
            )
            .with_detail(json!({"error": error.to_string()}))
        })?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| {
            AppError::new(
                "storage_cache_cleanup_query_failed",
                "Unable to read history for cache cleanup.",
            )
            .with_detail(json!({"error": error.to_string()}))
        })?;
    let mut out = Vec::new();
    for job in rows {
        let Some(job_id) = job.get("id").and_then(Value::as_str) else {
            continue;
        };
        let uploads = list_output_upload_records_with_conn(&conn, job_id)?;
        out.extend(cache_entries_from_job(&job, &uploads, expected_targets));
    }
    Ok(out)
}

fn cache_entries_from_job(
    job: &Value,
    uploads: &[OutputUploadRecord],
    expected_targets: &[String],
) -> Vec<CacheEntry> {
    let Some(job_id) = job.get("id").and_then(Value::as_str) else {
        return Vec::new();
    };
    let created_at = created_at_secs(job);
    output_cache_paths(job)
        .into_iter()
        .filter(|(output_index, path)| {
            path.is_file() && output_is_protected(uploads, *output_index, expected_targets)
        })
        .filter_map(|(output_index, path)| {
            let bytes = fs::metadata(&path).ok()?.len();
            Some(CacheEntry {
                job_id: job_id.to_string(),
                output_index,
                path,
                created_at,
                bytes,
            })
        })
        .collect()
}

fn output_is_protected(
    uploads: &[OutputUploadRecord],
    output_index: usize,
    expected_targets: &[String],
) -> bool {
    !expected_targets.is_empty()
        && expected_targets.iter().all(|target| {
            uploads.iter().any(|upload| {
                upload.output_index == output_index
                    && upload.target == *target
                    && upload.status == "completed"
            })
        })
}

fn output_cache_paths(job: &Value) -> Vec<(usize, PathBuf)> {
    let mut out = job
        .get("outputs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
        .filter_map(|(fallback, output)| {
            let index = output
                .get("index")
                .and_then(Value::as_u64)
                .and_then(|value| usize::try_from(value).ok())
                .unwrap_or(fallback);
            let path = output.get("path").and_then(Value::as_str)?;
            Some((index, PathBuf::from(path)))
        })
        .collect::<Vec<_>>();
    if out.is_empty()
        && let Some(path) = job.get("output_path").and_then(Value::as_str)
    {
        out.push((0, PathBuf::from(path)));
    }
    out
}

fn created_at_secs(job: &Value) -> u64 {
    job.get("created_at")
        .and_then(Value::as_str)
        .and_then(|value| {
            value.parse::<u64>().ok().or_else(|| {
                DateTime::parse_from_rfc3339(value)
                    .ok()
                    .map(|dt| dt.with_timezone(&Utc).timestamp().max(0) as u64)
            })
        })
        .unwrap_or_else(now_secs)
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
