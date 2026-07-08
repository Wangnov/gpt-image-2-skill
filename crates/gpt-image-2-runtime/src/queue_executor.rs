use std::{
    sync::{Arc, Mutex},
    thread,
};

use gpt_image_2_core::{LogLevel, log_event};
use serde_json::{Value, json};

use crate::{
    JobQueueInner, JobSnapshotInput, QueuedJob, append_queue_event, cleanup_child_history,
    completed_event_data, completed_job_for_queue, failed_job_for_queue, job_snapshot, persist_job,
    queue_snapshot_locked, terminal_event_type, terminal_status_runs_storage_upload,
    uploading_job_for_queue,
};

pub trait QueueRuntimeHooks: Clone + Send + Sync + 'static {
    fn emit_queue_event(&self, job_id: &str, event: &Value);
    fn run_queued_task(
        &self,
        inner: Arc<Mutex<JobQueueInner>>,
        queued: QueuedJob,
    ) -> Result<Value, Value>;
    fn upload_completed_job_outputs(&self, job: &Value) -> Result<Value, String>;
    fn dispatch_notifications_for_job(&self, job: &Value) -> Vec<Value>;
}

pub fn append_terminal_queue_event<H: QueueRuntimeHooks>(
    inner: &Arc<Mutex<JobQueueInner>>,
    hooks: &H,
    job_id: &str,
    event_type: &str,
    event_data: Value,
) {
    let event = match inner.lock() {
        Ok(mut inner) => append_queue_event(&mut inner, job_id, "local", event_type, event_data),
        Err(_) => return,
    };
    hooks.emit_queue_event(job_id, &event);
}

pub fn finish_queued_job<H: QueueRuntimeHooks>(
    inner: Arc<Mutex<JobQueueInner>>,
    hooks: H,
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
            let (log_level, log_type) = match event_type {
                "job.failed" => (LogLevel::Error, "job.failed"),
                "job.partial_failed" => (LogLevel::Warn, "job.partial_failed"),
                "job.cancelled" => (LogLevel::Info, "job.cancelled"),
                _ => (LogLevel::Info, "job.completed"),
            };
            let mut log_data = json!({
                "job_id": queued.id.clone(),
                "command": queued.command.clone(),
                "provider": queued.provider.clone(),
                "status": status.unwrap_or("completed"),
            });
            if matches!(event_type, "job.failed" | "job.partial_failed")
                && let Some(error) = job.get("error").filter(|value| !value.is_null())
            {
                log_data["error"] = error.clone();
            }
            log_event(log_level, "local", log_type, log_data);
            (job, event_type, data, completed)
        }
        Err(error) => {
            log_event(
                LogLevel::Error,
                "local",
                "job.failed",
                json!({
                    "job_id": queued.id.clone(),
                    "command": queued.command.clone(),
                    "provider": queued.provider.clone(),
                    "error": error,
                }),
            );
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
        let mut inner = match inner.lock() {
            Ok(inner) => inner,
            Err(_) => return,
        };
        inner.running = inner.running.saturating_sub(1);
    }
    if completed {
        spawn_storage_upload_then_notify(inner.clone(), hooks.clone(), queued.id, job);
    } else {
        append_terminal_queue_event(&inner, &hooks, &queued.id, event_type, event_data);
        spawn_notification_dispatch(inner.clone(), hooks.clone(), queued.id, job);
    }
    start_queued_jobs(inner, hooks);
}

pub fn spawn_storage_upload_then_notify<H: QueueRuntimeHooks>(
    inner: Arc<Mutex<JobQueueInner>>,
    hooks: H,
    job_id: String,
    job: Value,
) {
    thread::spawn(move || {
        let notify_job = match hooks.upload_completed_job_outputs(&job) {
            Ok(job) => job,
            Err(error) => {
                eprintln!("storage upload failed before notification dispatch: {error}");
                job.clone()
            }
        };
        let event = match inner.lock() {
            Ok(mut inner) => append_queue_event(
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
            ),
            Err(_) => return,
        };
        hooks.emit_queue_event(&job_id, &event);
        append_terminal_queue_event(
            &inner,
            &hooks,
            &job_id,
            terminal_event_type(notify_job.get("status").and_then(Value::as_str)),
            completed_event_data(&notify_job),
        );
        spawn_notification_dispatch(inner, hooks, job_id, notify_job);
    });
}

pub fn spawn_notification_dispatch<H: QueueRuntimeHooks>(
    inner: Arc<Mutex<JobQueueInner>>,
    hooks: H,
    job_id: String,
    job: Value,
) {
    thread::spawn(move || {
        let deliveries = hooks.dispatch_notifications_for_job(&job);
        if deliveries.is_empty() {
            return;
        }
        let event = match inner.lock() {
            Ok(mut inner) => append_queue_event(
                &mut inner,
                &job_id,
                "local",
                "job.notifications",
                json!({ "deliveries": deliveries }),
            ),
            Err(_) => return,
        };
        hooks.emit_queue_event(&job_id, &event);
    });
}

pub fn start_queued_jobs<H: QueueRuntimeHooks>(inner: Arc<Mutex<JobQueueInner>>, hooks: H) {
    loop {
        let (queued, event, running_job) = {
            let mut inner = match inner.lock() {
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
            let event = append_queue_event(
                &mut inner,
                &queued.id,
                "local",
                "job.running",
                json!({"status": "running"}),
            );
            (queued, event, running_job)
        };
        let _ = persist_job(&running_job);
        hooks.emit_queue_event(&queued.id, &event);
        log_event(
            LogLevel::Info,
            "local",
            "job.started",
            json!({
                "job_id": queued.id.clone(),
                "command": queued.command.clone(),
                "provider": queued.provider.clone(),
            }),
        );
        let worker_inner = inner.clone();
        let worker_hooks = hooks.clone();
        thread::spawn(move || {
            let result = worker_hooks.run_queued_task(worker_inner.clone(), queued.clone());
            finish_queued_job(worker_inner, worker_hooks, queued, result);
        });
    }
}

pub fn enqueue_job<H: QueueRuntimeHooks>(
    inner: Arc<Mutex<JobQueueInner>>,
    hooks: H,
    queued: QueuedJob,
) -> Result<Value, String> {
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
        let mut inner = inner
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
    hooks.emit_queue_event(&job_id, &event);
    start_queued_jobs(inner, hooks);
    Ok(json!({
        "job_id": job_id,
        "job": job,
        "events": [event],
        "queue": queue,
        "queued": true,
    }))
}
