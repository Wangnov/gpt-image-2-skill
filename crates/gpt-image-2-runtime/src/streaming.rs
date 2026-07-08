#![allow(unused_imports)]

use super::*;
use std::sync::{Arc, Mutex, mpsc};
use std::thread;

#[derive(Clone)]
pub struct StreamContext {
    pub inner: Arc<Mutex<JobQueueInner>>,
    pub host: Arc<dyn RuntimeHost>,
    pub job_id: String,
    pub command: String,
    pub provider: String,
    pub created_at: String,
    pub metadata: Value,
}

#[derive(Debug, Clone)]
pub struct BatchItemError {
    pub index: usize,
    pub code: Option<String>,
    pub message: String,
    pub detail: Option<Value>,
}

impl BatchItemError {
    /// Build a structured per-slot error from a JobError-shaped `Value`
    /// (`{ code, message, detail }`) as produced by `cli_json_result`, keeping
    /// `code`/`detail` so the merged payload's `error.items[*]` stay rich.
    pub fn from_error_value(index: usize, error: Value) -> Self {
        Self {
            index,
            code: error
                .get("code")
                .and_then(Value::as_str)
                .map(ToString::to_string),
            message: error_message_from_value(&error),
            detail: error.get("detail").cloned(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct BatchRunResult {
    pub payloads: Vec<(usize, Value)>,
    pub errors: Vec<BatchItemError>,
}

pub fn run_payloads_concurrently_streaming(
    arg_sets: Vec<Vec<String>>,
    mut on_partial: impl FnMut(usize, &Value),
) -> BatchRunResult {
    let total = arg_sets.len();
    if total == 0 {
        return BatchRunResult {
            payloads: Vec::new(),
            errors: Vec::new(),
        };
    }
    let (tx, rx) = mpsc::channel::<(usize, Result<Value, Value>)>();
    for (index, args) in arg_sets.into_iter().enumerate() {
        let tx = tx.clone();
        thread::spawn(move || {
            let result = cli_json_result(&args);
            let _ = tx.send((index, result));
        });
    }
    drop(tx);
    let mut results: Vec<Option<Value>> = (0..total).map(|_| None).collect();
    let mut errors = Vec::new();
    let mut received = 0usize;
    while received < total {
        match rx.recv() {
            Ok((index, Ok(payload))) => {
                on_partial(index, &payload);
                results[index] = Some(payload);
            }
            Ok((index, Err(error))) => errors.push(BatchItemError::from_error_value(index, error)),
            Err(_) => break,
        }
        received += 1;
    }
    BatchRunResult {
        payloads: results
            .into_iter()
            .enumerate()
            .filter_map(|(index, payload)| payload.map(|payload| (index, payload)))
            .collect(),
        errors,
    }
}

pub fn apply_partial_output(
    ctx: &StreamContext,
    partials: &mut Vec<Value>,
    batch_index: usize,
    payload: &Value,
) {
    for id in collect_history_ids(payload) {
        if id != ctx.job_id {
            let _ = delete_history_job(&id);
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
        id: &ctx.job_id,
        command: &ctx.command,
        provider: &ctx.provider,
        status: "running",
        created_at: &ctx.created_at,
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

    let event = {
        let Ok(mut inner) = ctx.inner.lock() else {
            return;
        };
        append_queue_event(
            &mut inner,
            &ctx.job_id,
            "local",
            "job.output_ready",
            json!({
                "index": batch_index,
                "path": payload_path,
                "job": parent_snapshot,
            }),
        )
    };
    ctx.host.emit_event(&ctx.job_id, &event);
}
