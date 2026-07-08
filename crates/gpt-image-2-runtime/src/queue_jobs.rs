use gpt_image_2_core::{StorageUploadOverrides, merge_recovery_metadata};
use serde_json::{Value, json};

use crate::{JobSnapshotInput, QueuedJob, job_snapshot, output_path_from_payload};

pub fn completed_job_for_queue(queued: &QueuedJob, response: &Value) -> Value {
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

pub fn uploading_job_for_queue(queued: &QueuedJob, response: &Value) -> Value {
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

pub fn failed_job_for_queue(queued: &QueuedJob, error: Value) -> Value {
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

pub fn completed_event_data(job: &Value) -> Value {
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

pub fn storage_overrides_from_job(job: &Value) -> StorageUploadOverrides {
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
