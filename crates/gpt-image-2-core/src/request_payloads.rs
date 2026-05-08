#![allow(unused_imports)]

use super::*;

pub(crate) fn maybe_add_value(target: &mut Map<String, Value>, key: &str, value: Option<Value>) {
    if let Some(value) = value {
        target.insert(key.to_string(), value);
    }
}

#[allow(clippy::too_many_arguments)]
pub fn build_openai_image_body(
    operation: &str,
    prompt: &str,
    model: &str,
    ref_images: &[String],
    mask: Option<&str>,
    input_fidelity: Option<InputFidelity>,
    background: Background,
    size: Option<&str>,
    quality: Option<Quality>,
    output_format: Option<OutputFormat>,
    output_compression: Option<u8>,
    n: Option<u8>,
    moderation: Option<Moderation>,
) -> Value {
    let mut body = Map::new();
    body.insert("model".to_string(), json!(model));
    body.insert("prompt".to_string(), json!(prompt));
    body.insert("background".to_string(), json!(background.as_str()));
    maybe_add_value(&mut body, "size", size.map(|value| json!(value)));
    maybe_add_value(
        &mut body,
        "quality",
        quality.map(|value| json!(value.as_str())),
    );
    maybe_add_value(
        &mut body,
        "output_format",
        output_format.map(|value| json!(value.as_str())),
    );
    maybe_add_value(
        &mut body,
        "output_compression",
        output_compression.map(|value| json!(value)),
    );
    maybe_add_value(&mut body, "n", n.map(|value| json!(value)));
    maybe_add_value(
        &mut body,
        "moderation",
        moderation.map(|value| json!(value.as_str())),
    );
    if operation == "edit" {
        body.insert(
            "images".to_string(),
            Value::Array(
                ref_images
                    .iter()
                    .map(|image_url| json!({ "image_url": image_url }))
                    .collect(),
            ),
        );
        if let Some(mask) = mask {
            body.insert("mask".to_string(), json!({ "image_url": mask }));
        }
        maybe_add_value(
            &mut body,
            "input_fidelity",
            input_fidelity.map(|value| json!(value.as_str())),
        );
    }
    Value::Object(body)
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn build_codex_image_body(
    prompt: &str,
    model: &str,
    instructions: &str,
    ref_images: &[String],
    background: Background,
    size: Option<&str>,
    quality: Option<Quality>,
    output_format: Option<OutputFormat>,
    output_compression: Option<u8>,
    action: &str,
) -> Value {
    let mut content = Vec::new();
    for image_url in ref_images {
        content.push(json!({"type": "input_image", "image_url": image_url}));
    }
    content.push(json!({"type": "input_text", "text": prompt}));
    let mut tool = Map::new();
    tool.insert("type".to_string(), json!("image_generation"));
    tool.insert("background".to_string(), json!(background.as_str()));
    tool.insert("action".to_string(), json!(action));
    maybe_add_value(&mut tool, "size", size.map(|value| json!(value)));
    maybe_add_value(
        &mut tool,
        "quality",
        quality.map(|value| json!(value.as_str())),
    );
    maybe_add_value(
        &mut tool,
        "output_format",
        output_format.map(|value| json!(value.as_str())),
    );
    maybe_add_value(
        &mut tool,
        "output_compression",
        output_compression.map(|value| json!(value)),
    );

    json!({
        "model": model,
        "instructions": instructions,
        "store": false,
        "stream": true,
        "input": [
            {
                "role": "user",
                "content": content,
            }
        ],
        "tools": [Value::Object(tool)],
    })
}

pub(crate) fn summarize_large_string(key: Option<&str>, value: &str) -> Value {
    let lowered = key.unwrap_or_default().to_ascii_lowercase();
    if value.starts_with("data:image/") {
        let (prefix, encoded) = value.split_once(',').unwrap_or((value, ""));
        return json!({
            "_omitted": "data_url",
            "prefix": prefix,
            "base64_chars": encoded.len(),
        });
    }
    if lowered == "result" || lowered.contains("partial_image") || is_probably_base64(value) {
        return json!({
            "_omitted": "base64",
            "base64_chars": value.len(),
        });
    }
    json!({
        "_omitted": "string",
        "chars": value.len(),
    })
}

pub(crate) fn redact_event_payload(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut redacted = Map::new();
            for (key, child) in object {
                let lowered = key.to_ascii_lowercase();
                if [
                    "access_token",
                    "refresh_token",
                    "id_token",
                    "authorization",
                    "api_key",
                ]
                .contains(&lowered.as_str())
                {
                    redacted.insert(key.clone(), json!({"_omitted": "secret"}));
                } else {
                    redacted.insert(key.clone(), redact_value_with_key(Some(key), child));
                }
            }
            Value::Object(redacted)
        }
        Value::Array(items) => Value::Array(items.iter().map(redact_event_payload).collect()),
        _ => value.clone(),
    }
}

