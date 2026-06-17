use std::path::{Path, PathBuf};

use rusqlite::types::Value as SqlValue;
use rusqlite::{Connection, Row, params, params_from_iter};
use serde_json::{Value, json};

use crate::constants::{DEFAULT_HISTORY_PAGE_LIMIT, MAX_HISTORY_PAGE_LIMIT};
use crate::errors::AppError;
use crate::history_db::open_history_db;
use crate::recovery::recovery_job_dir;
use crate::storage::{
    OutputUploadRecord, enrich_outputs_with_uploads, list_output_upload_records_with_conn,
    storage_status_for_uploads,
};
use crate::util::now_iso;

#[derive(Debug, Clone, Default)]
pub struct HistoryListOptions {
    pub limit: Option<usize>,
    pub cursor: Option<String>,
    pub status: Option<String>,
    pub query: Option<String>,
    /// When false (default), soft-deleted rows (deleted_at IS NOT NULL) are
    /// excluded. Trash views set this to true to surface them.
    pub include_deleted: bool,
}

#[derive(Debug, Clone)]
pub struct HistoryListPage {
    pub jobs: Vec<Value>,
    pub next_cursor: Option<String>,
    pub has_more: bool,
    pub total: usize,
}

pub(crate) fn history_row_to_value(row: &Row<'_>) -> rusqlite::Result<Value> {
    history_row_to_value_with_uploads(row, &[])
}

pub(crate) fn history_row_to_value_with_uploads(
    row: &Row<'_>,
    uploads: &[OutputUploadRecord],
) -> rusqlite::Result<Value> {
    let id = row.get::<_, String>(0)?;
    let output_path = row.get::<_, Option<String>>(4)?;
    let created_at = row.get::<_, String>(5)?;
    let mut metadata =
        serde_json::from_str::<Value>(&row.get::<_, String>(6)?).unwrap_or(Value::Null);
    redact_recovery_attempts(&mut metadata);
    let output = metadata.get("output").cloned().unwrap_or_else(|| json!({}));
    let outputs = output
        .get("files")
        .cloned()
        .or_else(|| {
            metadata
                .get("image_output")
                .and_then(|value| value.get("files"))
                .cloned()
        })
        .unwrap_or_else(|| json!([]));
    let updated_at = metadata
        .get("updated_at")
        .and_then(Value::as_str)
        .unwrap_or(&created_at)
        .to_string();
    let error = metadata.get("error").cloned().unwrap_or(Value::Null);
    let reference_images =
        reference_images_for_job(&metadata, output_path.as_deref(), &outputs);
    Ok(json!({
        "id": id,
        "command": row.get::<_, String>(1)?,
        "provider": row.get::<_, String>(2)?,
        "status": row.get::<_, String>(3)?,
        "output_path": output_path,
        "created_at": created_at,
        "updated_at": updated_at,
        "metadata": metadata,
        "outputs": enrich_outputs_with_uploads(outputs, uploads),
        "reference_images": reference_images,
        "storage_status": storage_status_for_uploads(uploads),
        "error": error,
    }))
}

/// Locate the on-disk job directory for a history row.
///
/// Recovery/resume jobs persist the directory in metadata, but ordinary
/// CLI/app edit jobs do not, so we fall back to the parent directory of any
/// recorded output path (outputs live alongside the `ref-*.png` inputs).
fn job_dir_for(metadata: &Value, output_path: Option<&str>, outputs: &Value) -> Option<PathBuf> {
    if let Some(dir) = recovery_job_dir(metadata) {
        return Some(dir);
    }
    let parent_of = |path: &str| Path::new(path).parent().map(Path::to_path_buf);
    outputs
        .as_array()
        .and_then(|items| {
            items
                .iter()
                .filter_map(|item| item.get("path").and_then(Value::as_str))
                .find_map(parent_of)
        })
        .or_else(|| output_path.and_then(parent_of))
}

/// Scan a job directory for reference input images named `ref-{index}.png`
/// and return `[{ "index": <number>, "path": <absolute> }]` sorted by index.
///
/// Compatibility note: this reads the filesystem rather than any stored list,
/// so older jobs (which never recorded reference metadata) still surface their
/// inputs as long as the `ref-*.png` files exist on disk.
fn scan_reference_images(job_dir: &Path) -> Vec<Value> {
    let Ok(entries) = std::fs::read_dir(job_dir) else {
        return Vec::new();
    };
    let mut refs: Vec<(u64, PathBuf)> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            if !path.is_file() {
                return None;
            }
            let index = parse_reference_index(path.file_name()?.to_str()?)?;
            Some((index, path))
        })
        .collect();
    refs.sort_by_key(|(index, _)| *index);
    refs.into_iter()
        .map(|(index, path)| json!({ "index": index, "path": path.display().to_string() }))
        .collect()
}

