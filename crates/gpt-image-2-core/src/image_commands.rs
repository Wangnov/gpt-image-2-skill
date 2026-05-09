#![allow(unused_imports)]

use super::*;

pub(crate) fn run_openai_image_command(
    cli: &Cli,
    selection: &ProviderSelection,
    shared: &SharedImageArgs,
    operation: &str,
    ref_images: &[String],
    mask: Option<&str>,
    input_fidelity: Option<InputFidelity>,
) -> Result<CommandOutcome, AppError> {
    let output_path = PathBuf::from(&shared.out);
    let auth_state = load_openai_auth_state_for(cli, selection)?;
    let resolved_ref_images = resolve_ref_images(ref_images)?;
    let resolved_mask = match mask {
        Some(mask) => Some(resolve_ref_image(mask)?),
        None => None,
    };
    let resolved_model = shared
        .model
        .clone()
        .unwrap_or_else(|| selection.default_model.clone());
    let body = build_openai_image_body(
        operation,
        &shared.prompt,
        &resolved_model,
        &resolved_ref_images,
        resolved_mask.as_deref(),
        input_fidelity,
        shared.background,
        shared.size.as_deref(),
        shared.quality,
        shared.output_format,
        shared.output_compression,
        shared.n,
        shared.moderation,
    );
    let endpoint = build_openai_operation_endpoint(&selection.api_base, operation)?;
    let mut logger = JsonEventLogger::new(cli.json_events);
    let (payload, retry_count) =
        execute_openai_with_retry(&mut logger, &selection.resolved, |logger| {
            if operation == "edit" {
                request_openai_edit_once(&endpoint, &auth_state, &body, logger)
            } else {
                request_openai_images_once(&endpoint, &auth_state, &body, logger)
            }
        })?;
    let (image_bytes_list, revised_prompts) = decode_openai_images(&payload)?;
    if image_bytes_list.is_empty() {
        return Err(AppError::new(
            "missing_image_result",
            "The response did not include a generated image.",
        ));
    }
    let saved_files = save_images(&output_path, &image_bytes_list)?;
    let primary_output_path = primary_saved_output_path(&output_path, &saved_files);
    let history_job_id = record_history_job(
        &format!("images {operation}"),
        &selection.resolved,
        "completed",
        Some(&primary_output_path),
        history_image_metadata(operation, selection, shared, &saved_files),
    )
    .ok();
    emit_progress_event(
        &mut logger,
        "openai",
        "output_saved",
        "Generated image files saved.",
        "completed",
        Some(100),
        json!({
            "file_count": saved_files.len(),
            "output": normalize_saved_output(&saved_files),
        }),
    );
    Ok(CommandOutcome {
        payload: json!({
            "ok": true,
            "command": format!("images {}", operation),
            "provider": selection.resolved,
            "provider_selection": selection.payload(),
            "auth": {
                "source": auth_state.source,
                "env_var": OPENAI_API_KEY_ENV,
                "refreshed": false,
            },
            "request": summarize_image_request_options("openai", operation, &resolved_model, shared, resolved_ref_images.len(), resolved_mask.is_some(), input_fidelity),
            "response": {
                "created": payload.get("created"),
                "background": payload.get("background"),
                "output_format": payload.get("output_format"),
                "quality": payload.get("quality"),
                "size": payload.get("size"),
                "usage": payload.get("usage").map(redact_event_payload).unwrap_or(Value::Null),
                "image_count": image_bytes_list.len(),
                "revised_prompts": revised_prompts.into_iter().flatten().collect::<Vec<_>>(),
            },
            "output": normalize_saved_output(&saved_files),
            "history": {
                "job_id": history_job_id,
            },
            "retry": {
                "count": retry_count,
                "max_retries": DEFAULT_RETRY_COUNT,
            },
            "events": {
                "count": logger.seq,
            }
        }),
        exit_status: 0,
    })
}

