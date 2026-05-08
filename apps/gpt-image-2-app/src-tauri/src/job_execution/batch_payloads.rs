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
                object.insert("index".to_string(), json!(index));
            }
            file
        })
        .collect::<Vec<_>>();
    let total_bytes = indexed_files
        .iter()
        .filter_map(|file| file.get("bytes").and_then(Value::as_u64))
        .sum::<u64>();
    let primary_path = indexed_files
        .first()
        .and_then(|file| file.get("path"))
        .cloned()
        .unwrap_or(Value::Null);
    json!({
        "path": primary_path,
        "bytes": total_bytes,
        "files": indexed_files,
    })
}

pub(crate) fn merge_batch_payloads(command: &str, payloads: Vec<Value>) -> Value {
    let first = payloads.first().cloned().unwrap_or_else(|| json!({}));
    let files = payloads
        .iter()
        .flat_map(output_files_from_payload)
        .collect::<Vec<_>>();
    let mut history_job_ids = Vec::new();
    let mut revised_prompts = Vec::new();

    for payload in &payloads {
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
        response.insert("batch_count".to_string(), json!(payloads.len()));
        response.insert("batch_request_count".to_string(), json!(payloads.len()));
        response.insert("revised_prompts".to_string(), json!(revised_prompts));
    }

    json!({
        "ok": true,
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
            "request_count": payloads.len(),
        },
        "events": {
            "count": payloads.len(),
        }
    })
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
            .and_then(|files| files.first())
            .and_then(|file| file.get("path"))
            .and_then(Value::as_str)
    });
    json!({
        "id": job_id,
        "command": command,
        "provider": payload.get("provider").cloned().unwrap_or(Value::Null),
        "status": if payload.get("ok").and_then(Value::as_bool).unwrap_or(false) { "completed" } else { "failed" },
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
