#![allow(unused_imports)]

use super::*;

pub(crate) fn run_request_create_codex(
    cli: &Cli,
    selection: &ProviderSelection,
    args: &RequestCreateArgs,
) -> Result<CommandOutcome, AppError> {
    if args.request_operation != RequestOperation::Responses {
        return Err(AppError::new(
            "unsupported_option",
            "Codex request create uses --request-operation responses.",
        ));
    }
    let mut auth_state = load_codex_auth_state_for(cli, selection)?;
    let body = read_body_json(&args.body_file)?;
    let mut logger = JsonEventLogger::new(cli.json_events);
    let (outcome, auth_refreshed, retry_count) = request_codex_with_retry(
        &selection.codex_endpoint,
        &mut auth_state,
        &body,
        &mut logger,
    )?;
    let response_meta = outcome
        .get("response")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let output_items = outcome
        .get("output_items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let image_items = extract_codex_image_items(&output_items);
    let image_output = if image_items.is_empty() {
        None
    } else {
        let image_bytes_list: Vec<Vec<u8>> = image_items
            .iter()
            .filter_map(|item| item.get("result").and_then(Value::as_str))
            .map(decode_base64_bytes)
            .collect::<Result<_, _>>()?;
        if let Some(out_image) = &args.out_image {
            let saved_files = save_images(Path::new(out_image), &image_bytes_list)?;
            let output = normalize_saved_output(&saved_files);
            emit_progress_event(
                &mut logger,
                "codex",
                "output_saved",
                "Generated image files saved.",
                "completed",
                Some(100),
                json!({ "file_count": saved_files.len(), "output": output }),
            );
            Some(output)
        } else {
            Some(json!({
                "available": true,
                "count": image_bytes_list.len(),
                "suggested_extension": detect_extension(&image_bytes_list[0]),
            }))
        }
    };
    if args.expect_image && image_output.is_none() {
        return Err(AppError::new(
            "missing_image_result",
            "The response did not include a generated image.",
        ));
    }
    let history_job_id = record_history_job(
        "request create",
        &selection.resolved,
        "completed",
        args.out_image.as_deref().map(Path::new),
        json!({
            "operation": "responses",
            "provider_selection": selection.payload(),
            "image_output": image_output.clone(),
        }),
    )
    .ok();
    Ok(CommandOutcome {
        payload: json!({
            "ok": true,
            "command": "request create",
            "provider": selection.resolved,
            "provider_selection": selection.payload(),
            "request": {
                "operation": "responses",
                "body_file": args.body_file,
            },
            "response": {
                "response_id": response_meta.get("id"),
                "model": response_meta.get("model"),
                "service_tier": response_meta.get("service_tier"),
                "status": response_meta.get("status"),
                "error": response_meta.get("error").map(redact_event_payload).unwrap_or(Value::Null),
            },
            "output_items": output_items.iter().map(summarize_output_item).collect::<Vec<_>>(),
            "image_output": image_output,
            "history": {
                "job_id": history_job_id,
            },
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
                "refreshed": auth_refreshed,
            },
            "events": {
                "count": logger.seq,
            }
        }),
        exit_status: 0,
    })
}

