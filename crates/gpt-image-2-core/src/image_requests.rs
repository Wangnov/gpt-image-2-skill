#![allow(unused_imports)]

use super::*;

pub(crate) fn execute_openai_with_retry<T, F>(
    logger: &mut JsonEventLogger,
    provider: &str,
    mut run_once: F,
) -> Result<(T, usize), AppError>
where
    F: FnMut(&mut JsonEventLogger) -> Result<T, AppError>,
{
    let mut retry_count = 0;
    loop {
        match run_once(logger) {
            Ok(value) => return Ok((value, retry_count)),
            Err(error) => {
                if retry_count >= DEFAULT_RETRY_COUNT || !should_retry(&error) {
                    return Err(error);
                }
                retry_count += 1;
                let delay_seconds = compute_retry_delay_seconds(retry_count);
                emit_progress_event(
                    logger,
                    provider,
                    "retry_scheduled",
                    "Retry scheduled after transient failure.",
                    "running",
                    None,
                    json!({
                        "retry_number": retry_count,
                        "max_retries": DEFAULT_RETRY_COUNT,
                        "delay_seconds": delay_seconds,
                        "reason": error.message,
                        "status_code": error.status_code,
                    }),
                );
                std::thread::sleep(Duration::from_secs(delay_seconds));
            }
        }
    }
}

pub(crate) fn request_codex_with_retry(
    endpoint: &str,
    auth_state: &mut CodexAuthState,
    body: &Value,
    logger: &mut JsonEventLogger,
) -> Result<(Value, bool, usize), AppError> {
    let mut auth_refreshed = false;
    let mut retry_count = 0;
    loop {
        match request_codex_responses_once(endpoint, auth_state, body, logger) {
            Ok(value) => return Ok((value, auth_refreshed, retry_count)),
            Err(error) => {
                if error.status_code == Some(401) && !auth_refreshed {
                    emit_progress_event(
                        logger,
                        "codex",
                        "auth_refresh_started",
                        "Refreshing Codex access token.",
                        "running",
                        Some(2),
                        json!({ "endpoint": REFRESH_ENDPOINT }),
                    );
                    let payload = refresh_access_token(auth_state)?;
                    logger.emit(
                        "local",
                        "auth.refresh.completed",
                        redact_event_payload(&payload),
                    );
                    emit_progress_event(
                        logger,
                        "codex",
                        "auth_refresh_completed",
                        "Codex access token refreshed.",
                        "running",
                        Some(4),
                        json!({}),
                    );
                    auth_refreshed = true;
                    continue;
                }
                if retry_count >= DEFAULT_RETRY_COUNT || !should_retry(&error) {
                    return Err(error);
                }
                retry_count += 1;
                let delay_seconds = compute_retry_delay_seconds(retry_count);
                emit_progress_event(
                    logger,
                    "codex",
                    "retry_scheduled",
                    "Retry scheduled after transient failure.",
                    "running",
                    None,
                    json!({
                        "retry_number": retry_count,
                        "max_retries": DEFAULT_RETRY_COUNT,
                        "delay_seconds": delay_seconds,
                        "reason": error.message,
                        "status_code": error.status_code,
                    }),
                );
                std::thread::sleep(Duration::from_secs(delay_seconds));
            }
        }
    }
}

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

pub(crate) fn decode_base64_bytes(value: &str) -> Result<Vec<u8>, AppError> {
    let encoded = if value.starts_with("data:image/") {
        value
            .split_once(',')
            .ok_or_else(|| {
                AppError::new(
                    "invalid_base64",
                    "Image data URL did not contain a comma separator.",
                )
            })?
            .1
    } else {
        value
    };
    STANDARD.decode(encoded).map_err(|_| {
        AppError::new("invalid_base64", "Image payload was not valid base64.")
            .with_detail(json!({ "length": encoded.len() }))
    })
}

pub(crate) fn detect_mime_type(path: &Path, bytes: &[u8]) -> Result<String, AppError> {
    if let Some(mime) = mime_guess::from_path(path).first_raw()
        && mime.starts_with("image/")
    {
        return Ok(mime.to_string());
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Ok("image/png".to_string());
    }
    if bytes.starts_with(b"\xff\xd8\xff") {
        return Ok("image/jpeg".to_string());
    }
    if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        return Ok("image/webp".to_string());
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Ok("image/gif".to_string());
    }
    if bytes.starts_with(b"BM") {
        return Ok("image/bmp".to_string());
    }
    Err(AppError::new(
        "ref_image_invalid",
        format!(
            "Unsupported image format for reference image: {}",
            path.display()
        ),
    ))
}