/// Parse the numeric index from a `ref-{index}.png` file name, e.g.
/// `ref-0.png` -> `Some(0)`. Returns `None` for any other name.
fn parse_reference_index(file_name: &str) -> Option<u64> {
    let stem = file_name.strip_suffix(".png")?;
    let digits = stem.strip_prefix("ref-")?;
    if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    digits.parse::<u64>().ok()
}

fn reference_images_for_job(
    metadata: &Value,
    output_path: Option<&str>,
    outputs: &Value,
) -> Value {
    job_dir_for(metadata, output_path, outputs)
        .map(|dir| Value::Array(scan_reference_images(&dir)))
        .unwrap_or_else(|| Value::Array(Vec::new()))
}

fn redact_recovery_attempts(metadata: &mut Value) {
    if let Value::Object(map) = metadata {
        map.remove("attempts");
        map.remove("attempts_truncated_count");
    }
}

pub(crate) fn normalize_history_limit(limit: Option<usize>) -> usize {
    limit
        .unwrap_or(DEFAULT_HISTORY_PAGE_LIMIT)
        .clamp(1, MAX_HISTORY_PAGE_LIMIT)
}

pub(crate) fn history_status_values(status: Option<&str>) -> Vec<&'static str> {
    match status.unwrap_or("all") {
        "active" | "running" => vec!["queued", "running", "uploading"],
        "completed" => vec!["completed", "partial_failed"],
        "failed" => vec!["failed", "partial_failed", "cancelled", "canceled"],
        "queued" => vec!["queued"],
        "all" | "" => Vec::new(),
        _ => Vec::new(),
    }
}

pub(crate) fn append_status_filter(
    clauses: &mut Vec<String>,
    params: &mut Vec<SqlValue>,
    statuses: &[&'static str],
) {
    if statuses.is_empty() {
        return;
    }
    let placeholders = (0..statuses.len())
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(", ");
    clauses.push(format!("status IN ({placeholders})"));
    params.extend(
        statuses
            .iter()
            .map(|status| SqlValue::Text((*status).to_string())),
    );
}

pub(crate) fn normalize_history_query(query: Option<&str>) -> Option<String> {
    let trimmed = query?.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_lowercase())
}

pub(crate) fn escape_like_pattern(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for ch in value.chars() {
        if matches!(ch, '\\' | '%' | '_') {
            escaped.push('\\');
        }
        escaped.push(ch);
    }
    escaped
}

pub(crate) fn append_search_filter(
    clauses: &mut Vec<String>,
    params: &mut Vec<SqlValue>,
    query: Option<&str>,
) {
    let Some(query) = normalize_history_query(query) else {
        return;
    };
    let pattern = format!("%{}%", escape_like_pattern(&query));
    clauses.push(
        "(LOWER(id) LIKE ? ESCAPE '\\' OR LOWER(command) LIKE ? ESCAPE '\\' OR LOWER(provider) LIKE ? ESCAPE '\\' OR LOWER(metadata) LIKE ? ESCAPE '\\')"
            .to_string(),
    );
    params.extend((0..4).map(|_| SqlValue::Text(pattern.clone())));
}

pub(crate) fn parse_history_cursor(cursor: Option<&str>) -> Option<(String, String)> {
    let cursor = cursor?.trim();
    if cursor.is_empty() {
        return None;
    }
    let (created_at, id) = cursor.split_once('|')?;
    if created_at.is_empty() || id.is_empty() {
        return None;
    }
    Some((created_at.to_string(), id.to_string()))
}

pub(crate) fn history_cursor_for(job: &Value) -> Option<String> {
    let created_at = job.get("created_at")?.as_str()?;
    let id = job.get("id")?.as_str()?;
    Some(format!("{created_at}|{id}"))
}

pub(crate) fn enrich_history_jobs_with_uploads(
    conn: &Connection,
    jobs: &mut [Value],
) -> Result<(), AppError> {
    for job in jobs {
        let Some(job_id) = job.get("id").and_then(Value::as_str).map(str::to_string) else {
            continue;
        };
        let uploads = list_output_upload_records_with_conn(conn, &job_id)?;
        if let Some(object) = job.as_object_mut() {
            let outputs = object.remove("outputs").unwrap_or_else(|| json!([]));
            object.insert(
                "outputs".to_string(),
                enrich_outputs_with_uploads(outputs, &uploads),
            );
            object.insert(
                "storage_status".to_string(),
                Value::String(storage_status_for_uploads(&uploads).to_string()),
            );
        }
    }
    Ok(())
}

pub(crate) fn history_where_sql(clauses: &[String]) -> String {
    if clauses.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", clauses.join(" AND "))
    }
}

