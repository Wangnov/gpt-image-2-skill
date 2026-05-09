use rusqlite::{Connection, Row, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{AppError, open_history_db};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputUploadRecord {
    pub job_id: String,
    pub output_index: usize,
    pub target: String,
    pub target_type: String,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bytes: Option<u64>,
    pub attempts: u32,
    pub updated_at: String,
    #[serde(default)]
    pub metadata: Value,
}

pub(crate) fn upload_record_to_value(record: &OutputUploadRecord) -> Value {
    json!({
        "job_id": record.job_id,
        "output_index": record.output_index,
        "target": record.target,
        "target_type": record.target_type,
        "status": record.status,
        "url": record.url,
        "error": record.error,
        "bytes": record.bytes,
        "attempts": record.attempts,
        "updated_at": record.updated_at,
        "metadata": record.metadata,
    })
}

fn row_to_upload_record(row: &Row<'_>) -> rusqlite::Result<OutputUploadRecord> {
    let metadata = serde_json::from_str::<Value>(&row.get::<_, String>(10)?).unwrap_or(Value::Null);
    Ok(OutputUploadRecord {
        job_id: row.get(0)?,
        output_index: row.get::<_, i64>(1)?.max(0) as usize,
        target: row.get(2)?,
        target_type: row.get(3)?,
        status: row.get(4)?,
        url: row.get(5)?,
        error: row.get(6)?,
        bytes: row
            .get::<_, Option<i64>>(7)?
            .map(|value| value.max(0) as u64),
        attempts: row.get::<_, i64>(8)?.max(0) as u32,
        updated_at: row.get(9)?,
        metadata,
    })
}

pub fn upsert_output_upload_record(record: &OutputUploadRecord) -> Result<(), AppError> {
    let conn = open_history_db()?;
    conn.execute(
        "INSERT INTO output_uploads (
            job_id, output_index, target, target_type, status, url, error, bytes, attempts, updated_at, metadata
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        ON CONFLICT(job_id, output_index, target) DO UPDATE SET
            target_type = excluded.target_type,
            status = excluded.status,
            url = excluded.url,
            error = excluded.error,
            bytes = excluded.bytes,
            attempts = excluded.attempts,
            updated_at = excluded.updated_at,
            metadata = excluded.metadata",
        params![
            record.job_id,
            record.output_index as i64,
            record.target,
            record.target_type,
            record.status,
            record.url,
            record.error,
            record.bytes.map(|value| value as i64),
            record.attempts as i64,
            record.updated_at,
            serde_json::to_string(&record.metadata).unwrap_or_else(|_| "{}".to_string()),
        ],
    )
    .map_err(|error| {
        AppError::new("history_write_failed", "Unable to record output upload history.")
            .with_detail(json!({"error": error.to_string()}))
    })?;
    Ok(())
}

pub fn list_output_upload_records(job_id: &str) -> Result<Vec<OutputUploadRecord>, AppError> {
    let conn = open_history_db()?;
    list_output_upload_records_with_conn(&conn, job_id)
}

pub(crate) fn storage_status_for_uploads(uploads: &[OutputUploadRecord]) -> &'static str {
    if uploads.is_empty() {
        return "not_configured";
    }
    let completed = uploads
        .iter()
        .filter(|upload| upload.status == "completed")
        .count();
    let primary_completed = uploads.iter().any(|upload| {
        upload.status == "completed"
            && upload.metadata.get("role").and_then(Value::as_str) == Some("primary")
    });
    let fallback_completed = uploads.iter().any(|upload| {
        upload.status == "completed"
            && upload.metadata.get("role").and_then(Value::as_str) == Some("fallback")
    });
    if uploads
        .iter()
        .any(|upload| matches!(upload.status.as_str(), "pending" | "running"))
    {
        "running"
    } else if fallback_completed && !primary_completed {
        "fallback_completed"
    } else if completed == uploads.len() {
        "completed"
    } else if completed > 0 {
        "partial_failed"
    } else {
        "failed"
    }
}

pub(crate) fn enrich_outputs_with_uploads(
    mut outputs: Value,
    uploads: &[OutputUploadRecord],
) -> Value {
    let Some(output_items) = outputs.as_array_mut() else {
        return outputs;
    };
    for output in output_items {
        let Some(output_index) = output
            .get("index")
            .and_then(Value::as_u64)
            .map(|value| value as usize)
        else {
            continue;
        };
        let output_uploads = uploads
            .iter()
            .filter(|upload| upload.output_index == output_index)
            .map(upload_record_to_value)
            .collect::<Vec<_>>();
        if output_uploads.is_empty() {
            continue;
        }
        if let Some(object) = output.as_object_mut() {
            object.insert("uploads".to_string(), Value::Array(output_uploads));
        }
    }
    outputs
}

pub(crate) fn list_output_upload_records_with_conn(
    conn: &Connection,
    job_id: &str,
) -> Result<Vec<OutputUploadRecord>, AppError> {
    let mut stmt = conn
        .prepare(
            "SELECT job_id, output_index, target, target_type, status, url, error, bytes, attempts, updated_at, metadata
             FROM output_uploads
             WHERE job_id = ?1
             ORDER BY output_index ASC, target ASC",
        )
        .map_err(|error| {
            AppError::new("history_query_failed", "Unable to query output upload history.")
                .with_detail(json!({"error": error.to_string()}))
        })?;
    stmt.query_map(params![job_id], row_to_upload_record)
        .map_err(|error| {
            AppError::new(
                "history_query_failed",
                "Unable to query output upload history.",
            )
            .with_detail(json!({"error": error.to_string()}))
        })?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| {
            AppError::new(
                "history_query_failed",
                "Unable to read output upload history.",
            )
            .with_detail(json!({"error": error.to_string()}))
        })
}