pub(crate) fn filename_extension_for_mime_type(mime_type: &str) -> &'static str {
    match mime_type {
        "image/png" => ".png",
        "image/jpeg" => ".jpg",
        "image/webp" => ".webp",
        "image/gif" => ".gif",
        "image/bmp" => ".bmp",
        _ => ".bin",
    }
}

pub(crate) fn detect_extension(bytes: &[u8]) -> &'static str {
    match detect_mime_type(Path::new("file.bin"), bytes).as_deref() {
        Ok("image/png") => ".png",
        Ok("image/jpeg") => ".jpg",
        Ok("image/webp") => ".webp",
        Ok("image/gif") => ".gif",
        Ok("image/bmp") => ".bmp",
        _ => ".bin",
    }
}

pub(crate) fn local_path_to_data_url(path: &Path) -> Result<String, AppError> {
    if !path.is_file() {
        return Err(AppError::new(
            "ref_image_missing",
            format!("Reference image not found: {}", path.display()),
        ));
    }
    let bytes = fs::read(path).map_err(|error| {
        AppError::new("ref_image_invalid", "Unable to read reference image.")
            .with_detail(json!({ "error": error.to_string(), "path": path.display().to_string() }))
    })?;
    let mime_type = detect_mime_type(path, &bytes)?;
    let encoded = STANDARD.encode(bytes);
    Ok(format!("data:{mime_type};base64,{encoded}"))
}

pub(crate) fn resolve_ref_image(value: &str) -> Result<String, AppError> {
    match Url::parse(value) {
        Ok(url) => match url.scheme() {
            "http" | "https" | "data" => Ok(value.to_string()),
            "file" => {
                let path = url
                    .to_file_path()
                    .map_err(|_| AppError::new("ref_image_invalid", "Unsupported file URL."))?;
                local_path_to_data_url(&path)
            }
            _ => local_path_to_data_url(Path::new(value)),
        },
        Err(_) => local_path_to_data_url(Path::new(value)),
    }
}

pub(crate) fn resolve_ref_images(values: &[String]) -> Result<Vec<String>, AppError> {
    values
        .iter()
        .map(|value| resolve_ref_image(value))
        .collect()
}

pub(crate) fn sanitize_file_name(name: &str) -> String {
    let clean: String = name
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric() || ['-', '_', '.'].contains(character)
        })
        .collect();
    if clean.is_empty() {
        "image.bin".to_string()
    } else {
        clean
    }
}

pub(crate) fn parse_data_url_image(value: &str) -> Result<(String, Vec<u8>), AppError> {
    let Some((prefix, encoded)) = value.split_once(',') else {
        return Err(AppError::new(
            "invalid_data_url",
            "Image data URL must contain a base64 payload.",
        ));
    };
    if !prefix.contains(";base64") {
        return Err(AppError::new(
            "invalid_data_url",
            "Image data URL must contain a base64 payload.",
        ));
    }
    let mime_type = prefix
        .trim_start_matches("data:")
        .split(';')
        .next()
        .unwrap_or("application/octet-stream")
        .to_string();
    Ok((mime_type, decode_base64_bytes(encoded)?))
}

pub(crate) fn download_bytes(url: &str) -> Result<Vec<u8>, AppError> {
    let client = make_client(DEFAULT_REQUEST_TIMEOUT)?;
    let response = client.get(url).send().map_err(|error| {
        AppError::new("network_error", "Unable to download image bytes.")
            .with_detail(json!({ "error": error.to_string(), "url": url }))
    })?;
    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().unwrap_or_else(|_| String::new());
        return Err(http_status_error(status, detail));
    }
    response
        .bytes()
        .map(|bytes| bytes.to_vec())
        .map_err(|error| {
            AppError::new("network_error", "Unable to read downloaded image bytes.")
                .with_detail(json!({ "error": error.to_string(), "url": url }))
        })
}

