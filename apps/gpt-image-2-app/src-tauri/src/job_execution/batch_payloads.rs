#![allow(unused_imports)]

use super::*;

pub(crate) fn collect_history_ids(payload: &Value) -> Vec<String> {
    let mut ids = Vec::new();
    if let Some(id) = payload
        .get("history")
        .and_then(|history| history.get("job_id"))
        .and_then(Value::as_str)
        && !id.is_empty()
    {
        ids.push(id.to_string());
    }
    if let Some(job_ids) = payload
        .get("history")
        .and_then(|history| history.get("job_ids"))
        .and_then(Value::as_array)
    {
        for id in job_ids.iter().filter_map(Value::as_str) {
            if !id.is_empty() && !ids.iter().any(|existing| existing == id) {
                ids.push(id.to_string());
            }
        }
    }
    ids
}

pub(crate) fn output_files_from_payload(payload: &Value) -> Vec<Value> {
    let output = payload.get("output").cloned().unwrap_or_else(|| json!({}));
    let mut files = output
        .get("files")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if files.is_empty()
        && let Some(path) = output.get("path").and_then(Value::as_str)
    {
        files.push(json!({
            "index": 0,
            "path": path,
            "bytes": output.get("bytes").and_then(Value::as_u64).unwrap_or(0),
        }));
    }
    files
}

pub(crate) fn normalize_batch_output(files: Vec<Value>) -> Value {
    let indexed_files = files
        .into_iter()
        .enumerate()
        .map(|(index, mut file)| {
            if let Value::Object(object) = &mut file {
                object
                    .entry("index".to_string())
                    .or_insert_with(|| json!(index));
            }
            file
        })
        .collect::<Vec<_>>();
    let total_bytes = indexed_files
        .iter()
        .filter_map(|file| file.get("bytes").and_then(Value::as_u64))
        .sum::<u64>();
    let primary_path = indexed_files
        .iter()
        .find(|file| file.get("index").and_then(Value::as_u64) == Some(0))
        .and_then(|file| file.get("path"))
        .cloned()
        .unwrap_or(Value::Null);
    json!({
        "path": primary_path,
        "bytes": total_bytes,
        "files": indexed_files,
    })
}

pub(crate) fn batch_errors_json(errors: &[BatchItemError]) -> Value {
    Value::Array(
        errors
            .iter()
            .map(|error| {
                let mut item = json!({
                    "index": error.index,
                    "message": error.message,
                });
                if let (Value::Object(map), Some(code)) = (&mut item, error.code.as_ref()) {
                    map.insert("code".to_string(), json!(code));
                }
                if let (Value::Object(map), Some(detail)) = (&mut item, error.detail.as_ref()) {
                    map.insert("detail".to_string(), detail.clone());
                }
                item
            })
            .collect(),
    )
}

pub(crate) fn batch_error_summary(errors: &[BatchItemError]) -> Option<String> {
    if errors.is_empty() {
        return None;
    }
    let first = errors
        .first()
        .map(|error| error.message.as_str())
        .unwrap_or("Unknown batch error.");
    if errors.len() == 1 {
        Some(first.to_string())
    } else {
        Some(format!("{} 个子任务失败：{first}", errors.len()))
    }
}