pub(crate) fn run_request_create_openai(
    cli: &Cli,
    selection: &ProviderSelection,
    args: &RequestCreateArgs,
) -> Result<CommandOutcome, AppError> {
    if !matches!(
        args.request_operation,
        RequestOperation::Generate | RequestOperation::Edit
    ) {
        return Err(AppError::new(
            "unsupported_option",
            "OpenAI request create uses --request-operation generate or edit.",
        ));
    }
    let auth_state = load_openai_auth_state_for(cli, selection)?;
    let body = read_body_json(&args.body_file)?;
    let endpoint =
        build_openai_operation_endpoint(&selection.api_base, args.request_operation.as_str())?;
    let mut logger = JsonEventLogger::new(cli.json_events);
    let (payload, retry_count) =
        execute_openai_with_retry(&mut logger, &selection.resolved, |logger| {
            if args.request_operation == RequestOperation::Edit {
                request_openai_edit_once(&endpoint, &auth_state, &body, logger)
            } else {
                request_openai_images_once(&endpoint, &auth_state, &body, logger)
            }
        })?;
    let (image_bytes_list, revised_prompts) = decode_openai_images(&payload)?;
    let image_output = if image_bytes_list.is_empty() {
        None
    } else if let Some(out_image) = &args.out_image {
        let saved_files = save_images(Path::new(out_image), &image_bytes_list)?;
        let output = normalize_saved_output(&saved_files);
        emit_progress_event(
            &mut logger,
            "openai",
            "output_saved",
            "Generated image files saved.",
            "completed",
            Some(100),
            json!({ "file_count": saved_files.len(), "output": output }),
        );
        Some(output)
    } else {
        Some(json!({
            "available": true,
            "count": image_bytes_list.len(),
            "suggested_extension": detect_extension(&image_bytes_list[0]),
        }))
    };
    if args.expect_image && image_output.is_none() {
        return Err(AppError::new(
            "missing_image_result",
            "The response did not include a generated image.",
        ));
    }
    let history_job_id = record_history_job(
        "request create",
        &selection.resolved,
        "completed",
        args.out_image.as_deref().map(Path::new),
        json!({
            "operation": args.request_operation.as_str(),
            "provider_selection": selection.payload(),
            "image_output": image_output.clone(),
        }),
    )
    .ok();
    Ok(CommandOutcome {
        payload: json!({
            "ok": true,
            "command": "request create",
            "provider": selection.resolved,
            "provider_selection": selection.payload(),
            "request": {
                "operation": args.request_operation.as_str(),
                "body_file": args.body_file,
                "model": body.get("model"),
            },
            "response": {
                "created": payload.get("created"),
                "background": payload.get("background"),
                "output_format": payload.get("output_format"),
                "quality": payload.get("quality"),
                "size": payload.get("size"),
                "usage": payload.get("usage").map(redact_event_payload).unwrap_or(Value::Null),
                "revised_prompts": revised_prompts.into_iter().flatten().collect::<Vec<_>>(),
            },
            "image_output": image_output,
            "history": {
                "job_id": history_job_id,
            },
            "retry": {
                "count": retry_count,
                "max_retries": DEFAULT_RETRY_COUNT,
            },
            "auth": {
                "source": auth_state.source,
                "env_var": OPENAI_API_KEY_ENV,
                "refreshed": false,
            },
            "events": {
                "count": logger.seq,
            }
        }),
        exit_status: 0,
    })
}

pub(crate) fn run_request_create(
    cli: &Cli,
    args: &RequestCreateArgs,
) -> Result<CommandOutcome, AppError> {
    let selection = select_request_provider(cli, args)?;
    if matches!(selection.kind, ProviderKind::OpenAi) {
        run_request_create_openai(cli, &selection, args)
    } else {
        run_request_create_codex(cli, &selection, args)
    }
}

pub(crate) fn dispatch(cli: &Cli) -> Result<CommandOutcome, AppError> {
    match &cli.command {
        Commands::Doctor => Ok(run_doctor(cli)),
        Commands::Auth(command) => match command.auth_command {
            AuthSubcommand::Inspect => run_auth_inspect(cli),
        },
        Commands::Config(command) => run_config_command(cli, command),
        Commands::Secret(command) => run_secret_command(cli, command),
        Commands::History(command) => run_history_command(cli, command),
        Commands::Models(command) => match command.models_command {
            ModelsSubcommand::List => Ok(run_models_list()),
        },
        Commands::Images(command) => run_images_command(cli, &command.images_command),
        Commands::Transparent(command) => transparent::run_transparent_command(cli, command),
        Commands::Request(command) => match &command.request_command {
            RequestSubcommand::Create(args) => run_request_create(cli, args),
        },
    }
}

pub fn run(argv: &[String]) -> i32 {
    let outcome = run_json(argv);
    emit_json(&outcome.payload);
    outcome.exit_status
}

pub fn run_json(argv: &[String]) -> CommandOutcome {
    match Cli::try_parse_from(argv) {
        Ok(cli) => match dispatch(&cli) {
            Ok(outcome) => outcome,
            Err(error) => {
                let (payload, exit_status) = build_error_payload(error);
                CommandOutcome {
                    payload,
                    exit_status,
                }
            }
        },
        Err(error) => {
            let app_error = AppError::new("invalid_command", error.to_string()).with_exit_status(2);
            let (payload, exit_status) = build_error_payload(app_error);
            CommandOutcome {
                payload,
                exit_status,
            }
        }
    }
}