pub(crate) fn load_image_source_bytes(
    source: &str,
    fallback_name: &str,
) -> Result<(String, Vec<u8>, String), AppError> {
    if source.starts_with("data:image/") {
        let (mime_type, bytes) = parse_data_url_image(source)?;
        let file_name = format!(
            "{fallback_name}{}",
            filename_extension_for_mime_type(&mime_type)
        );
        return Ok((mime_type, bytes, sanitize_file_name(&file_name)));
    }
    if let Ok(url) = Url::parse(source) {
        match url.scheme() {
            "http" | "https" => {
                let bytes = download_bytes(source)?;
                let guessed_name = Path::new(url.path())
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or(fallback_name);
                let mime_type = detect_mime_type(Path::new(guessed_name), &bytes)?;
                let file_name = format!(
                    "{}{}",
                    Path::new(guessed_name)
                        .file_stem()
                        .and_then(|stem| stem.to_str())
                        .unwrap_or(fallback_name),
                    filename_extension_for_mime_type(&mime_type)
                );
                return Ok((mime_type, bytes, sanitize_file_name(&file_name)));
            }
            "file" => {
                let path = url
                    .to_file_path()
                    .map_err(|_| AppError::new("ref_image_invalid", "Unsupported file URL."))?;
                let bytes = fs::read(&path).map_err(|error| {
                    AppError::new("ref_image_invalid", "Unable to read local file URL image.")
                        .with_detail(json!({ "error": error.to_string(), "path": path.display().to_string() }))
                })?;
                let mime_type = detect_mime_type(&path, &bytes)?;
                let file_name = path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(sanitize_file_name)
                    .unwrap_or_else(|| "image.bin".to_string());
                return Ok((mime_type, bytes, file_name));
            }
            _ => {}
        }
    }
    let path = Path::new(source);
    if path.is_file() {
        let bytes = fs::read(path).map_err(|error| {
            AppError::new("ref_image_invalid", "Unable to read local image.").with_detail(
                json!({ "error": error.to_string(), "path": path.display().to_string() }),
            )
        })?;
        let mime_type = detect_mime_type(path, &bytes)?;
        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .map(sanitize_file_name)
            .unwrap_or_else(|| "image.bin".to_string());
        return Ok((mime_type, bytes, file_name));
    }
    Err(AppError::new(
        "ref_image_invalid",
        format!("Unsupported image source for multipart edit: {source}"),
    ))
}

pub(crate) fn save_image(path: &Path, bytes: &[u8]) -> Result<PathBuf, AppError> {
    let final_path = if path.extension().is_none() {
        path.with_extension(detect_extension(bytes).trim_start_matches('.'))
    } else {
        path.to_path_buf()
    };
    if let Some(parent) = final_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            AppError::new("output_write_failed", "Unable to create output directory.").with_detail(
                json!({ "error": error.to_string(), "path": parent.display().to_string() }),
            )
        })?;
    }
    fs::write(&final_path, bytes).map_err(|error| {
        AppError::new("output_write_failed", "Unable to write output image.").with_detail(
            json!({ "error": error.to_string(), "path": final_path.display().to_string() }),
        )
    })?;
    Ok(final_path)
}

pub(crate) fn save_images(
    output_path: &Path,
    image_bytes_list: &[Vec<u8>],
) -> Result<Vec<Value>, AppError> {
    if image_bytes_list.is_empty() {
        return Err(AppError::new(
            "missing_image_result",
            "No image bytes were available to save.",
        ));
    }
    if image_bytes_list.len() == 1 {
        let path = save_image(output_path, &image_bytes_list[0])?;
        return Ok(vec![json!({
            "index": 0,
            "path": path.display().to_string(),
            "bytes": image_bytes_list[0].len(),
        })]);
    }
    let mut saved = Vec::new();
    let base_name = output_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .or_else(|| output_path.file_name().and_then(|name| name.to_str()))
        .unwrap_or("image");
    let suffix = output_path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| format!(".{ext}"));
    for (index, bytes) in image_bytes_list.iter().enumerate() {
        let extension = suffix
            .clone()
            .unwrap_or_else(|| detect_extension(bytes).to_string());
        let path = output_path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join(format!("{base_name}-{}{}", index + 1, extension));
        save_image(&path, bytes)?;
        saved.push(json!({
            "index": index,
            "path": path.display().to_string(),
            "bytes": bytes.len(),
        }));
    }
    Ok(saved)
}

pub(crate) fn normalize_saved_output(saved_files: &[Value]) -> Value {
    if saved_files.len() == 1 {
        json!({
            "path": saved_files[0].get("path"),
            "bytes": saved_files[0].get("bytes"),
            "files": saved_files,
        })
    } else {
        let total_bytes: u64 = saved_files
            .iter()
            .filter_map(|item| item.get("bytes").and_then(Value::as_u64))
            .sum();
        json!({
            "path": Value::Null,
            "bytes": total_bytes,
            "files": saved_files,
        })
    }
}

