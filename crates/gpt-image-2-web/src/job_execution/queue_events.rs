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