pub(crate) fn merge_batch_payloads(
    command: &str,
    request_count: usize,
    payloads: Vec<(usize, Value)>,
    errors: Vec<BatchItemError>,
) -> Value {
    let first = payloads
        .first()
        .map(|(_, payload)| payload.clone())
        .unwrap_or_else(|| json!({}));
    let files = payloads
        .iter()
        .flat_map(|(batch_index, payload)| {
            output_files_from_payload(payload)
                .into_iter()
                .map(move |mut file| {
                    if let Value::Object(object) = &mut file {
                        object.insert("index".to_string(), json!(batch_index));
                    }
                    file
                })
        })
        .collect::<Vec<_>>();
    let mut history_job_ids = Vec::new();
    let mut revised_prompts = Vec::new();

    for (_, payload) in &payloads {
        history_job_ids.extend(collect_history_ids(payload));
        if let Some(prompts) = payload
            .get("response")
            .and_then(|response| response.get("revised_prompts"))
            .and_then(Value::as_array)
        {
            revised_prompts.extend(prompts.iter().cloned());
        }
    }

    history_job_ids.sort();
    history_job_ids.dedup();
    let primary_history_job_id = history_job_ids.first().cloned();
    let output = normalize_batch_output(files);
    let image_count = output
        .get("files")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0);
    let mut response = first.get("response").cloned().unwrap_or_else(|| json!({}));
    if let Value::Object(response) = &mut response {
        response.insert("image_count".to_string(), json!(image_count));
        response.insert("batch_count".to_string(), json!(request_count));
        response.insert("batch_request_count".to_string(), json!(request_count));
        response.insert("revised_prompts".to_string(), json!(revised_prompts));
    }
    let error_summary = batch_error_summary(&errors);
    let ok = image_count > 0;
    let status = if ok && errors.is_empty() {
        "completed"
    } else if ok {
        "partial_failed"
    } else {
        "failed"
    };

    let mut payload = json!({
        "ok": ok,
        "status": status,
        "command": command,
        "provider": first.get("provider").cloned().unwrap_or(Value::Null),
        "provider_selection": first.get("provider_selection").cloned().unwrap_or(Value::Null),
        "auth": first.get("auth").cloned().unwrap_or(Value::Null),
        "request": first.get("request").cloned().unwrap_or(Value::Null),
        "response": response,
        "output": output,
        "history": {
            "job_id": primary_history_job_id,
            "job_ids": history_job_ids,
        },
        "batch": {
            "mode": "parallel-single-output",
            "request_count": request_count,
            "success_count": image_count,
            "failure_count": errors.len(),
            "errors": batch_errors_json(&errors),
        },
        "events": {
            "count": request_count,
        }
    });
    if !errors.is_empty()
        && let Value::Object(object) = &mut payload
    {
        object.insert(
            "error".to_string(),
            json!({
                "code": if ok { "batch_partial_failed" } else { "batch_failed" },
                "message": error_summary.unwrap_or_else(|| "Batch request failed.".to_string()),
                "items": batch_errors_json(&errors),
            }),
        );
    }
    payload
}

pub(crate) fn cleanup_child_history(payload: &Value, app_job_id: &str) {
    for id in collect_history_ids(payload) {
        if id != app_job_id {
            let _ = delete_history_job(&id);
        }
    }
}

pub(crate) fn job_from_payload(
    payload: &Value,
    fallback_id: &str,
    command: &str,
    request: Value,
) -> Value {
    let job_id = payload
        .get("history")
        .and_then(|history| history.get("job_id"))
        .and_then(Value::as_str)
        .unwrap_or(fallback_id);
    let output = payload.get("output").cloned().unwrap_or_else(|| json!({}));
    let output_path = output.get("path").and_then(Value::as_str).or_else(|| {
        output
            .get("files")
            .and_then(Value::as_array)
            .and_then(|files| {
                files
                    .iter()
                    .find(|file| file.get("index").and_then(Value::as_u64) == Some(0))
            })
            .and_then(|file| file.get("path"))
            .and_then(Value::as_str)
    });
    json!({
        "id": job_id,
        "command": command,
        "provider": payload.get("provider").cloned().unwrap_or(Value::Null),
        "status": payload
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or_else(|| if payload.get("ok").and_then(Value::as_bool).unwrap_or(false) { "completed" } else { "failed" }),
        "created_at": chrono_like_now(),
        "updated_at": chrono_like_now(),
        "metadata": request,
        "outputs": output.get("files").cloned().unwrap_or_else(|| json!([])),
        "output_path": output_path,
        "error": payload.get("error").cloned(),
    })
}