pub(crate) fn primary_saved_output_path(output_path: &Path, saved_files: &[Value]) -> PathBuf {
    saved_files
        .first()
        .and_then(|file| file.get("path"))
        .and_then(Value::as_str)
        .map(PathBuf::from)
        .unwrap_or_else(|| output_path.to_path_buf())
}

pub(crate) fn history_image_metadata(
    operation: &str,
    selection: &ProviderSelection,
    shared: &SharedImageArgs,
    saved_files: &[Value],
) -> Value {
    json!({
        "operation": operation,
        "prompt": &shared.prompt,
        "size": shared.size.as_deref(),
        "format": shared.output_format.map(OutputFormat::as_str),
        "quality": shared.quality.map(Quality::as_str),
        "background": shared.background.as_str(),
        "n": shared.n,
        "provider_selection": selection.payload(),
        "output": normalize_saved_output(saved_files),
    })
}

pub(crate) type DecodedOpenAiImages = (Vec<Vec<u8>>, Vec<Option<String>>);

pub(crate) fn decode_openai_images(payload: &Value) -> Result<DecodedOpenAiImages, AppError> {
    let mut result = Vec::new();
    let mut revised_prompts = Vec::new();
    for item in payload
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        revised_prompts.push(
            item.get("revised_prompt")
                .and_then(Value::as_str)
                .map(ToString::to_string),
        );
        if let Some(b64_json) = item.get("b64_json").and_then(Value::as_str) {
            result.push(decode_base64_bytes(b64_json)?);
            continue;
        }
        if let Some(url) = item.get("url").and_then(Value::as_str) {
            result.push(download_bytes(url)?);
        }
    }
    Ok((result, revised_prompts))
}

pub(crate) fn summarize_image_request_options(
    provider: &str,
    operation: &str,
    resolved_model: &str,
    shared: &SharedImageArgs,
    ref_image_count: usize,
    mask_present: bool,
    input_fidelity: Option<InputFidelity>,
) -> Value {
    let mut summary = json!({
        "operation": operation,
        "provider": provider,
        "model": resolved_model,
        "background": shared.background.as_str(),
        "ref_image_count": ref_image_count,
    });
    if let Some(size) = &shared.size {
        summary["size"] = json!(size);
    }
    if let Some(quality) = shared.quality {
        summary["quality"] = json!(quality.as_str());
    }
    if let Some(output_format) = shared.output_format {
        summary["format"] = json!(output_format.as_str());
    }
    if let Some(output_compression) = shared.output_compression {
        summary["compression"] = json!(output_compression);
    }
    if let Some(n) = shared.n {
        summary["n"] = json!(n);
    }
    if let Some(moderation) = shared.moderation {
        summary["moderation"] = json!(moderation.as_str());
    }
    if provider == "codex" {
        summary["delegated_image_model"] = json!(DELEGATED_IMAGE_MODEL);
    }
    if mask_present {
        summary["mask_present"] = json!(true);
    }
    if let Some(input_fidelity) = input_fidelity {
        summary["input_fidelity"] = json!(input_fidelity.as_str());
    }
    summary
}

pub(crate) fn summarize_output_item(item: &Value) -> Value {
    let mut summary = json!({
        "id": item.get("id"),
        "type": item.get("type"),
        "status": item.get("status"),
    });
    for key in [
        "action",
        "background",
        "output_format",
        "quality",
        "size",
        "revised_prompt",
    ] {
        if let Some(value) = item.get(key) {
            summary[key] = value.clone();
        }
    }
    if let Some(result) = item.get("result").and_then(Value::as_str) {
        summary["result"] = summarize_large_string(Some("result"), result);
    }
    summary
}

pub(crate) fn build_openai_operation_endpoint(
    api_base: &str,
    operation: &str,
) -> Result<String, AppError> {
    match operation {
        "generate" => Ok(format!(
            "{}{}",
            api_base.trim_end_matches('/'),
            OPENAI_GENERATIONS_PATH
        )),
        "edit" => Ok(format!(
            "{}{}",
            api_base.trim_end_matches('/'),
            OPENAI_EDITS_PATH
        )),
        _ => Err(AppError::new(
            "invalid_operation",
            format!("Unsupported OpenAI image operation: {operation}"),
        )),
    }
}
