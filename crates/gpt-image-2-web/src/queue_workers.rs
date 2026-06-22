#![allow(unused_imports)]

use super::*;

pub(crate) fn completed_job_for_queue(queued: &QueuedJob, response: &Value) -> Value {
    let metadata = merge_recovery_metadata(queued.metadata.clone(), &queued.dir);
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
        status: payload
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("completed"),
        created_at: &queued.created_at,
        metadata,
        output_path,
        outputs,
        error: payload.get("error").cloned().unwrap_or(Value::Null),
    })
}

pub(crate) fn uploading_job_for_queue(queued: &QueuedJob, response: &Value) -> Value {
    let metadata = merge_recovery_metadata(queued.metadata.clone(), &queued.dir);
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
        metadata,
        output_path,
        outputs,
        error: Value::Null,
    })
}

pub(crate) fn failed_job_for_queue(queued: &QueuedJob, error: Value) -> Value {
    let mut metadata = merge_recovery_metadata(queued.metadata.clone(), &queued.dir);
    if let Value::Object(map) = &mut metadata {
        map.insert("error".to_string(), error.clone());
    }
    job_snapshot(JobSnapshotInput {
        id: &queued.id,
        command: &queued.command,
        provider: &queued.provider,
        status: "failed",
        created_at: &queued.created_at,
        metadata,
        output_path: None,
        outputs: json!([]),
        error,
    })
}

