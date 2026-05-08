#![allow(unused_imports)]

use super::*;

pub(crate) fn request_openai_images_once(
    endpoint: &str,
    auth_state: &OpenAiAuthState,
    body: &Value,
    logger: &mut JsonEventLogger,
) -> Result<Value, AppError> {
    logger.emit(
        "local",
        "request.started",
        json!({"provider": "openai", "endpoint": endpoint}),
    );
    emit_progress_event(
        logger,
        "openai",
        "request_started",
        "OpenAI image request sent.",
        "running",
        Some(0),
        json!({ "endpoint": endpoint }),
    );
    let client = make_client(DEFAULT_REQUEST_TIMEOUT)?;
    let response = client
        .post(endpoint)
        .header(AUTHORIZATION, format!("Bearer {}", auth_state.api_key))
        .header(CONTENT_TYPE, "application/json")
        .header(ACCEPT, "application/json")
        .body(body.to_string())
        .send()
        .map_err(|error| {
            AppError::new("network_error", "OpenAI request failed.")
                .with_detail(json!({ "error": error.to_string() }))
        })?;
    parse_openai_json_response(response, logger)
}

pub(crate) fn request_openai_edit_once(
    endpoint: &str,
    auth_state: &OpenAiAuthState,
    body: &Value,
    logger: &mut JsonEventLogger,
) -> Result<Value, AppError> {
    logger.emit(
        "local",
        "request.started",
        json!({"provider": "openai", "endpoint": endpoint, "transport": "multipart"}),
    );
    emit_progress_event(
        logger,
        "openai",
        "request_started",
        "OpenAI multipart image edit request started.",
        "running",
        Some(0),
        json!({ "endpoint": endpoint, "transport": "multipart" }),
    );
    let form = build_openai_edit_form(body)?;
    emit_progress_event(
        logger,
        "openai",
        "multipart_prepared",
        "OpenAI multipart image payload prepared.",
        "running",
        Some(10),
        json!({ "transport": "multipart" }),
    );
    let client = make_client(DEFAULT_REQUEST_TIMEOUT)?;
    let response = client
        .post(endpoint)
        .header(AUTHORIZATION, format!("Bearer {}", auth_state.api_key))
        .multipart(form)
        .send()
        .map_err(|error| {
            AppError::new("network_error", "OpenAI multipart request failed.")
                .with_detail(json!({ "error": error.to_string() }))
        })?;
    parse_openai_json_response(response, logger)
}

pub(crate) fn parse_openai_json_response(
    response: Response,
    logger: &mut JsonEventLogger,
) -> Result<Value, AppError> {
    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().unwrap_or_else(|_| String::new());
        return Err(http_status_error(status, detail));
    }
    let payload: Value = response.json().map_err(|error| {
        AppError::new(
            "invalid_json_response",
            "OpenAI Images API returned invalid JSON.",
        )
        .with_detail(json!({ "error": error.to_string() }))
    })?;
    if !payload.is_object() {
        return Err(AppError::new(
            "invalid_json_response",
            "OpenAI Images API returned a non-object JSON payload.",
        ));
    }
    emit_progress_event(
        logger,
        "openai",
        "request_completed",
        "OpenAI image response received.",
        "running",
        Some(95),
        json!({
            "created": payload.get("created"),
            "image_count": payload.get("data").and_then(Value::as_array).map(|items| items.len()).unwrap_or(0),
        }),
    );
    Ok(payload)
}

pub(crate) fn build_openai_edit_form(body: &Value) -> Result<Form, AppError> {
    let object = json_object(body)?;
    let mut form = Form::new();
    for key in [
        "model",
        "prompt",
        "size",
        "quality",
        "background",
        "output_format",
        "output_compression",
        "n",
        "moderation",
        "input_fidelity",
    ] {
        if let Some(value) = object.get(key)
            && let Some(scalar) = coerce_multipart_scalar(value)
        {
            form = form.text(key.to_string(), scalar);
        }
    }
    let images = extract_openai_edit_image_sources(body)?;
    if images.is_empty() {
        return Err(AppError::new(
            "missing_image_result",
            "OpenAI edit requests require at least one input image.",
        ));
    }
    for (index, source) in images.iter().enumerate() {
        let (mime_type, bytes, file_name) =
            load_image_source_bytes(source, &format!("image-{}", index + 1))?;
        let part = Part::bytes(bytes)
            .file_name(file_name)
            .mime_str(&mime_type)
            .map_err(|error| {
                AppError::new(
                    "ref_image_invalid",
                    "Invalid image MIME type for multipart edit.",
                )
                .with_detail(json!({ "error": error.to_string() }))
            })?;
        form = form.part("image[]", part);
    }
    if let Some(mask_source) = extract_openai_mask_source(body)? {
        let (mime_type, bytes, file_name) = load_image_source_bytes(&mask_source, "mask")?;
        let part = Part::bytes(bytes)
            .file_name(file_name)
            .mime_str(&mime_type)
            .map_err(|error| {
                AppError::new(
                    "ref_image_invalid",
                    "Invalid mask MIME type for multipart edit.",
                )
                .with_detail(json!({ "error": error.to_string() }))
            })?;
        form = form.part("mask", part);
    }
    Ok(form)
}

pub(crate) fn extract_openai_edit_image_sources(body: &Value) -> Result<Vec<String>, AppError> {
    let object = json_object(body)?;
    if let Some(images) = object.get("images").and_then(Value::as_array) {
        let mut result = Vec::new();
        for entry in images {
            if let Some(text) = entry.as_str() {
                result.push(text.to_string());
                continue;
            }
            if let Some(image_url) = entry
                .as_object()
                .and_then(|item| item.get("image_url"))
                .and_then(Value::as_str)
            {
                result.push(image_url.to_string());
            }
        }
        return Ok(result);
    }
    if let Some(image) = object.get("image")
        && let Some(text) = image.as_str()
    {
        return Ok(vec![text.to_string()]);
    }
    Ok(Vec::new())
}

pub(crate) fn extract_openai_mask_source(body: &Value) -> Result<Option<String>, AppError> {
    let object = json_object(body)?;
    if let Some(mask) = object.get("mask") {
        if let Some(text) = mask.as_str() {
            return Ok(Some(text.to_string()));
        }
        if let Some(image_url) = mask
            .as_object()
            .and_then(|item| item.get("image_url"))
            .and_then(Value::as_str)
        {
            return Ok(Some(image_url.to_string()));
        }
    }
    Ok(None)
}

pub(crate) fn coerce_multipart_scalar(value: &Value) -> Option<String> {
    match value {
        Value::Null => None,
        Value::Bool(value) => Some(if *value { "true" } else { "false" }.to_string()),
        Value::Number(value) => Some(value.to_string()),
        Value::String(value) => Some(value.clone()),
        _ => None,
    }
}
