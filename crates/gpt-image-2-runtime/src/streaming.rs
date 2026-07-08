use serde_json::{Value, json};

use crate::{
    JobQueueInner, JobSnapshotInput, append_queue_event, cleanup_child_history,
    collect_history_ids, job_snapshot, output_files_from_payload, persist_job,
};

pub struct PartialOutputContext<'a> {
    pub job_id: &'a str,
    pub command: &'a str,
    pub provider: &'a str,
    pub created_at: &'a str,
    pub metadata: &'a Value,
}

pub fn apply_partial_output(
    inner: &mut JobQueueInner,
    ctx: PartialOutputContext<'_>,
    partials: &mut Vec<Value>,
    batch_index: usize,
    payload: &Value,
) -> Value {
    for id in collect_history_ids(payload) {
        if id != ctx.job_id {
            let _ = gpt_image_2_core::delete_history_job(&id);
        }
    }

    let files = output_files_from_payload(payload);
    for mut file in files {
        if let Value::Object(map) = &mut file {
            map.insert("index".to_string(), json!(batch_index));
        }
        partials.push(file);
    }

    let mut sorted_outputs = partials.clone();
    sorted_outputs.sort_by_key(|value| {
        value
            .get("index")
            .and_then(Value::as_u64)
            .unwrap_or(u64::MAX)
    });
    let first_path = sorted_outputs
        .iter()
        .find(|file| file.get("index").and_then(Value::as_u64) == Some(0))
        .and_then(|file| file.get("path"))
        .and_then(Value::as_str)
        .map(ToString::to_string);

    let parent_snapshot = job_snapshot(JobSnapshotInput {
        id: ctx.job_id,
        command: ctx.command,
        provider: ctx.provider,
        status: "running",
        created_at: ctx.created_at,
        metadata: ctx.metadata.clone(),
        output_path: first_path,
        outputs: json!(sorted_outputs),
        error: Value::Null,
    });
    let _ = persist_job(&parent_snapshot);

    let payload_path = payload
        .get("output")
        .and_then(|output| output.get("path"))
        .cloned()
        .unwrap_or(Value::Null);

    append_queue_event(
        inner,
        ctx.job_id,
        "local",
        "job.output_ready",
        json!({
            "index": batch_index,
            "path": payload_path,
            "job": parent_snapshot,
        }),
    )
}