pub(crate) fn chrono_like_now() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{secs}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(path: &str) -> Value {
        json!({
            "ok": true,
            "provider": "mock",
            "output": {
                "path": path,
                "bytes": 10,
            },
            "history": {
                "job_id": format!("child-{path}"),
            },
            "response": {
                "revised_prompts": [],
            },
        })
    }

    #[test]
    fn merge_batch_payloads_keeps_successful_outputs_with_failed_items() {
        let merged = merge_batch_payloads(
            "images generate",
            3,
            vec![(0, payload("/tmp/a.png")), (2, payload("/tmp/c.png"))],
            vec![BatchItemError {
                index: 1,
                code: None,
                message: "upstream rejected candidate B".to_string(),
                detail: None,
            }],
        );

        assert_eq!(merged["status"], "partial_failed");
        assert_eq!(merged["ok"], true);
        let files = merged["output"]["files"].as_array().unwrap();
        assert_eq!(files.len(), 2);
        assert_eq!(files[0]["index"], 0);
        assert_eq!(files[0]["path"], "/tmp/a.png");
        assert_eq!(files[1]["index"], 2);
        assert_eq!(files[1]["path"], "/tmp/c.png");
        assert_eq!(merged["output"]["path"], "/tmp/a.png");
        assert_eq!(merged["batch"]["request_count"], 3);
        assert_eq!(merged["batch"]["success_count"], 2);
        assert_eq!(merged["batch"]["failure_count"], 1);
        assert_eq!(merged["batch"]["errors"][0]["index"], 1);
        assert_eq!(merged["error"]["message"], "upstream rejected candidate B");
    }

    #[test]
    fn merge_batch_payloads_marks_total_failure_not_ok() {
        let merged = merge_batch_payloads(
            "images generate",
            2,
            vec![],
            vec![
                BatchItemError {
                    index: 0,
                    code: None,
                    message: "candidate A failed".to_string(),
                    detail: None,
                },
                BatchItemError {
                    index: 1,
                    code: None,
                    message: "candidate B failed".to_string(),
                    detail: None,
                },
            ],
        );

        assert_eq!(merged["ok"], false);
        assert_eq!(merged["status"], "failed");
        assert_eq!(merged["output"]["files"].as_array().unwrap().len(), 0);
        assert!(merged["output"]["path"].is_null());
        assert_eq!(merged["batch"]["success_count"], 0);
        assert_eq!(merged["batch"]["failure_count"], 2);
        assert_eq!(merged["error"]["code"], "batch_failed");
        assert_eq!(merged["error"]["items"][0]["index"], 0);

        let job = job_from_payload(&merged, "job-1", "images generate", json!({}));
        assert_eq!(job["status"], "failed");
        assert_eq!(terminal_event_type(job["status"].as_str()), "job.failed");
        assert!(!terminal_status_runs_storage_upload(job["status"].as_str()));
    }

    #[test]
    fn batch_errors_json_preserves_code_and_detail_per_item() {
        // P0 regression: per-slot batch errors must keep code/detail so
        // `error.items[*]` carry the real cause, not just a flat message.
        let errors = vec![
            BatchItemError::from_error_value(
                0,
                json!({
                    "code": "network_error",
                    "message": "OpenAI request failed.",
                    "detail": { "error": "connection refused" },
                }),
            ),
            BatchItemError::from_error_value(2, json!({ "message": "plain failure" })),
        ];

        let items = batch_errors_json(&errors);
        assert_eq!(items[0]["index"], 0);
        assert_eq!(items[0]["code"], "network_error");
        assert_eq!(items[0]["message"], "OpenAI request failed.");
        assert_eq!(items[0]["detail"]["error"], "connection refused");
        // An item without code/detail stays minimal (no null spam).
        assert_eq!(items[1]["index"], 2);
        assert_eq!(items[1]["message"], "plain failure");
        assert!(items[1].get("code").is_none());
        assert!(items[1].get("detail").is_none());

        let merged = merge_batch_payloads("images generate", 3, vec![], errors);
        assert_eq!(
            merged["error"]["items"][0]["detail"]["error"],
            "connection refused"
        );
        assert_eq!(merged["error"]["items"][0]["code"], "network_error");
    }
}
