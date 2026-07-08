#![allow(unused_imports)]

use super::*;
pub(crate) use gpt_image_2_runtime::{
    QueueRuntimeHooks, completed_event_data, completed_job_for_queue, failed_job_for_queue,
    storage_overrides_from_job, uploading_job_for_queue,
};

#[derive(Clone)]
struct TauriQueueHooks {
    app: tauri::AppHandle,
}

impl QueueRuntimeHooks for TauriQueueHooks {
    fn emit_queue_event(&self, job_id: &str, event: &Value) {
        emit_queue_event(&self.app, job_id, event);
    }

    fn run_queued_task(
        &self,
        inner: Arc<Mutex<JobQueueInner>>,
        queued: QueuedJob,
    ) -> Result<Value, Value> {
        let stream = StreamContext {
            app: self.app.clone(),
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

pub(crate) fn spawn_notification_dispatch(
    app: tauri::AppHandle,
    state: JobQueueState,
    job_id: String,
    job: Value,
) {
    gpt_image_2_runtime::spawn_notification_dispatch(
        state.inner.clone(),
        TauriQueueHooks { app },
        job_id,
        job,
    );
}

pub(crate) fn start_queued_jobs(app: tauri::AppHandle, state: JobQueueState) {
    gpt_image_2_runtime::start_queued_jobs(state.inner.clone(), TauriQueueHooks { app });
}

pub(crate) fn enqueue_job(
    app: tauri::AppHandle,
    state: JobQueueState,
    queued: QueuedJob,
) -> Result<Value, String> {
    gpt_image_2_runtime::enqueue_job(state.inner.clone(), TauriQueueHooks { app }, queued)
}
