#![allow(unused_imports)]

use super::*;

pub(crate) fn completed_job_for_queue(queued: &QueuedJob, response: &Value) -> Value {
    let payload = response.get("payload").unwrap_or(response);
    let provider = payload
        .get("provider")
        .and_then(Value::as_str)
        .unwrap_or(&queued.provider);
    let outputs = payload
        .get("output")
        .and_then(|output| output.get("files"))
        .cloned()
        .or_else(|| {
            response
                .get("job")
                .and_then(|job| job.get("outputs"))
                .cloned()
        })
        .unwrap_or_else(|| json!([]));
    let output_path = output_path_from_payload(payload).or_else(|| {
        response
            .get("job")
            .and_then(|job| job.get("output_path"))
            .and_then(Value::as_str)
            .map(ToString::to_string)
    });
    job_snapshot(JobSnapshotInput {
        id: &queued.id,
        command: &queued.command,
        provider,
        status: "completed",
        created_at: &queued.created_at,
        metadata: queued.metadata.clone(),
        output_path,
        outputs,
        error: Value::Null,
    })
}

pub(crate) fn uploading_job_for_queue(queued: &QueuedJob, response: &Value) -> Value {
    let payload = response.get("payload").unwrap_or(response);
    let provider = payload
        .get("provider")
        .and_then(Value::as_str)
        .unwrap_or(&queued.provider);
    let outputs = payload
        .get("output")
        .and_then(|output| output.get("files"))
        .cloned()
        .or_else(|| {
            response
                .get("job")
                .and_then(|job| job.get("outputs"))
                .cloned()
        })
        .unwrap_or_else(|| json!([]));
    let output_path = output_path_from_payload(payload).or_else(|| {
        response
            .get("job")
            .and_then(|job| job.get("output_path"))
            .and_then(Value::as_str)
            .map(ToString::to_string)
    });
    job_snapshot(JobSnapshotInput {
        id: &queued.id,
        command: &queued.command,
        provider,
        status: "uploading",
        created_at: &queued.created_at,
        metadata: queued.metadata.clone(),
        output_path,
        outputs,
        error: Value::Null,
    })
}

pub(crate) fn failed_job_for_queue(queued: &QueuedJob, message: String) -> Value {
    job_snapshot(JobSnapshotInput {
        id: &queued.id,
        command: &queued.command,
        provider: &queued.provider,
        status: "failed",
        created_at: &queued.created_at,
        metadata: queued.metadata.clone(),
        output_path: None,
        outputs: json!([]),
        error: json!({"message": message}),
    })
}

pub(crate) fn completed_event_data(job: &Value) -> Value {
    json!({
        "status": "completed",
        "output": {
            "path": job.get("output_path").cloned().unwrap_or(Value::Null),
            "files": job.get("outputs").cloned().unwrap_or_else(|| json!([])),
        },
        "job": job,
    })
}

pub(crate) fn append_terminal_queue_event(
    state: &JobQueueState,
    job_id: &str,
    event_type: &str,
    event_data: Value,
) {
    if let Ok(mut inner) = state.inner.lock() {
        append_queue_event(&mut inner, job_id, "local", event_type, event_data);
    }
}

pub(crate) fn finish_queued_job(
    state: JobQueueState,
    queued: QueuedJob,
    result: Result<Value, String>,
) {
    let (job, event_type, event_data, completed) = match result {
        Ok(response) => {
            let payload = response.get("payload").unwrap_or(&response);
            cleanup_child_history(payload, &queued.id);
            let job = completed_job_for_queue(&queued, &response);
            let uploading_job = uploading_job_for_queue(&queued, &response);
            let _ = persist_job(&uploading_job);
            let data = completed_event_data(&job);
            (job, "job.completed", data, true)
        }
        Err(message) => {
            let job = failed_job_for_queue(&queued, message.clone());
            (
                job,
                "job.failed",
                json!({
                    "status": "failed",
                    "error": {"message": message},
                }),
                false,
            )
        }
    };
    if !completed {
        let _ = persist_job(&job);
    }
    {
        let mut inner = match state.inner.lock() {
            Ok(inner) => inner,
            Err(_) => return,
        };
        inner.running = inner.running.saturating_sub(1);
    }
    if completed {
        spawn_storage_upload_then_notify(state.clone(), queued.id, job);
    } else {
        append_terminal_queue_event(&state, &queued.id, event_type, event_data);
        spawn_notification_dispatch(state.clone(), queued.id, job);
    }
    start_queued_jobs(state);
}

pub(crate) fn storage_overrides_from_job(job: &Value) -> StorageUploadOverrides {
    let metadata = job.get("metadata").cloned().unwrap_or_else(|| json!({}));
    StorageUploadOverrides {
        targets: metadata.get("storage_targets").and_then(|targets| {
            targets.as_array().map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
            })
        }),
        fallback_targets: metadata.get("fallback_targets").and_then(|targets| {
            targets.as_array().map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
            })
        }),
    }
}

