#![allow(unused_imports)]

use super::*;

pub(crate) fn request_openai_images_once(
    endpoint: &str,
    auth_state: &OpenAiAuthState,
    body: &Value,
    logger: &mut JsonEventLogger,
    mut recovery: Option<&mut RecoveryContext>,
    proxy: &ProxyConfig,
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
    let client_request_id = if let Some(ctx) = recovery.as_deref_mut() {
        let client_request_id = ctx.begin_attempt()?;
        test_fault::record_provider_http_attempt(&ctx.job_id);
        Some(client_request_id)
    } else {
        None
    };
    let client = make_client(DEFAULT_REQUEST_TIMEOUT, proxy)?;
    let mut request = client
        .post(endpoint)
        .header(AUTHORIZATION, format!("Bearer {}", auth_state.api_key))
        .header(CONTENT_TYPE, "application/json")
        .header(ACCEPT, "application/json")
        .body(body.to_string());
    if let Some(client_request_id) = &client_request_id {
        request = request.header("X-Client-Request-Id", client_request_id);
    }
    let response = request.send().map_err(|error| {
        AppError::new("network_error", "OpenAI request failed.")
            .with_detail(json!({ "error": error.to_string() }))
    })?;
    parse_openai_json_response(response, logger, recovery)
}

pub(crate) fn request_openai_edit_once(
    endpoint: &str,
    auth_state: &OpenAiAuthState,
    body: &Value,
    logger: &mut JsonEventLogger,
    mut recovery: Option<&mut RecoveryContext>,
    proxy: &ProxyConfig,
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
    let client_request_id = if let Some(ctx) = recovery.as_deref_mut() {
        let client_request_id = ctx.begin_attempt()?;
        test_fault::record_provider_http_attempt(&ctx.job_id);
        Some(client_request_id)
    } else {
        None
    };
    let client = make_client(DEFAULT_REQUEST_TIMEOUT, proxy)?;
    let mut request = client
        .post(endpoint)
        .header(AUTHORIZATION, format!("Bearer {}", auth_state.api_key))
        .multipart(form);
    if let Some(client_request_id) = &client_request_id {
        request = request.header("X-Client-Request-Id", client_request_id);
    }
    let response = request.send().map_err(|error| {
        AppError::new("network_error", "OpenAI multipart request failed.")
            .with_detail(json!({ "error": error.to_string() }))
    })?;
    parse_openai_json_response(response, logger, recovery)
}

pub(crate) fn parse_openai_json_response(
    response: Response,
    logger: &mut JsonEventLogger,
    mut recovery: Option<&mut RecoveryContext>,
) -> Result<Value, AppError> {
    if let Some(ctx) = recovery.as_deref_mut() {
        ctx.mark_response_headers(response.headers())?;
    }
    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().unwrap_or_else(|_| String::new());
        return Err(http_status_error(status, detail));
    }
    let raw = response.text().map_err(|error| {
        AppError::new(
            "invalid_json_response",
            "OpenAI Images API response body could not be read.",
        )
        .with_detail(json!({ "error": error.to_string() }))
    })?;
    if let Some(ctx) = recovery {
        ctx.mark_response_body_completed()?;
        ctx.spool_raw_response(&raw)?;
    }
    let payload: Value = serde_json::from_str(&raw).map_err(|error| {
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
        "complexity",
        "frame_count",
        "frame_duration_ms",
        "safety_identifier",
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
    let markup = extract_openai_markup_source(body)?
        .map(|source| load_image_source_bytes(&source, "markup"))
        .transpose()?;
    for (index, source) in images.iter().enumerate() {
        let (mime_type, bytes, file_name) =
            load_image_source_bytes(source, &format!("image-{}", index + 1))?;
        if mime_type == "image/svg+xml" {
            return Err(AppError::new(
                "ref_image_invalid",
                "SVG is not a supported raster input for image edits.",
            ));
        }
        if index == 0
            && let Some((mime, markup_bytes, _)) = &markup
        {
            validate_markup_images(&bytes, markup_bytes, mime)?;
        }
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
    if let Some((_, bytes, file_name)) = markup {
        let part = Part::bytes(bytes)
            .file_name(file_name)
            .mime_str("image/png")
            .map_err(|error| {
                AppError::new("ref_image_invalid", "Invalid markup MIME type.")
                    .with_detail(json!({ "error": error.to_string() }))
            })?;
        form = form.part("markup", part);
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

pub(crate) fn openai_edit_requires_json(body: &Value) -> bool {
    let has_file_id = |value: &Value| value.get("file_id").is_some();
    body.get("images")
        .and_then(Value::as_array)
        .is_some_and(|images| images.iter().any(has_file_id))
        || body.get("mask").is_some_and(has_file_id)
        || body.get("markup").is_some_and(has_file_id)
}

pub(crate) fn extract_openai_markup_source(body: &Value) -> Result<Option<String>, AppError> {
    let Some(markup) = body.get("markup").filter(|value| !value.is_null()) else {
        return Ok(None);
    };
    let source = markup
        .as_str()
        .or_else(|| markup.get("image_url").and_then(Value::as_str));
    source
        .map(|source| Some(source.to_string()))
        .ok_or_else(|| {
            AppError::new(
                "ref_image_invalid",
                "Markup must contain an image_url or use a JSON file_id input.",
            )
        })
}

pub(crate) fn validate_markup_images(
    first: &[u8],
    markup: &[u8],
    mime: &str,
) -> Result<(), AppError> {
    use image::ImageDecoder;
    let invalid = |message| AppError::new("markup_invalid", message);
    if mime != "image/png" || !markup.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err(invalid(
            "Markup must be a transparent PNG annotation layer.",
        ));
    }
    if markup.len() > 50 * 1024 * 1024 {
        return Err(invalid("Markup PNG must not exceed 50 MB."));
    }
    let decode = |bytes: &[u8]| -> Result<image::DynamicImage, AppError> {
        let reader = image::ImageReader::new(std::io::Cursor::new(bytes))
            .with_guessed_format()
            .map_err(|_| invalid("Unable to identify markup or first input image."))?;
        let mut decoder = reader
            .into_decoder()
            .map_err(|_| invalid("Unable to decode markup or first input image."))?;
        let (width, height) = decoder.dimensions();
        if u64::from(width) * u64::from(height) > 16_777_216 {
            return Err(invalid(
                "Markup and first input image must each contain at most 16,777,216 pixels.",
            ));
        }
        let orientation = decoder
            .orientation()
            .map_err(|_| invalid("Unable to read image orientation."))?;
        let mut image = image::DynamicImage::from_decoder(decoder)
            .map_err(|_| invalid("Unable to decode markup or first input image."))?;
        image.apply_orientation(orientation);
        Ok(image)
    };
    let first = decode(first)?;
    let markup = decode(markup)?;
    if first.width() != markup.width() || first.height() != markup.height() {
        return Err(invalid(
            "Markup dimensions must match the first input image after orientation.",
        ));
    }
    if !markup.to_rgba8().pixels().any(|pixel| pixel[3] < 255) {
        return Err(invalid(
            "Markup must contain transparent pixels; do not flatten it onto the original image.",
        ));
    }
    Ok(())
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
