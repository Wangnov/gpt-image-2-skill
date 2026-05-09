#![allow(unused_imports)]

use super::*;

pub(crate) fn append_updated_at(metadata: &mut Value) {
    if let Value::Object(object) = metadata {
        object.insert("updated_at".to_string(), json!(chrono_like_now()));
    }
}

pub(crate) fn output_path_from_payload(payload: &Value) -> Option<String> {
    payload
        .get("output")
        .and_then(|output| output.get("path"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .or_else(|| {
            payload
                .get("output")
                .and_then(|output| output.get("files"))
                .and_then(Value::as_array)
                .and_then(|files| files.first())
                .and_then(|file| file.get("path"))
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
}

pub(crate) struct JobSnapshotInput<'a> {
    pub(crate) id: &'a str,
    pub(crate) command: &'a str,
    pub(crate) provider: &'a str,
    pub(crate) status: &'a str,
    pub(crate) created_at: &'a str,
    pub(crate) metadata: Value,
    pub(crate) output_path: Option<String>,
    pub(crate) outputs: Value,
    pub(crate) error: Value,
}

pub(crate) fn job_snapshot(input: JobSnapshotInput<'_>) -> Value {
    json!({
        "id": input.id,
        "command": input.command,
        "provider": input.provider,
        "status": input.status,
        "created_at": input.created_at,
        "updated_at": chrono_like_now(),
        "metadata": input.metadata,
        "outputs": input.outputs,
        "output_path": input.output_path,
        "error": input.error,
    })
}

pub(crate) fn persist_job(job: &Value) -> Result<(), String> {
    let id = job
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "Job id is missing.".to_string())?;
    let command = job
        .get("command")
        .and_then(Value::as_str)
        .unwrap_or("images generate");
    let provider = job
        .get("provider")
        .and_then(Value::as_str)
        .unwrap_or("auto");
    let status = job
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("queued");
    let created_at = job.get("created_at").and_then(Value::as_str);
    let output_path = job
        .get("output_path")
        .and_then(Value::as_str)
        .map(PathBuf::from);
    let mut metadata = job.get("metadata").cloned().unwrap_or_else(|| json!({}));
    append_updated_at(&mut metadata);
    if let Value::Object(object) = &mut metadata {
        if let Some(outputs) = job.get("outputs")
            && !outputs.is_null()
        {
            object.insert(
                "output".to_string(),
                json!({
                    "path": job.get("output_path").cloned().unwrap_or(Value::Null),
                    "files": outputs,
                }),
            );
        }
        if let Some(error) = job.get("error")
            && !error.is_null()
        {
            object.insert("error".to_string(), error.clone());
        }
    }
    upsert_history_job(
        id,
        command,
        provider,
        status,
        output_path.as_deref(),
        created_at,
        metadata,
    )
    .map_err(app_error)
}