pub(crate) fn run_codex_image_command(
    cli: &Cli,
    selection: &ProviderSelection,
    shared: &SharedImageArgs,
    operation: &str,
    ref_images: &[String],
) -> Result<CommandOutcome, AppError> {
    let mut auth_state = load_codex_auth_state_for(cli, selection)?;
    let output_path = PathBuf::from(&shared.out);
    let resolved_ref_images = resolve_ref_images(ref_images)?;
    let resolved_model = shared
        .model
        .clone()
        .unwrap_or_else(|| selection.default_model.clone());
    let body = build_codex_image_body(
        &shared.prompt,
        &resolved_model,
        &shared.instructions,
        &resolved_ref_images,
        shared.background,
        shared.size.as_deref(),
        shared.quality,
        shared.output_format,
        shared.output_compression,
        operation,
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
    let saved_files = save_images(&output_path, &image_bytes_list)?;
    let primary_output_path = primary_saved_output_path(&output_path, &saved_files);
    let history_job_id = record_history_job(
        &format!("images {operation}"),
        &selection.resolved,
        "completed",
        Some(&primary_output_path),
        history_image_metadata(operation, selection, shared, &saved_files),
    )
    .ok();
    emit_progress_event(
        &mut logger,
        "codex",
        "output_saved",
        "Generated image files saved.",
        "completed",
        Some(100),
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
    Ok(CommandOutcome {
        payload: json!({
            "ok": true,
            "command": format!("images {}", operation),
            "provider": selection.resolved,
            "provider_selection": selection.payload(),
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
            "request": summarize_image_request_options("codex", operation, &resolved_model, shared, resolved_ref_images.len(), false, None),
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
            "history": {
                "job_id": history_job_id,
            },
            "retry": {
                "count": retry_count,
                "max_retries": DEFAULT_RETRY_COUNT,
            },
            "events": {
                "count": logger.seq,
            }
        }),
        exit_status: 0,
    })
}

pub(crate) fn cli_batch_output_path(output_path: &Path, index: usize) -> String {
    let base_name = output_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .or_else(|| output_path.file_name().and_then(|name| name.to_str()))
        .unwrap_or("image");
    let suffix = output_path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| format!(".{ext}"))
        .unwrap_or_else(|| ".png".to_string());
    output_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(format!("{base_name}-{}{}", index + 1, suffix))
        .display()
        .to_string()
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

pub(crate) fn normalize_batch_saved_files(files: Vec<Value>) -> Vec<Value> {
    files
        .into_iter()
        .enumerate()
        .map(|(index, mut file)| {
            if let Value::Object(object) = &mut file {
                object.insert("index".to_string(), json!(index));
            }
            file
        })
        .collect()
}

pub(crate) fn run_batched_image_command(
    cli: &Cli,
    selection: &ProviderSelection,
    shared: &SharedImageArgs,
    operation: &str,
    ref_images: &[String],
    mask: Option<&str>,
    input_fidelity: Option<InputFidelity>,
) -> Result<CommandOutcome, AppError> {
    let count = shared.n.unwrap_or(1);
    let output_path = PathBuf::from(&shared.out);
    let jobs = (0..count)
        .map(|index| {
            let mut next = shared.clone();
            next.n = None;
            next.out = cli_batch_output_path(&output_path, index as usize);
            next
        })
        .collect::<Vec<_>>();
    let outcomes = std::thread::scope(|scope| {
        let handles = jobs
            .into_iter()
            .map(|next| {
                scope.spawn(move || {
                    if matches!(selection.kind, ProviderKind::OpenAi) {
                        run_openai_image_command(
                            cli,
                            selection,
                            &next,
                            operation,
                            ref_images,
                            mask,
                            input_fidelity,
                        )
                    } else {
                        run_codex_image_command(cli, selection, &next, operation, ref_images)
                    }
                })
            })
            .collect::<Vec<_>>();
        let mut outcomes = Vec::with_capacity(handles.len());
        for handle in handles {
            outcomes.push(handle.join().map_err(|_| {
                AppError::new(
                    "batch_worker_failed",
                    "Batch image request worker panicked.",
                )
            })??);
        }
        Ok::<_, AppError>(outcomes)
    })?;
    let saved_files = normalize_batch_saved_files(
        outcomes
            .iter()
            .flat_map(|outcome| output_files_from_payload(&outcome.payload))
            .collect(),
    );
    if saved_files.is_empty() {
        return Err(AppError::new(
            "missing_image_result",
            "The batch response did not include generated images.",
        ));
    }
    let primary_output_path = primary_saved_output_path(&output_path, &saved_files);
    let history_job_id = record_history_job(
        &format!("images {operation}"),
        &selection.resolved,
        "completed",
        Some(&primary_output_path),
        history_image_metadata(operation, selection, shared, &saved_files),
    )
    .ok();
    Ok(CommandOutcome {
        payload: json!({
            "ok": true,
            "command": format!("images {}", operation),
            "provider": selection.resolved,
            "provider_selection": selection.payload(),
            "request": {
                "operation": operation,
                "provider": if matches!(selection.kind, ProviderKind::OpenAi) { "openai" } else { "codex" },
                "n": count,
                "batch_mode": "parallel-single-output",
            },
            "response": {
                "image_count": saved_files.len(),
                "batch_request_count": count,
            },
            "output": normalize_saved_output(&saved_files),
            "history": {
                "job_id": history_job_id,
            },
            "events": {
                "count": outcomes.iter().filter_map(|outcome| outcome.payload.get("events").and_then(|events| events.get("count")).and_then(Value::as_u64)).sum::<u64>(),
            }
        }),
        exit_status: 0,
    })
}

pub(crate) fn run_images_command(
    cli: &Cli,
    subcommand: &ImagesSubcommand,
) -> Result<CommandOutcome, AppError> {
    let selection = select_image_provider(cli)?;
    match subcommand {
        ImagesSubcommand::Generate(args) => {
            let use_batch = args.shared.n.unwrap_or(1) > 1 && !selection.supports_n;
            let mut validation_shared = args.shared.clone();
            if use_batch {
                validation_shared.n = None;
            }
            validate_provider_specific_image_args(&selection, &validation_shared, None, None)?;
            if use_batch {
                return run_batched_image_command(
                    cli,
                    &selection,
                    &args.shared,
                    "generate",
                    &[],
                    None,
                    None,
                );
            }
            if matches!(selection.kind, ProviderKind::OpenAi) {
                run_openai_image_command(cli, &selection, &args.shared, "generate", &[], None, None)
            } else {
                run_codex_image_command(cli, &selection, &args.shared, "generate", &[])
            }
        }
        ImagesSubcommand::Edit(args) => {
            validate_reference_image_count(args.ref_image.len())?;
            let use_batch = args.shared.n.unwrap_or(1) > 1 && !selection.supports_n;
            let mut validation_shared = args.shared.clone();
            if use_batch {
                validation_shared.n = None;
            }
            validate_provider_specific_image_args(
                &selection,
                &validation_shared,
                args.mask.as_deref(),
                args.input_fidelity,
            )?;
            if use_batch {
                return run_batched_image_command(
                    cli,
                    &selection,
                    &args.shared,
                    "edit",
                    &args.ref_image,
                    args.mask.as_deref(),
                    args.input_fidelity,
                );
            }
            if matches!(selection.kind, ProviderKind::OpenAi) {
                run_openai_image_command(
                    cli,
                    &selection,
                    &args.shared,
                    "edit",
                    &args.ref_image,
                    args.mask.as_deref(),
                    args.input_fidelity,
                )
            } else {
                run_codex_image_command(cli, &selection, &args.shared, "edit", &args.ref_image)
            }
        }
    }
}
