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
        "fill_missing" => fill_missing_job(&job_id)
            .map(Json)
            .map_err(ApiError::internal),
        "reupload" => reupload_job(&job_id).map(Json).map_err(ApiError::internal),
        "resubmit" => retry_job(Path(job_id), State(state)).await,
        "discard" => discard_job(&job_id).map(Json).map_err(ApiError::internal),
        _ => Err(ApiError::bad_request("Unsupported recovery action.")),
    }
}

fn next_recovery_event(job_id: &str, event_type: &str, data: Value) -> Value {
    let seq = list_history_job_events(job_id)
        .ok()
        .and_then(|events| {
            events
                .iter()
                .filter_map(|event| event.get("seq").and_then(Value::as_u64))
                .max()
        })
        .unwrap_or(0)
        + 1;
    let event = json!({
        "seq": seq,
        "kind": "local",
        "type": event_type,
        "data": data,
    });
    let _ = append_history_job_event(job_id, &event);
    event
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
    let event = next_recovery_event(job_id, "job.completed", completed_event_data(&notify_job));
    Ok(json!({
        "job_id": job_id,
        "job": notify_job,
        "events": [event],
        "recovered": true,
    }))
}

fn expected_slot_count(metadata: &Value, job: &Value) -> usize {
    metadata
        .get("generation_slots")
        .and_then(Value::as_array)
        .map(Vec::len)
        .or_else(|| {
            metadata
                .get("n")
                .and_then(Value::as_u64)
                .and_then(|value| usize::try_from(value).ok())
        })
        .unwrap_or_else(|| {
            job.get("outputs")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or(1)
                .max(1)
        })
        .clamp(1, 16)
}