pub(crate) fn redact_value_with_key(key: Option<&str>, value: &Value) -> Value {
    match value {
        Value::Object(_) | Value::Array(_) => redact_event_payload(value),
        Value::String(text) => {
            let lowered = key.unwrap_or_default().to_ascii_lowercase();
            if text.starts_with("data:image/")
                || lowered == "result"
                || lowered == "image_url"
                || lowered == "b64_json"
                || lowered.contains("partial_image")
                || (text.len() >= 512 && is_probably_base64(text))
            {
                summarize_large_string(key, text)
            } else {
                value.clone()
            }
        }
        _ => value.clone(),
    }
}

pub(crate) fn is_probably_base64(value: &str) -> bool {
    if value.len() < 128 {
        return false;
    }
    value
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || "+/=\n\r".contains(character))
}

pub(crate) fn emit_progress_event(
    logger: &mut JsonEventLogger,
    provider: &str,
    phase: &str,
    message: &str,
    status: &str,
    percent: Option<u8>,
    extra: Value,
) {
    let mut data = json!({
        "provider": provider,
        "phase": phase,
        "status": status,
        "message": message,
    });
    if let Some(percent) = percent {
        data["percent"] = json!(percent);
    }
    if let Some(object) = extra.as_object() {
        for (key, value) in object {
            data[key] = redact_value_with_key(Some(key), value);
        }
    }
    logger.emit("progress", phase, data);
}

pub(crate) fn emit_sse_event(logger: &mut JsonEventLogger, event: &Value) {
    let event_type = event
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    logger.emit("sse", event_type, redact_event_payload(event));
}

pub(crate) fn build_known_model_payloads() -> Value {
    json!({
        "openai": {
            "default_model": DEFAULT_OPENAI_MODEL,
            "model_presets": [{
                "id": DEFAULT_OPENAI_MODEL,
                "default": true,
                "source": "official_default",
                "notes": "Official API-key image generation model."
            }],
            "operations": [
                {"id": "generate", "command": "images generate", "requires_ref_image": false},
                {"id": "edit", "command": "images edit", "requires_ref_image": true}
            ],
            "supports": ["background", "size", "quality", "format", "compression", "n", "moderation", "mask", "input_fidelity"]
        },
        "codex": {
            "default_model": DEFAULT_CODEX_MODEL,
            "model_presets": [
                {"id": "gpt-5.4", "default": true, "source": "local_preset", "notes": "Validated default for the Codex responses image path."},
                {"id": "gpt-5.4-mini", "default": false, "source": "local_preset", "notes": "Pass explicitly when the account exposes this Codex model."},
                {"id": "gpt-5.4-pro", "default": false, "source": "local_preset", "notes": "Pass explicitly when the account exposes this Codex model."}
            ],
            "image_generation_tool": {
                "type": "image_generation",
                "delegated_model": DELEGATED_IMAGE_MODEL,
                "operations": [
                    {"id": "generate", "command": "images generate", "requires_ref_image": false},
                    {"id": "edit", "command": "images edit", "requires_ref_image": true}
                ],
                "supports": ["background", "size", "quality", "format", "compression", "action", "json_events", "auth_refresh"]
            }
        }
    })
}
