#![allow(unused_imports)]

use super::*;

#[tauri::command]
pub(crate) fn job_recovery(job_id: String) -> Result<Value, String> {
    let job = show_history_job(&job_id).map_err(app_error)?;
    Ok(build_recovery_descriptor(&job))
}

#[tauri::command]
pub(crate) fn interrupted_jobs() -> Result<Value, String> {
    let page = list_history_jobs_page(HistoryListOptions {
        status: Some("failed".to_string()),
        ..HistoryListOptions::default()
    })
    .map_err(app_error)?;
    let jobs = page
        .jobs
        .into_iter()
        .filter(|job| {
            job.get("metadata")
                .and_then(|metadata| metadata.get("interrupted_reason"))
                .and_then(Value::as_str)
                .is_some()
        })
        .map(|job| build_recovery_descriptor(&job))
        .collect::<Vec<_>>();
    Ok(json!({ "jobs": jobs }))
}

#[tauri::command]
pub(crate) fn resume_job(
    job_id: String,
    action: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, JobQueueState>,
) -> Result<Value, String> {
    match action.as_str() {
        "continue_save" => continue_save_job(&job_id),
        "resubmit" => retry_job(job_id, app, state),
        "discard" => discard_job(&job_id),
        _ => Err("Unsupported recovery action.".to_string()),
    }
}

pub(crate) fn continue_save_job(job_id: &str) -> Result<Value, String> {
    let job = show_history_job(job_id).map_err(app_error)?;
    let metadata = job.get("metadata").cloned().unwrap_or_else(|| json!({}));
    let job_dir =
        recovery_job_dir(&metadata).ok_or_else(|| "Recovery job dir is missing.".to_string())?;
    let format = metadata.get("format").and_then(Value::as_str);
    let output_path = job_dir.join(format!("out.{}", output_extension(format)));
    let before_attempts = test_fault::provider_http_attempts(job_id);
    let saved_files = materialize_openai_raw_response(&job_dir, &output_path).map_err(app_error)?;
    let after_attempts = test_fault::provider_http_attempts(job_id);
    if after_attempts != before_attempts {
        return Err("continue_save attempted a provider HTTP request.".to_string());
    }
    let mut recovery_ctx =
        gpt_image_2_core::RecoveryContext::new(job_id.to_string(), job_dir.clone())
            .map_err(app_error)?;
    let _ = recovery_ctx.mark_stage(gpt_image_2_core::RecoveryStage::Materialized);
    let _ = recovery_ctx.mark_stage(gpt_image_2_core::RecoveryStage::Completed);
    let output_path = saved_files
        .first()
        .and_then(|file| file.get("path"))
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let mut merged_metadata = merge_recovery_metadata(metadata, &job_dir);
    if let Value::Object(map) = &mut merged_metadata {
        map.remove("error");
        map.insert("stage".to_string(), json!("completed"));
        map.insert(
            "recoverability".to_string(),
            json!("recoverable.local_response_cached"),
        );
    }
    let completed = job_snapshot(JobSnapshotInput {
        id: job_id,
        command: job
            .get("command")
            .and_then(Value::as_str)
            .unwrap_or("images generate"),
        provider: job
            .get("provider")
            .and_then(Value::as_str)
            .unwrap_or("unknown"),
        status: "completed",
        created_at: job
            .get("created_at")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        metadata: merged_metadata,
        output_path,
        outputs: json!(saved_files),
        error: Value::Null,
    });
    let notify_job = upload_completed_job_outputs(&completed)?;
    Ok(json!({
        "job_id": job_id,
        "job": notify_job,
        "events": [{
            "seq": 1,
            "kind": "local",
            "type": "job.completed",
            "data": completed_event_data(&notify_job),
        }],
        "recovered": true,
    }))
}

pub(crate) fn discard_job(job_id: &str) -> Result<Value, String> {
    let mut job = show_history_job(job_id).map_err(app_error)?;
    let mut metadata = job.get("metadata").cloned().unwrap_or_else(|| json!({}));
    if let Value::Object(map) = &mut metadata {
        map.insert("discarded_at".to_string(), json!(chrono_like_now()));
    }
    let output_path = job
        .get("output_path")
        .and_then(Value::as_str)
        .map(PathBuf::from);
    upsert_history_job(
        job_id,
        job.get("command")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        job.get("provider")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        "failed",
        output_path.as_deref(),
        Some(
            job.get("created_at")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        ),
        metadata.clone(),
    )
    .map_err(app_error)?;
    job["metadata"] = metadata;
    Ok(json!({ "job_id": job_id, "job": job, "discarded": true }))
}

#[cfg(feature = "recovery-fault-injection")]
#[tauri::command]
pub(crate) fn set_test_faults(fail_at: Option<String>, kill_at: Option<String>) -> Value {
    test_fault::set_faults(fail_at, kill_at);
    test_fault::faults_json()
}

#[cfg(feature = "recovery-fault-injection")]
#[tauri::command]
pub(crate) fn test_provider_http_attempts(job_id: String) -> Value {
    json!({ "total": test_fault::provider_http_attempts(&job_id) })
}

#[cfg(feature = "recovery-fault-injection")]
#[tauri::command]
pub(crate) fn test_job_attempts(job_id: String) -> Result<Value, String> {
    let job = show_history_job(&job_id).map_err(app_error)?;
    let (attempts, attempts_truncated_count) = gpt_image_2_core::recovery_attempts_from_metadata(
        job.get("metadata").unwrap_or(&Value::Null),
    );
    Ok(json!({
        "attempts": attempts,
        "attempts_truncated_count": attempts_truncated_count,
    }))
}

#[cfg(feature = "recovery-fault-injection")]
#[tauri::command]
pub(crate) fn test_raw_response_hash(job_id: String) -> Result<Value, String> {
    let job = show_history_job(&job_id).map_err(app_error)?;
    let metadata = job.get("metadata").cloned().unwrap_or(Value::Null);
    let job_dir =
        recovery_job_dir(&metadata).ok_or_else(|| "Recovery job dir is missing.".to_string())?;
    let sha256 = gpt_image_2_core::raw_response_sha256(&job_dir).map_err(app_error)?;
    Ok(json!({ "sha256": sha256 }))
}
