use super::*;

pub(crate) fn apply_openai_image_options(body: &mut Value, shared: &SharedImageArgs) {
    if let Some(complexity) = shared.complexity {
        body["complexity"] = json!(complexity.as_str());
    }
    if let Some(count) = shared.frame_count {
        body["frame_count"] = json!(count);
    }
    if let Some(duration) = shared.frame_duration_ms {
        body["frame_duration_ms"] = json!(duration);
    }
    if let Some(model) = &shared.svg_model {
        let mut svg = json!({ "model": model });
        if let Some(effort) = shared.svg_reasoning_effort {
            svg["reasoning"] = json!({ "effort": effort.as_str() });
        }
        body["svg"] = svg;
    }
    if let Some(identifier) = &shared.safety_identifier {
        body["safety_identifier"] = json!(identifier);
    }
}

pub(crate) fn validate_image_options(
    selection: &ProviderSelection,
    shared: &SharedImageArgs,
    operation: &str,
    mask: Option<&str>,
    markup: Option<&str>,
) -> Result<(), AppError> {
    let format = shared.output_format.unwrap_or(OutputFormat::Png);
    if format != OutputFormat::Gif
        && let Some(size) = &shared.size
    {
        parse_image_size(size).map_err(|message| AppError::new("invalid_argument", message))?;
    }
    let new_options = shared.complexity.is_some()
        || shared.frame_count.is_some()
        || shared.frame_duration_ms.is_some()
        || shared.svg_model.is_some()
        || shared.svg_reasoning_effort.is_some()
        || shared.safety_identifier.is_some()
        || markup.is_some()
        || matches!(format, OutputFormat::Gif | OutputFormat::Svg);
    if new_options && !matches!(selection.kind, ProviderKind::OpenAi) {
        return Err(AppError::new(
            "unsupported_option",
            "Complexity, markup, GIF, SVG, and safety identifiers require an OpenAI Images API provider.",
        ));
    }
    let model = shared.model.as_deref().unwrap_or(&selection.default_model);
    let legacy_model = model == "gpt-image-2"
        || model.starts_with("gpt-image-2-20")
        || model.starts_with("gpt-image-1");
    let image_25 = model.starts_with("gpt-image-2.5-");
    if (legacy_model || image_25)
        && (shared.complexity.is_some() || matches!(format, OutputFormat::Gif | OutputFormat::Svg))
    {
        return Err(AppError::new(
            "unsupported_option",
            "Complexity, GIF, and SVG require a supported GPT Image 2.6 model. Select it explicitly with --model.",
        ));
    }
    if legacy_model && markup.is_some() {
        return Err(AppError::new(
            "unsupported_option",
            "Markup-guided edits require a supported GPT Image 2.5 or 2.6 model.",
        ));
    }
    let mut body = json!({
        "output_format": format.as_str(),
        "background": shared.background.as_str(),
        "n": shared.n.unwrap_or(1),
    });
    apply_openai_image_options(&mut body, shared);
    if let Some(compression) = shared.output_compression {
        body["output_compression"] = json!(compression);
    }
    if mask.is_some() {
        body["mask"] = json!({});
    }
    if markup.is_some() {
        body["markup"] = json!({});
    }
    validate_openai_body_options(&body, operation)
}

// Also validate raw requests so an incompatible combination cannot be billed
// before being rejected, or silently lost while converting JSON to multipart.
pub(crate) fn validate_openai_body_options(body: &Value, operation: &str) -> Result<(), AppError> {
    let invalid = |message| AppError::new("invalid_argument", message);
    let present = |key: &str| body.get(key).is_some_and(|value| !value.is_null());
    let format = body
        .get("output_format")
        .and_then(Value::as_str)
        .unwrap_or("png");
    if (present("frame_count") || present("frame_duration_ms")) && format != "gif" {
        return Err(invalid(
            "Frame options require --format gif (output_format=gif).",
        ));
    }
    if present("svg") && format != "svg" {
        return Err(invalid(
            "SVG author options require --format svg (output_format=svg).",
        ));
    }
    if let Some(svg) = body.get("svg").filter(|value| !value.is_null())
        && svg
            .get("model")
            .and_then(Value::as_str)
            .is_none_or(|model| model.trim().is_empty())
    {
        return Err(invalid(
            "SVG author options require a nonempty svg.model (--svg-model).",
        ));
    }
    if format == "svg"
        && (operation != "generate" || body.get("n").and_then(Value::as_u64).unwrap_or(1) != 1)
    {
        return Err(invalid("SVG output supports generation only, with n=1."));
    }
    if matches!(format, "svg" | "gif")
        && (body.get("stream").and_then(Value::as_bool).unwrap_or(false)
            || body
                .get("partial_images")
                .and_then(Value::as_u64)
                .unwrap_or(0)
                > 0
            || present("output_compression")
            || present("prompt_rewriter"))
    {
        return Err(invalid(
            "SVG/GIF output does not support streaming, partial images, output compression, or prompt_rewriter.",
        ));
    }
    if format == "gif" && present("mask") {
        return Err(invalid("GIF output does not support masks."));
    }
    if present("markup") && (operation != "edit" || present("mask") || present("prompt_rewriter")) {
        return Err(invalid(
            "Markup requires an edit request and cannot be combined with mask or prompt_rewriter.",
        ));
    }
    if body.get("background").and_then(Value::as_str) == Some("transparent")
        && !matches!(format, "png" | "webp")
    {
        return Err(invalid(
            "Transparent backgrounds require PNG or WebP output.",
        ));
    }
    if let Some(identifier) = body.get("safety_identifier").and_then(Value::as_str)
        && identifier.chars().count() > 128
    {
        return Err(invalid(
            "Safety identifiers must contain at most 128 characters.",
        ));
    }
    Ok(())
}
