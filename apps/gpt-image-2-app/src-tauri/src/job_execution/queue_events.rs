#![allow(unused_imports)]

use super::*;

pub(crate) use gpt_image_2_runtime::{
    append_queue_event, queue_snapshot_locked, terminal_event_type,
    terminal_status_runs_storage_upload,
};

pub(crate) fn emit_queue_event(app: &tauri::AppHandle, job_id: &str, event: &Value) {
    let _ = app.emit(
        "gpt-image-2-job-event",
        json!({
            "job_id": job_id,
            "event": event,
        }),
    );
}
