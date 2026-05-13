#![allow(unused_imports)]

use super::*;

pub(crate) fn queue_snapshot_locked(inner: &JobQueueInner) -> Value {
    json!({
        "max_parallel": inner.max_parallel,
        "running": inner.running,
        "queued": inner.queue.len(),
        "queued_job_ids": inner.queue.iter().map(|job| job.id.clone()).collect::<Vec<_>>(),
    })
}

pub(crate) fn append_queue_event(
    inner: &mut JobQueueInner,
    job_id: &str,
    kind: &str,
    event_type: &str,
    data: Value,
) -> Value {
    let seq = inner.next_seq.entry(job_id.to_string()).or_insert(0);
    *seq += 1;
    let event = json!({
        "seq": *seq,
        "kind": kind,
        "type": event_type,
        "data": data,
    });
    let events = inner.events.entry(job_id.to_string()).or_default();
    events.push(event.clone());
    if events.len() > 200 {
        events.remove(0);
    }
    event
}

pub(crate) fn terminal_event_type(status: Option<&str>) -> &'static str {
    match status {
        Some("failed") => "job.failed",
        Some("cancelled") | Some("canceled") => "job.cancelled",
        Some("partial_failed") => "job.partial_failed",
        _ => "job.completed",
    }
}

pub(crate) fn terminal_status_runs_storage_upload(status: Option<&str>) -> bool {
    matches!(status, Some("completed") | Some("partial_failed"))
}

pub(crate) fn emit_queue_event(app: &tauri::AppHandle, job_id: &str, event: &Value) {
    let _ = app.emit(
        "gpt-image-2-job-event",
        json!({
            "job_id": job_id,
            "event": event,
        }),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_event_type_tracks_terminal_status() {
        assert_eq!(terminal_event_type(Some("completed")), "job.completed");
        assert_eq!(
            terminal_event_type(Some("partial_failed")),
            "job.partial_failed"
        );
        assert_eq!(terminal_event_type(Some("failed")), "job.failed");
        assert_eq!(terminal_event_type(Some("cancelled")), "job.cancelled");
        assert_eq!(terminal_event_type(Some("canceled")), "job.cancelled");
    }

    #[test]
    fn terminal_storage_upload_skips_failed_and_cancelled_statuses() {
        assert!(terminal_status_runs_storage_upload(Some("completed")));
        assert!(terminal_status_runs_storage_upload(Some("partial_failed")));
        assert!(!terminal_status_runs_storage_upload(Some("failed")));
        assert!(!terminal_status_runs_storage_upload(Some("cancelled")));
        assert!(!terminal_status_runs_storage_upload(Some("canceled")));
        assert!(!terminal_status_runs_storage_upload(Some("running")));
        assert!(!terminal_status_runs_storage_upload(Some("uploading")));
        assert!(!terminal_status_runs_storage_upload(Some("unknown")));
        assert!(!terminal_status_runs_storage_upload(None));
    }
}
