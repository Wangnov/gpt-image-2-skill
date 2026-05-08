#![allow(unused_imports)]

use super::*;

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