pub fn list_history_jobs_page(options: HistoryListOptions) -> Result<HistoryListPage, AppError> {
    let conn = open_history_db()?;
    let limit = normalize_history_limit(options.limit);
    let statuses = history_status_values(options.status.as_deref());
    let cursor = parse_history_cursor(options.cursor.as_deref());

    let mut count_clauses = Vec::new();
    let mut count_params = Vec::new();
    append_status_filter(&mut count_clauses, &mut count_params, &statuses);
    if !options.include_deleted {
        count_clauses.push("deleted_at IS NULL".to_string());
    }
    append_search_filter(
        &mut count_clauses,
        &mut count_params,
        options.query.as_deref(),
    );
    let count_sql = format!(
        "SELECT COUNT(*) FROM jobs{}",
        history_where_sql(&count_clauses)
    );
    let total = conn
        .query_row(&count_sql, params_from_iter(count_params), |row| {
            row.get::<_, i64>(0)
        })
        .map_err(|error| {
            AppError::new("history_query_failed", "Unable to count history.")
                .with_detail(json!({"error": error.to_string()}))
        })? as usize;

    let mut clauses = Vec::new();
    let mut query_params = Vec::new();
    append_status_filter(&mut clauses, &mut query_params, &statuses);
    if !options.include_deleted {
        clauses.push("deleted_at IS NULL".to_string());
    }
    append_search_filter(&mut clauses, &mut query_params, options.query.as_deref());
    if let Some((created_at, id)) = cursor {
        clauses.push("(created_at < ? OR (created_at = ? AND id < ?))".to_string());
        query_params.push(SqlValue::Text(created_at.clone()));
        query_params.push(SqlValue::Text(created_at));
        query_params.push(SqlValue::Text(id));
    }
    query_params.push(SqlValue::Integer((limit + 1) as i64));
    let query_sql = format!(
        "SELECT id, command, provider, status, output_path, created_at, metadata FROM jobs{} ORDER BY created_at DESC, id DESC LIMIT ?",
        history_where_sql(&clauses)
    );
    let mut stmt = conn.prepare(&query_sql).map_err(|error| {
        AppError::new("history_query_failed", "Unable to query history.")
            .with_detail(json!({"error": error.to_string()}))
    })?;
    let mut jobs = stmt
        .query_map(params_from_iter(query_params), history_row_to_value)
        .map_err(|error| {
            AppError::new("history_query_failed", "Unable to query history.")
                .with_detail(json!({"error": error.to_string()}))
        })?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| {
            AppError::new("history_query_failed", "Unable to read history rows.")
                .with_detail(json!({"error": error.to_string()}))
        })?;
    enrich_history_jobs_with_uploads(&conn, &mut jobs)?;
    let has_more = jobs.len() > limit;
    if has_more {
        jobs.truncate(limit);
    }
    let next_cursor = if has_more {
        jobs.last().and_then(history_cursor_for)
    } else {
        None
    };
    Ok(HistoryListPage {
        jobs,
        next_cursor,
        has_more,
        total,
    })
}

pub fn list_history_jobs() -> Result<Vec<Value>, AppError> {
    Ok(list_history_jobs_page(HistoryListOptions::default())?.jobs)
}

pub fn list_active_history_jobs() -> Result<Vec<Value>, AppError> {
    let conn = open_history_db()?;
    let mut stmt = conn
        .prepare("SELECT id, command, provider, status, output_path, created_at, metadata FROM jobs WHERE status IN ('queued', 'running', 'uploading') AND deleted_at IS NULL ORDER BY created_at DESC, id DESC")
        .map_err(|error| AppError::new("history_query_failed", "Unable to query active history.").with_detail(json!({"error": error.to_string()})))?;
    let mut jobs = stmt
        .query_map([], history_row_to_value)
        .map_err(|error| {
            AppError::new("history_query_failed", "Unable to query active history.")
                .with_detail(json!({"error": error.to_string()}))
        })?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| {
            AppError::new(
                "history_query_failed",
                "Unable to read active history rows.",
            )
            .with_detail(json!({"error": error.to_string()}))
        })?;
    enrich_history_jobs_with_uploads(&conn, &mut jobs)?;
    Ok(jobs)
}

pub fn show_history_job(job_id: &str) -> Result<Value, AppError> {
    let conn = open_history_db()?;
    let uploads = list_output_upload_records_with_conn(&conn, job_id)?;
    let mut stmt = conn
        .prepare("SELECT id, command, provider, status, output_path, created_at, metadata FROM jobs WHERE id = ?1")
        .map_err(|error| AppError::new("history_query_failed", "Unable to query history.").with_detail(json!({"error": error.to_string()})))?;
    stmt.query_row(params![job_id], |row| {
        history_row_to_value_with_uploads(row, &uploads)
    })
    .map_err(|error| {
        AppError::new("history_not_found", "History job was not found.")
            .with_detail(json!({"job_id": job_id, "error": error.to_string()}))
    })
}
