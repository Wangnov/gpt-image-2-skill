#![allow(unused_imports)]

use super::*;

pub(crate) async fn queue_status(State(state): State<JobQueueState>) -> ApiResult {
    let inner = state
        .inner
        .lock()
        .map_err(|_| ApiError::internal("Job queue lock was poisoned."))?;
    Ok(Json(queue_snapshot_locked(&inner)))
}

pub(crate) async fn set_queue_concurrency(
    State(state): State<JobQueueState>,
    Json(body): Json<QueueConcurrencyBody>,
) -> ApiResult {
    let max_parallel = body.max_parallel.clamp(1, 8);
    let queue = {
        let mut inner = state
            .inner
            .lock()
            .map_err(|_| ApiError::internal("Job queue lock was poisoned."))?;
        inner.max_parallel = max_parallel;
        queue_snapshot_locked(&inner)
    };
    start_queued_jobs(state);
    Ok(Json(queue))
}

pub(crate) async fn cancel_job(
    Path(job_id): Path<String>,
    State(state): State<JobQueueState>,
) -> ApiResult {
    let (queued, event) = {
        let mut inner = state
            .inner
            .lock()
            .map_err(|_| ApiError::internal("Job queue lock was poisoned."))?;
        let Some(position) = inner.queue.iter().position(|job| job.id == job_id) else {
            return Err(ApiError::bad_request(
                "Only queued jobs can be canceled for now.",
            ));
        };
        let queued = inner
            .queue
            .remove(position)
            .ok_or_else(|| ApiError::internal("Queued job was not found."))?;
        let event = append_queue_event(
            &mut inner,
            &job_id,
            "local",
            "job.canceled",
            json!({"status": "canceled"}),
        );
        (queued, event)
    };
    let job = job_snapshot(JobSnapshotInput {
        id: &queued.id,
        command: &queued.command,
        provider: &queued.provider,
        status: "canceled",
        created_at: &queued.created_at,
        metadata: queued.metadata,
        output_path: None,
        outputs: json!([]),
        error: Value::Null,
    });
    persist_job(&job).map_err(ApiError::internal)?;
    let notification_deliveries = dispatch_notifications_for_job(&job);
    Ok(Json(json!({
        "job_id": job_id,
        "job": job,
        "events": [{
            "seq": event.get("seq").cloned().unwrap_or(Value::Null),
            "kind": event.get("kind").cloned().unwrap_or(Value::Null),
            "type": event.get("type").cloned().unwrap_or(Value::Null),
            "data": {
                "status": "canceled",
                "notifications": notification_deliveries,
            }
        }],
        "canceled": true,
    })))
}

pub(crate) async fn enqueue_generate_image(
    State(state): State<JobQueueState>,
    Json(request): Json<GenerateRequest>,
) -> ApiResult {
    if request.prompt.trim().is_empty() {
        return Err(ApiError::bad_request("Prompt is required."));
    }
    requested_n(request.n).map_err(ApiError::bad_request)?;
    let (id, dir) = unique_job_dir().map_err(ApiError::internal)?;
    let provider = selected_provider_name(request.provider.as_deref());
    let metadata = serde_json::to_value(&request).unwrap_or_else(|_| json!({}));
    enqueue_job(
        state,
        QueuedJob {
            id,
            command: "images generate".to_string(),
            provider,
            created_at: chrono_like_now(),
            dir,
            metadata,
            task: QueuedTask::Generate(request),
        },
    )
    .map(Json)
    .map_err(ApiError::internal)
}

pub(crate) async fn enqueue_edit_image(
    State(state): State<JobQueueState>,
    Json(request): Json<EditRequest>,
) -> ApiResult {
    if request.prompt.trim().is_empty() {
        return Err(ApiError::bad_request("Prompt is required."));
    }
    if request.refs.is_empty() {
        return Err(ApiError::bad_request(
            "At least one reference image is required.",
        ));
    }
    requested_n(request.n).map_err(ApiError::bad_request)?;
    let (id, dir) = unique_job_dir().map_err(ApiError::internal)?;
    let provider = selected_provider_name(request.provider.as_deref());
    let metadata = edit_request_metadata(&request);
    enqueue_job(
        state,
        QueuedJob {
            id,
            command: "images edit".to_string(),
            provider,
            created_at: chrono_like_now(),
            dir,
            metadata,
            task: QueuedTask::Edit(request),
        },
    )
    .map(Json)
    .map_err(ApiError::internal)
}