pub(crate) fn completed_event_data(job: &Value) -> Value {
    let status = job
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("completed");
    json!({
        "status": status,
        "output": {
            "path": job.get("output_path").cloned().unwrap_or(Value::Null),
            "files": job.get("outputs").cloned().unwrap_or_else(|| json!([])),
        },
        "error": job.get("error").cloned().unwrap_or(Value::Null),
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
    result: Result<Value, Value>,
) {
    let (job, event_type, event_data, completed) = match result {
        Ok(response) => {
            let payload = response.get("payload").unwrap_or(&response);
            cleanup_child_history(payload, &queued.id);
            let job = completed_job_for_queue(&queued, &response);
            let data = completed_event_data(&job);
            let status = job.get("status").and_then(Value::as_str);
            let event_type = terminal_event_type(status);
            let completed = terminal_status_runs_storage_upload(status);
            if completed {
                let uploading_job = uploading_job_for_queue(&queued, &response);
                let _ = persist_job(&uploading_job);
            }
            (job, event_type, data, completed)
        }
        Err(error) => {
            let job = failed_job_for_queue(&queued, error.clone());
            (
                job,
                "job.failed",
                json!({
                    "status": "failed",
                    "error": error,
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
    let job_id = job
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "Job id is missing.".to_string())?;
    let config = load_config()?;
    let overrides = storage_overrides_from_job(job);
    let upload_result = upload_job_outputs_to_storage(&config.storage, job, overrides)
        .map_err(app_error)
        .map(|_| ())
        .map_err(|error| format!("Storage upload failed: {error}"));
    let enriched = show_history_job(job_id).map_err(app_error)?;
    if let Err(error) = upload_result {
        eprintln!("storage upload failed before notification dispatch: {error}");
    }
    Ok(enriched)
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
            terminal_event_type(notify_job.get("status").and_then(Value::as_str)),
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

#[cfg(test)]
mod tests {
    use std::path::Path;
    use std::sync::Mutex;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    use gpt_image_2_core::WebhookNotificationConfig;

    use super::*;

    static QUEUE_WORKER_TEST_LOCK: Mutex<()> = Mutex::new(());

    struct EnvGuard {
        key: &'static str,
        old: Option<std::ffi::OsString>,
    }

    impl EnvGuard {
        fn set(key: &'static str, value: &Path) -> Self {
            let old = std::env::var_os(key);
            unsafe {
                std::env::set_var(key, value);
            }
            Self { key, old }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            unsafe {
                if let Some(value) = &self.old {
                    std::env::set_var(self.key, value);
                } else {
                    std::env::remove_var(self.key);
                }
            }
        }
    }

    fn failed_batch_response() -> Value {
        json!({
            "payload": {
                "ok": false,
                "status": "failed",
                "output": {
                    "path": null,
                    "files": []
                },
                "error": {
                    "code": "batch_failed",
                    "message": "candidate A failed"
                }
            }
        })
    }

    fn queued_job(id: &str) -> QueuedJob {
        QueuedJob {
            id: id.to_string(),
            command: "images generate".to_string(),
            provider: "mock".to_string(),
            created_at: "2026-05-13T17:23:00Z".to_string(),
            dir: PathBuf::from("/tmp"),
            metadata: json!({"prompt": "test"}),
            task: QueuedTask::Generate(GenerateRequest {
                prompt: "test".to_string(),
                provider: Some("mock".to_string()),
                size: None,
                format: None,
                quality: None,
                background: None,
                n: Some(2),
                compression: None,
                moderation: None,
                storage_targets: None,
                fallback_targets: None,
            }),
        }
    }

    #[test]
    fn failed_job_for_queue_preserves_structured_error_with_detail() {
        // P0 regression: a single-output provider failure must keep the full
        // JobError (code/message/detail) on both `job.error` and
        // `metadata.error` instead of being flattened to `{ message }`.
        let queued = queued_job("job-network-failure");
        let error = json!({
            "code": "network_error",
            "message": "OpenAI request failed.",
            "detail": { "error": "error sending request: connection refused" },
        });
        let job = failed_job_for_queue(&queued, error.clone());

        assert_eq!(job["status"], "failed");
        assert_eq!(job["error"], error);
        assert_eq!(job["error"]["code"], "network_error");
        assert_eq!(
            job["error"]["detail"]["error"],
            "error sending request: connection refused"
        );
        assert_eq!(job["metadata"]["error"], error);
    }

    #[test]
    fn finish_queued_job_keeps_ok_failed_payload_on_failed_path() {
        let _guard = QUEUE_WORKER_TEST_LOCK.lock().unwrap();
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let temp_dir =
            std::env::temp_dir().join(format!("gpt-image-2-web-queue-worker-test-{suffix}"));
        fs::create_dir_all(&temp_dir).unwrap();
        let config_path = temp_dir.join("config.json");
        let history_path = temp_dir.join("history.sqlite");
        let _config_env = EnvGuard::set(gpt_image_2_core::PRODUCT_CONFIG_FILE_ENV, &config_path);
        let _history_env = EnvGuard::set(gpt_image_2_core::PRODUCT_HISTORY_FILE_ENV, &history_path);

        let mut config = AppConfig::default();
        config.notifications.webhooks = vec![WebhookNotificationConfig {
            id: "invalid-webhook".to_string(),
            name: "Invalid webhook".to_string(),
            enabled: true,
            url: "not-a-url".to_string(),
            method: "POST".to_string(),
            headers: BTreeMap::new(),
            timeout_seconds: 1,
        }];
        save_config(&config).unwrap();

        let state = JobQueueState::default();
        {
            let mut inner = state.inner.lock().unwrap();
            inner.running = 1;
        }

        finish_queued_job(
            state.clone(),
            queued_job("job-batch-failed"),
            Ok(failed_batch_response()),
        );

        let job = show_history_job("job-batch-failed").unwrap();
        assert_eq!(job["status"], "failed");
        assert_eq!(job["error"]["code"], "batch_failed");

        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            let has_notification = {
                let inner = state.inner.lock().unwrap();
                let events = inner
                    .events
                    .get("job-batch-failed")
                    .cloned()
                    .unwrap_or_default();
                assert!(events.iter().any(|event| event["type"] == "job.failed"));
                assert!(!events.iter().any(|event| event["type"] == "job.storage"));
                events
                    .iter()
                    .any(|event| event["type"] == "job.notifications")
            };
            if has_notification {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "timed out waiting for failed notification dispatch"
            );
            std::thread::sleep(Duration::from_millis(10));
        }

        let inner = state.inner.lock().unwrap();
        let events = inner.events.get("job-batch-failed").unwrap();
        assert_eq!(events[0]["type"], "job.failed");
        assert_eq!(events[0]["data"]["status"], "failed");
        assert_eq!(events[0]["data"]["error"]["code"], "batch_failed");
        let notification = events
            .iter()
            .find(|event| event["type"] == "job.notifications")
            .unwrap();
        assert_eq!(
            notification["data"]["deliveries"][0]["name"],
            "Invalid webhook"
        );
        assert_eq!(notification["data"]["deliveries"][0]["ok"], false);

        let _ = fs::remove_dir_all(temp_dir);
    }
}
