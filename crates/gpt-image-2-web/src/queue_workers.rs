#![allow(unused_imports)]

use super::*;
pub(crate) use gpt_image_2_runtime::{
    QueueRuntimeHooks, completed_event_data, completed_job_for_queue, failed_job_for_queue,
    storage_overrides_from_job, uploading_job_for_queue,
};

#[derive(Clone)]
struct WebQueueHooks;

impl QueueRuntimeHooks for WebQueueHooks {
    fn emit_queue_event(&self, _job_id: &str, _event: &Value) {}

    fn run_queued_task(
        &self,
        inner: Arc<Mutex<JobQueueInner>>,
        queued: QueuedJob,
    ) -> Result<Value, Value> {
        let stream = StreamContext {
            inner,
            job_id: queued.id.clone(),
            command: queued.command.clone(),
            provider: queued.provider.clone(),
            created_at: queued.created_at.clone(),
            metadata: queued.metadata.clone(),
        };
        match queued.task.clone() {
            QueuedTask::Generate(request) => {
                run_generate_request(request, queued.id.clone(), queued.dir.clone(), Some(stream))
            }
            QueuedTask::Edit(request) => {
                run_edit_request(request, queued.id.clone(), queued.dir.clone(), Some(stream))
            }
        }
    }

    fn upload_completed_job_outputs(&self, job: &Value) -> Result<Value, String> {
        upload_completed_job_outputs(job)
    }

    fn dispatch_notifications_for_job(&self, job: &Value) -> Vec<Value> {
        dispatch_notifications_for_job(job)
    }
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn finish_queued_job(
    state: JobQueueState,
    queued: QueuedJob,
    result: Result<Value, Value>,
) {
    gpt_image_2_runtime::finish_queued_job(state.inner.clone(), WebQueueHooks, queued, result);
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

pub(crate) fn start_queued_jobs(state: JobQueueState) {
    gpt_image_2_runtime::start_queued_jobs(state.inner.clone(), WebQueueHooks);
}

pub(crate) fn enqueue_job(state: JobQueueState, queued: QueuedJob) -> Result<Value, String> {
    gpt_image_2_runtime::enqueue_job(state.inner.clone(), WebQueueHooks, queued)
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