fn existing_output_files(job: &Value) -> Vec<Value> {
    job.get("outputs")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn merge_output_files(existing: Vec<Value>, filled: Vec<(usize, Value)>) -> Vec<Value> {
    let mut by_index = BTreeMap::<usize, Value>::new();
    for file in existing {
        let index = file
            .get("index")
            .and_then(Value::as_u64)
            .and_then(|value| usize::try_from(value).ok())
            .unwrap_or(by_index.len());
        by_index.insert(index, file);
    }
    for (index, payload) in filled {
        for mut file in output_files_from_payload(&payload) {
            if let Value::Object(object) = &mut file {
                object.insert("index".to_string(), json!(index));
            }
            by_index.insert(index, file);
        }
    }
    by_index.into_values().collect()
}

fn fill_missing_job(job_id: &str) -> Result<Value, String> {
    let job = show_history_job(job_id).map_err(app_error)?;
    let metadata = job.get("metadata").cloned().unwrap_or_else(|| json!({}));
    let job_dir =
        recovery_job_dir(&metadata).ok_or_else(|| "Recovery job dir is missing.".to_string())?;
    let mut missing = missing_generation_slot_indices(&metadata);
    let total_expected = expected_slot_count(&metadata, &job);
    if missing.is_empty() {
        let existing = existing_output_files(&job)
            .into_iter()
            .filter_map(|file| {
                file.get("index")
                    .and_then(Value::as_u64)
                    .and_then(|value| usize::try_from(value).ok())
            })
            .collect::<std::collections::BTreeSet<_>>();
        missing = (0..total_expected)
            .filter(|index| !existing.contains(index))
            .collect();
    }
    if missing.is_empty() {
        return Err("没有缺失的图片可补齐。".to_string());
    }
    let format = metadata.get("format").and_then(Value::as_str);
    let mut payloads = Vec::<(usize, Value)>::new();
    let mut errors = Vec::<BatchItemError>::new();

    match job.get("command").and_then(Value::as_str) {
        Some("images generate") => {
            let mut request = generate_request_from_job(&job)?;
            request.n = Some(1);
            for index in &missing {
                let slot =
                    u8::try_from(*index).map_err(|_| "缺失图片序号超出范围。".to_string())?;
                let child_id = batch_recovery_job_id(job_id, slot);
                let child_dir = batch_recovery_job_dir(&job_dir, slot);
                let out = batch_output_path(&job_dir, request.format.as_deref().or(format), slot);
                match cli_json_result(&generate_args_with_recovery(
                    &request,
                    &out,
                    false,
                    Some((child_id.as_str(), child_dir.as_path())),
                )) {
                    Ok(payload) => payloads.push((*index, payload)),
                    Err(message) => errors.push(BatchItemError {
                        index: *index,
                        message,
                    }),
                }
            }
        }
        Some("images edit") => {
            let mut request = edit_request_from_job(job_id, &job)?;
            request.n = Some(1);
            let (ref_paths, mask_path, edit_region_mode) = write_edit_inputs(&request, &job_dir)?;
            for index in &missing {
                let slot =
                    u8::try_from(*index).map_err(|_| "缺失图片序号超出范围。".to_string())?;
                let child_id = batch_recovery_job_id(job_id, slot);
                let child_dir = batch_recovery_job_dir(&job_dir, slot);
                let out = batch_output_path(&job_dir, request.format.as_deref().or(format), slot);
                match cli_json_result(&edit_args_with_recovery(
                    &request,
                    &ref_paths,
                    if edit_region_mode == "native-mask" {
                        mask_path.as_deref()
                    } else {
                        None
                    },
                    &out,
                    false,
                    Some((child_id.as_str(), child_dir.as_path())),
                )) {
                    Ok(payload) => payloads.push((*index, payload)),
                    Err(message) => errors.push(BatchItemError {
                        index: *index,
                        message,
                    }),
                }
            }
        }
        _ => return Err("这个任务类型暂不支持补齐缺失图片。".to_string()),
    }

    let files = merge_output_files(existing_output_files(&job), payloads);
    let error_items = batch_errors_json(&errors);
    let child_dirs = (0..total_expected)
        .map(|index| batch_recovery_job_dir(&job_dir, index as u8))
        .collect::<Vec<_>>();
    let error_values = error_items.as_array().cloned().unwrap_or_default();
    let generation_slots =
        generation_slots_from_outputs(total_expected, &files, &error_values, &child_dirs);
    let failures = errors.len();
    write_batch_recovery_summary(
        job_id,
        &job_dir,
        &child_dirs,
        files.len(),
        failures,
        generation_slots,
    )
    .map_err(app_error)?;

    let output = normalize_batch_output(files.clone());
    let status = if failures == 0 && files.len() >= total_expected {
        "completed"
    } else if !files.is_empty() {
        "partial_failed"
    } else {
        "failed"
    };
    let mut merged_metadata = merge_recovery_metadata(metadata, &job_dir);
    let error = if failures == 0 {
        Value::Null
    } else {
        json!({
            "code": if files.is_empty() { "batch_failed" } else { "batch_partial_failed" },
            "message": batch_error_summary(&errors).unwrap_or_else(|| "Batch request failed.".to_string()),
            "items": error_items,
        })
    };
    if let Value::Object(map) = &mut merged_metadata {
        map.insert(
            "batch".to_string(),
            json!({
                "mode": "fill_missing",
                "request_count": total_expected,
                "success_count": files.len(),
                "failure_count": failures,
                "errors": error.get("items").cloned().unwrap_or_else(|| json!([])),
            }),
        );
        if failures == 0 {
            map.remove("error");
            map.insert("stage".to_string(), json!("completed"));
        } else {
            map.insert("error".to_string(), error.clone());
        }
    }
    let output_path = output
        .get("path")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let recovered = job_snapshot(JobSnapshotInput {
        id: job_id,
        command: job
            .get("command")
            .and_then(Value::as_str)
            .unwrap_or("images generate"),
        provider: job
            .get("provider")
            .and_then(Value::as_str)
            .unwrap_or("unknown"),
        status,
        created_at: job
            .get("created_at")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        metadata: merged_metadata,
        output_path,
        outputs: json!(files),
        error,
    });
    let job = if matches!(status, "completed" | "partial_failed") {
        upload_completed_job_outputs(&recovered)?
    } else {
        persist_job(&recovered)?;
        recovered
    };
    let event = next_recovery_event(
        job_id,
        terminal_event_type(Some(status)),
        completed_event_data(&job),
    );
    Ok(json!({
        "job_id": job_id,
        "job": job,
        "events": [event],
        "recovered": status == "completed",
    }))
}

fn reupload_job(job_id: &str) -> Result<Value, String> {
    let job = show_history_job(job_id).map_err(app_error)?;
    let outputs = job
        .get("outputs")
        .and_then(Value::as_array)
        .filter(|outputs| !outputs.is_empty())
        .ok_or_else(|| "这个任务没有可重新上传的本地输出。".to_string())?;
    if outputs.is_empty() {
        return Err("这个任务没有可重新上传的本地输出。".to_string());
    }
    let uploaded = upload_completed_job_outputs(&job)?;
    let storage_status = uploaded
        .get("storage_status")
        .and_then(Value::as_str)
        .unwrap_or("not_configured")
        .to_string();
    let event = next_recovery_event(
        job_id,
        "job.storage",
        json!({
            "status": storage_status.clone(),
            "job": uploaded,
        }),
    );
    if matches!(storage_status.as_str(), "failed" | "partial_failed") {
        return Err(format!("重新上传未完成，当前存储状态为 {storage_status}。"));
    }
    Ok(json!({
        "job_id": job_id,
        "job": uploaded,
        "events": [event],
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
