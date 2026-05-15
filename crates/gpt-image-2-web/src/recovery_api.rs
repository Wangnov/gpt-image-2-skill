#![allow(unused_imports)]

use super::*;

#[derive(Debug, Deserialize)]
pub(crate) struct ResumeRequest {
    pub(crate) action: String,
}

pub(crate) async fn job_recovery(Path(job_id): Path<String>) -> ApiResult {
    let job = show_history_job(&job_id)
        .map_err(app_error)
        .map_err(ApiError::not_found)?;
    Ok(Json(build_recovery_descriptor(&job)))
}

pub(crate) async fn interrupted_jobs() -> ApiResult {
    let jobs = list_history_jobs_page(HistoryListOptions {
        status: Some("failed".to_string()),
        ..HistoryListOptions::default()
    })
    .map_err(app_error)
    .map_err(ApiError::internal)?
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
    Ok(Json(json!({ "jobs": jobs })))
}

pub(crate) async fn resume_job(
    Path(job_id): Path<String>,
    State(state): State<JobQueueState>,
    Json(body): Json<ResumeRequest>,
) -> ApiResult {
    match body.action.as_str() {
        "continue_save" => continue_save_job(&job_id)
            .map(Json)
            .map_err(ApiError::internal),
        "resubmit" => retry_job(Path(job_id), State(state)).await,
        "discard" => discard_job(&job_id).map(Json).map_err(ApiError::internal),
        _ => Err(ApiError::bad_request("Unsupported recovery action.")),
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
#[derive(Debug, Deserialize)]
pub(crate) struct FaultRequest {
    #[serde(default)]
    pub(crate) fail_at: Option<String>,
    #[serde(default)]
    pub(crate) kill_at: Option<String>,
}

#[cfg(feature = "recovery-fault-injection")]
pub(crate) async fn set_test_faults(Json(body): Json<FaultRequest>) -> ApiResult {
    test_fault::set_faults(body.fail_at, body.kill_at);
    Ok(Json(test_fault::faults_json()))
}

#[cfg(feature = "recovery-fault-injection")]
pub(crate) async fn test_provider_http_attempts(Path(job_id): Path<String>) -> ApiResult {
    Ok(Json(json!({
        "total": test_fault::provider_http_attempts(&job_id),
    })))
}

#[cfg(feature = "recovery-fault-injection")]
pub(crate) async fn test_job_attempts(Path(job_id): Path<String>) -> ApiResult {
    let job = show_history_job(&job_id)
        .map_err(app_error)
        .map_err(ApiError::not_found)?;
    let (attempts, attempts_truncated_count) = gpt_image_2_core::recovery_attempts_from_metadata(
        job.get("metadata").unwrap_or(&Value::Null),
    );
    Ok(Json(json!({
        "attempts": attempts,
        "attempts_truncated_count": attempts_truncated_count,
    })))
}

#[cfg(feature = "recovery-fault-injection")]
pub(crate) async fn test_raw_response_hash(Path(job_id): Path<String>) -> ApiResult {
    let job = show_history_job(&job_id)
        .map_err(app_error)
        .map_err(ApiError::not_found)?;
    let metadata = job.get("metadata").cloned().unwrap_or(Value::Null);
    let job_dir = recovery_job_dir(&metadata)
        .ok_or_else(|| ApiError::not_found("Recovery job dir is missing."))?;
    let sha256 = gpt_image_2_core::raw_response_sha256(&job_dir)
        .map_err(app_error)
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "sha256": sha256 })))
}
