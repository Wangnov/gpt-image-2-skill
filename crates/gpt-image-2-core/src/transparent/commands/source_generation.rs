#![allow(unused_imports)]

use super::*;

pub(crate) fn generate_source_image(
    cli: &Cli,
    selection: &ProviderSelection,
    shared: &SharedImageArgs,
) -> Result<Value, AppError> {
    if matches!(selection.kind, ProviderKind::OpenAi) {
        generate_openai_source_image(cli, selection, shared)
    } else {
        generate_codex_source_image(cli, selection, shared)
    }
}

pub(crate) fn generate_openai_source_image(
    cli: &Cli,
    selection: &ProviderSelection,
    shared: &SharedImageArgs,
) -> Result<Value, AppError> {
    let auth_state = load_openai_auth_state_for(cli, selection)?;
    let resolved_model = shared
        .model
        .clone()
        .unwrap_or_else(|| selection.default_model.clone());
    let body = build_openai_image_body(
        "generate",
        &shared.prompt,
        &resolved_model,
        &[],
        None,
        None,
        shared.background,
        shared.size.as_deref(),
        shared.quality,
        shared.output_format,
        shared.output_compression,
        shared.n,
        shared.moderation,
    );
    let endpoint = build_openai_operation_endpoint(&selection.api_base, "generate")?;
    let mut logger = JsonEventLogger::new(cli.json_events);
    let (payload, retry_count) =
        execute_openai_with_retry(&mut logger, &selection.resolved, |logger| {
            request_openai_images_once(&endpoint, &auth_state, &body, logger)
        })?;
    let (image_bytes_list, revised_prompts) = decode_openai_images(&payload)?;
    if image_bytes_list.is_empty() {
        return Err(AppError::new(
            "missing_image_result",
            "The response did not include a generated image.",
        ));
    }
    let saved_files = save_images(Path::new(&shared.out), &image_bytes_list)?;
    emit_progress_event(
        &mut logger,
        "openai",
        "source_saved",
        "Controlled transparent-PNG source image saved.",
        "completed",
        Some(50),
        json!({
            "file_count": saved_files.len(),
            "output": normalize_saved_output(&saved_files),
        }),
    );
    Ok(json!({
        "provider": selection.resolved,
        "provider_selection": selection.payload(),
        "request": summarize_image_request_options("openai", "generate", &resolved_model, shared, 0, false, None),
        "response": {
            "created": payload.get("created"),
            "background": payload.get("background"),
            "output_format": payload.get("output_format"),
            "quality": payload.get("quality"),
            "size": payload.get("size"),
            "image_count": image_bytes_list.len(),
            "revised_prompts": revised_prompts.into_iter().flatten().collect::<Vec<_>>(),
        },
        "output": normalize_saved_output(&saved_files),
        "retry": {
            "count": retry_count,
            "max_retries": DEFAULT_RETRY_COUNT,
        },
        "events": {
            "count": logger.seq,
        }
    }))
}

pub(crate) fn generate_codex_source_image(
    cli: &Cli,
    selection: &ProviderSelection,
    shared: &SharedImageArgs,
) -> Result<Value, AppError> {
    let mut auth_state = load_codex_auth_state_for(cli, selection)?;
    let resolved_model = shared
        .model
        .clone()
        .unwrap_or_else(|| selection.default_model.clone());
    let body = build_codex_image_body(
        &shared.prompt,
        &resolved_model,
        &shared.instructions,
        &[],
        shared.background,
        shared.size.as_deref(),
        shared.quality,
        shared.output_format,
        shared.output_compression,
        "generate",
    );
    let mut logger = JsonEventLogger::new(cli.json_events);
    let (outcome, auth_refreshed, retry_count) = request_codex_with_retry(
        &selection.codex_endpoint,
        &mut auth_state,
        &body,
        &mut logger,
    )?;
    let output_items = outcome
        .get("output_items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let image_items = extract_codex_image_items(&output_items);
    if image_items.is_empty() {
        return Err(AppError::new(
            "missing_image_result",
            "The response did not include an image_generation_call result.",
        ));
    }
    let image_bytes_list: Vec<Vec<u8>> = image_items
        .iter()
        .filter_map(|item| item.get("result").and_then(Value::as_str))
        .map(decode_base64_bytes)
        .collect::<Result<_, _>>()?;
    let saved_files = save_images(Path::new(&shared.out), &image_bytes_list)?;
    emit_progress_event(
        &mut logger,
        "codex",
        "source_saved",
        "Controlled transparent-PNG source image saved.",
        "completed",
        Some(50),
        json!({
            "file_count": saved_files.len(),
            "output": normalize_saved_output(&saved_files),
        }),
    );
    let response_meta = outcome
        .get("response")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let revised_prompts = image_items
        .iter()
        .filter_map(|item| item.get("revised_prompt").and_then(Value::as_str))
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    Ok(json!({
        "provider": selection.resolved,
        "provider_selection": selection.payload(),
        "request": summarize_image_request_options("codex", "generate", &resolved_model, shared, 0, false, None),
        "response": {
            "response_id": response_meta.get("id"),
            "model": response_meta.get("model"),
            "service_tier": response_meta.get("service_tier"),
            "status": response_meta.get("status"),
            "image_count": image_items.len(),
            "item_ids": image_items.iter().map(|item| item.get("id").cloned().unwrap_or(Value::Null)).collect::<Vec<_>>(),
            "revised_prompts": revised_prompts,
        },
        "output": normalize_saved_output(&saved_files),
        "retry": {
            "count": retry_count,
            "max_retries": DEFAULT_RETRY_COUNT,
        },
        "auth": {
            "source": match &auth_state.persistence {
                CodexAuthPersistence::AuthFile => "auth.json",
                CodexAuthPersistence::ConfigProvider { .. } => "config",
                CodexAuthPersistence::SessionOnly => "session",
            },
            "auth_file": auth_state.auth_path.display().to_string(),
            "account_id": auth_state.account_id,
            "refreshed": auth_refreshed,
        },
        "events": {
            "count": logger.seq,
        }
    }))
}
