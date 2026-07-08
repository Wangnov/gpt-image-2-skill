use std::{sync::mpsc, thread};

use gpt_image_2_core::run_json;
use serde_json::{Value, json};

use crate::BatchItemError;

pub fn error_value_from_message(message: impl Into<String>) -> Value {
    json!({ "message": message.into() })
}

pub fn cli_json_result(args: &[String]) -> Result<Value, Value> {
    let mut argv = vec!["gpt-image-2-skill".to_string(), "--json".to_string()];
    argv.extend(args.iter().cloned());
    let outcome = run_json(&argv);
    if outcome.exit_status == 0 {
        Ok(outcome.payload)
    } else {
        Err(outcome
            .payload
            .get("error")
            .cloned()
            .unwrap_or_else(|| error_value_from_message("Command failed")))
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