pub(crate) fn upload_completed_job_outputs(job: &Value) -> Result<Value, String> {
    let _ = persist_job(job);
    let config = load_config()?;
    let overrides = storage_overrides_from_job(job);
    upload_job_outputs_to_storage(&config.storage, job, overrides)
        .map_err(app_error)
        .map(|_| ())
        .map_err(|error| format!("Storage upload failed: {error}"))?;
    let job_id = job
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "Job id is missing.".to_string())?;
    show_history_job(job_id).map_err(app_error)
}

pub(crate) fn spawn_storage_upload_then_notify(state: JobQueueState, job_id: String, job: Value) {
    thread::spawn(move || {
        let notify_job = match upload_completed_job_outputs(&job) {
            Ok(job) => job,
            Err(error) => {
                eprintln!("storage upload failed before notification dispatch: {error}");
                job.clone()
            }
        };
        if let Ok(mut inner) = state.inner.lock() {
            append_queue_event(
                &mut inner,
                &job_id,
                "local",
                "job.storage",
                json!({
                    "status": notify_job
                        .get("storage_status")
                        .cloned()
                        .unwrap_or_else(|| json!("not_configured")),
                    "job": notify_job,
                }),
            );
        }
        append_terminal_queue_event(
            &state,
            &job_id,
            "job.completed",
            completed_event_data(&notify_job),
        );
        spawn_notification_dispatch(state, job_id, notify_job);
    });
}

// Notification I/O (SMTP, webhooks) is blocking and may take seconds. Run it
// off the worker thread so it cannot occupy a queue slot or stall finalization.
pub(crate) fn spawn_notification_dispatch(state: JobQueueState, job_id: String, job: Value) {
    thread::spawn(move || {
        let deliveries = dispatch_notifications_for_job(&job);
        if deliveries.is_empty() {
            return;
        }
        if let Ok(mut inner) = state.inner.lock() {
            append_queue_event(
                &mut inner,
                &job_id,
                "local",
                "job.notifications",
                json!({ "deliveries": deliveries }),
            );
        }
    });
}

pub(crate) fn start_queued_jobs(state: JobQueueState) {
    loop {
        let (queued, running_job) = {
            let mut inner = match state.inner.lock() {
                Ok(inner) => inner,
                Err(_) => return,
            };
            if inner.running >= inner.max_parallel {
                return;
            }
            let Some(queued) = inner.queue.pop_front() else {
                return;
            };
            inner.running += 1;
            let running_job = job_snapshot(JobSnapshotInput {
                id: &queued.id,
                command: &queued.command,
                provider: &queued.provider,
                status: "running",
                created_at: &queued.created_at,
                metadata: queued.metadata.clone(),
                output_path: None,
                outputs: json!([]),
                error: Value::Null,
            });
            append_queue_event(
                &mut inner,
                &queued.id,
                "local",
                "job.running",
                json!({"status": "running"}),
            );
            (queued, running_job)
        };
        let _ = persist_job(&running_job);
        let worker_state = state.clone();
        thread::spawn(move || {
            let stream = StreamContext {
                state: worker_state.clone(),
                job_id: queued.id.clone(),
                command: queued.command.clone(),
                provider: queued.provider.clone(),
                created_at: queued.created_at.clone(),
                metadata: queued.metadata.clone(),
            };
            let result = match queued.task.clone() {
                QueuedTask::Generate(request) => run_generate_request(
                    request,
                    queued.id.clone(),
                    queued.dir.clone(),
                    Some(stream),
                ),
                QueuedTask::Edit(request) => {
                    run_edit_request(request, queued.id.clone(), queued.dir.clone(), Some(stream))
                }
            };
            finish_queued_job(worker_state, queued, result);
        });
    }
}

pub(crate) fn enqueue_job(state: JobQueueState, queued: QueuedJob) -> Result<Value, String> {
    let job = job_snapshot(JobSnapshotInput {
        id: &queued.id,
        command: &queued.command,
        provider: &queued.provider,
        status: "queued",
        created_at: &queued.created_at,
        metadata: queued.metadata.clone(),
        output_path: None,
        outputs: json!([]),
        error: Value::Null,
    });
    persist_job(&job)?;
    let job_id = queued.id.clone();
    let (event, queue) = {
        let mut inner = state
            .inner
            .lock()
            .map_err(|_| "Job queue lock was poisoned.".to_string())?;
        inner.queue.push_back(queued);
        let position = inner.queue.len();
        let event = append_queue_event(
            &mut inner,
            &job_id,
            "local",
            "job.queued",
            json!({"status": "queued", "position": position}),
        );
        let queue = queue_snapshot_locked(&inner);
        (event, queue)
    };
    start_queued_jobs(state);
    Ok(json!({
        "job_id": job_id,
        "job": job,
        "events": [event],
        "queue": queue,
        "queued": true,
    }))
}
