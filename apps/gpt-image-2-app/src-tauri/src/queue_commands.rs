#![allow(unused_imports)]

use super::*;

#[tauri::command]
pub(crate) fn queue_status(state: tauri::State<'_, JobQueueState>) -> Result<Value, String> {
    let inner = state
        .inner
        .lock()
        .map_err(|_| "Job queue lock was poisoned.".to_string())?;
    Ok(queue_snapshot_locked(&inner))
}

#[tauri::command]
pub(crate) fn set_queue_concurrency(
    max_parallel: usize,
    app: tauri::AppHandle,
    state: tauri::State<'_, JobQueueState>,
) -> Result<Value, String> {
    let max_parallel = max_parallel.clamp(1, 8);
    let queue_state = state.inner().clone();
    let queue = {
        let mut inner = queue_state
            .inner
            .lock()
            .map_err(|_| "Job queue lock was poisoned.".to_string())?;
        inner.max_parallel = max_parallel;
        queue_snapshot_locked(&inner)
    };
    start_queued_jobs(app, queue_state);
    Ok(queue)
}

#[tauri::command]
pub(crate) fn cancel_job(
    job_id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, JobQueueState>,
) -> Result<Value, String> {
    let queue_state = state.inner().clone();
    let (queued, event) = {
        let mut inner = queue_state
            .inner
            .lock()
            .map_err(|_| "Job queue lock was poisoned.".to_string())?;
        let Some(position) = inner.queue.iter().position(|job| job.id == job_id) else {
            return Err("Only queued jobs can be canceled for now.".to_string());
        };
        let queued = inner
            .queue
            .remove(position)
            .ok_or_else(|| "Queued job was not found.".to_string())?;
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
    persist_job(&job)?;
    emit_queue_event(&app, &job_id, &event);
    spawn_notification_dispatch(app.clone(), queue_state, job_id.clone(), job.clone());
    Ok(json!({
        "job_id": job_id,
        "job": job,
        "events": [{
            "seq": event.get("seq").cloned().unwrap_or(Value::Null),
            "kind": event.get("kind").cloned().unwrap_or(Value::Null),
            "type": event.get("type").cloned().unwrap_or(Value::Null),
            "data": {
                "status": "canceled",
            }
        }],
        "canceled": true,
    }))
}
