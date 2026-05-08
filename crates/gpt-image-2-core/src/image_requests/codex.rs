#![allow(unused_imports)]

use super::*;

pub(crate) fn request_codex_responses_once(
    endpoint: &str,
    auth_state: &CodexAuthState,
    body: &Value,
    logger: &mut JsonEventLogger,
) -> Result<Value, AppError> {
    logger.emit(
        "local",
        "request.started",
        json!({"provider": "codex", "endpoint": endpoint}),
    );
    emit_progress_event(
        logger,
        "codex",
        "request_started",
        "Codex image request sent.",
        "running",
        Some(0),
        json!({ "endpoint": endpoint }),
    );
    let client = make_client(DEFAULT_REQUEST_TIMEOUT)?;
    let response = client
        .post(endpoint)
        .header(AUTHORIZATION, format!("Bearer {}", auth_state.access_token))
        .header("ChatGPT-Account-ID", auth_state.account_id.as_str())
        .header(CONTENT_TYPE, "application/json")
        .header(ACCEPT, "text/event-stream")
        .header("originator", "codex_desktop")
        .body(body.to_string())
        .send()
        .map_err(|error| {
            AppError::new("network_error", "Codex request failed.")
                .with_detail(json!({ "error": error.to_string() }))
        })?;
    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().unwrap_or_else(|_| String::new());
        return Err(http_status_error(status, detail));
    }

    let mut response_meta = json!({});
    let mut output_items: Vec<Value> = Vec::new();
    let mut response_error: Option<Value> = None;
    let reader = BufReader::new(response);
    let mut data_lines: Vec<String> = Vec::new();

    for line in reader.lines() {
        let line = line.map_err(|error| {
            AppError::new("request_failed", "Unable to read Codex SSE response.")
                .with_detail(json!({ "error": error.to_string() }))
        })?;
        if line.trim().is_empty() {
            if !data_lines.is_empty() {
                handle_sse_payload(
                    &data_lines.join(""),
                    logger,
                    &mut response_meta,
                    &mut output_items,
                    &mut response_error,
                )?;
                data_lines.clear();
            }
            continue;
        }
        if let Some(data) = line.strip_prefix("data:") {
            data_lines.push(data.trim_start().to_string());
        }
    }
    if !data_lines.is_empty() {
        handle_sse_payload(
            &data_lines.join(""),
            logger,
            &mut response_meta,
            &mut output_items,
            &mut response_error,
        )?;
    }

    let image_items = extract_codex_image_items(&output_items);
    if response_error.is_some() && image_items.is_empty() {
        let error_message = format_response_error(response_error.as_ref());
        return Err(AppError::new("request_failed", error_message));
    }
    emit_progress_event(
        logger,
        "codex",
        "request_completed",
        "Codex response payload received.",
        "running",
        Some(97),
        json!({
            "response_id": response_meta.get("id").cloned().unwrap_or(Value::Null),
            "image_count": image_items.len(),
        }),
    );
    Ok(json!({
        "response": response_meta,
        "output_items": output_items,
        "image_items": image_items,
    }))
}

pub(crate) fn handle_sse_payload(
    payload: &str,
    logger: &mut JsonEventLogger,
    response_meta: &mut Value,
    output_items: &mut Vec<Value>,
    response_error: &mut Option<Value>,
) -> Result<(), AppError> {
    if payload == "[DONE]" {
        logger.emit("sse", "done", json!({"raw": "[DONE]"}));
        return Ok(());
    }
    let event: Value = serde_json::from_str(payload).map_err(|error| {
        AppError::new("request_failed", "Unable to parse Codex SSE event.")
            .with_detail(json!({ "error": error.to_string(), "payload": payload }))
    })?;
    emit_sse_event(logger, &event);
    let event_type = event
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    match event_type {
        "response.created" => {
            if let Some(created) = event.get("response") {
                *response_meta = created.clone();
                emit_progress_event(
                    logger,
                    "codex",
                    "response_created",
                    "Codex accepted the image request.",
                    "running",
                    Some(15),
                    json!({
                        "response_id": created.get("id"),
                        "model": created.get("model"),
                    }),
                );
            }
        }
        "response.output_item.done" => {
            if let Some(item) = event.get("item") {
                merge_output_items(output_items, std::slice::from_ref(item));
                emit_progress_event(
                    logger,
                    "codex",
                    "output_item_done",
                    "Codex finished one output item.",
                    "running",
                    Some(85),
                    json!({
                        "item_id": item.get("id"),
                        "item_type": item.get("type"),
                        "item_status": item.get("status"),
                        "image_count": extract_codex_image_items(output_items).len(),
                    }),
                );
            }
        }
        "error" => {
            *response_error = event.get("error").cloned();
            emit_progress_event(
                logger,
                "codex",
                "request_failed",
                "Codex reported an image generation error.",
                "failed",
                None,
                json!({ "error": event.get("error") }),
            );
        }
        "response.failed" => {
            if let Some(failed_response) = event.get("response") {
                *response_meta = failed_response.clone();
                if let Some(output) = failed_response.get("output").and_then(Value::as_array) {
                    merge_output_items(output_items, output);
                }
                *response_error = failed_response
                    .get("error")
                    .cloned()
                    .or_else(|| response_error.clone());
                emit_progress_event(
                    logger,
                    "codex",
                    "request_failed",
                    "Codex marked the image request as failed.",
                    "failed",
                    None,
                    json!({
                        "response_id": failed_response.get("id"),
                        "error": response_error.clone(),
                    }),
                );
            }
        }
        "response.completed" => {
            if let Some(completed) = event.get("response") {
                *response_meta = completed.clone();
                emit_progress_event(
                    logger,
                    "codex",
                    "response_completed",
                    "Codex completed the server-side image response.",
                    "running",
                    Some(95),
                    json!({
                        "response_id": completed.get("id"),
                        "image_count": extract_codex_image_items(output_items).len(),
                    }),
                );
            }
        }
        _ => {}
    }
    Ok(())
}

pub(crate) fn merge_output_items(existing: &mut Vec<Value>, incoming: &[Value]) {
    for item in incoming {
        let item_id = item.get("id").and_then(Value::as_str);
        if let Some(item_id) = item_id
            && let Some(position) = existing
                .iter()
                .position(|candidate| candidate.get("id").and_then(Value::as_str) == Some(item_id))
        {
            existing[position] = item.clone();
            continue;
        }
        existing.push(item.clone());
    }
}

pub(crate) fn extract_codex_image_items(output_items: &[Value]) -> Vec<Value> {
    output_items
        .iter()
        .filter(|item| {
            item.get("type").and_then(Value::as_str) == Some("image_generation_call")
                && item.get("result").and_then(Value::as_str).is_some()
        })
        .cloned()
        .collect()
}

pub(crate) fn format_response_error(error: Option<&Value>) -> String {
    let Some(error) = error else {
        return "Image generation failed without structured error details.".to_string();
    };
    if let Some(object) = error.as_object() {
        let code = object
            .get("code")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let message = object
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Image generation failed");
        if !code.is_empty() {
            return format!("{code}: {message}");
        }
        return message.to_string();
    }
    "Image generation failed without structured error details.".to_string()
}
