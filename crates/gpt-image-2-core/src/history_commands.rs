#![allow(unused_imports)]

use super::*;

pub(crate) fn run_history_command(
    _cli: &Cli,
    command: &HistoryCommand,
) -> Result<CommandOutcome, AppError> {
    match &command.history_command {
        HistorySubcommand::List => Ok(CommandOutcome {
            payload: json!({"ok": true, "command": "history list", "jobs": list_history_jobs()?}),
            exit_status: 0,
        }),
        HistorySubcommand::Show(args) | HistorySubcommand::OpenOutput(args) => {
            let row = show_history_job(&args.job_id)?;
            let opened = if matches!(&command.history_command, HistorySubcommand::OpenOutput(_)) {
                row.get("output_path")
                    .and_then(Value::as_str)
                    .map(open_path)
                    .unwrap_or(false)
            } else {
                false
            };
            Ok(CommandOutcome {
                payload: json!({"ok": true, "command": "history show", "job": row, "opened": opened}),
                exit_status: 0,
            })
        }
        HistorySubcommand::Delete(args) => {
            let count = delete_history_job(&args.job_id)?;
            Ok(CommandOutcome {
                payload: json!({"ok": true, "command": "history delete", "job_id": args.job_id, "deleted": count}),
                exit_status: 0,
            })
        }
    }
}

pub(crate) fn open_path(path: &str) -> bool {
    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(path).status();
    #[cfg(target_os = "windows")]
    let status = Command::new("cmd").args(["/C", "start", "", path]).status();
    #[cfg(all(unix, not(target_os = "macos")))]
    let status = Command::new("xdg-open").arg(path).status();
    status.map(|status| status.success()).unwrap_or(false)
}

pub(crate) fn run_doctor(cli: &Cli) -> CommandOutcome {
    let auth_path = PathBuf::from(&cli.auth_file);
    let config_path = cli_config_path(cli);
    let config = load_app_config(&config_path).unwrap_or_default();
    let codex_auth = inspect_codex_auth_file(&auth_path);
    let openai_auth = inspect_openai_auth(cli.api_key.as_deref());
    let codex_endpoint = check_endpoint_reachability(&cli.endpoint);
    let openai_endpoint = check_endpoint_reachability(&cli.openai_api_base);

    let selection = select_image_provider(cli);
    let ready = selection
        .as_ref()
        .map(|selection| {
            let endpoint = match selection.kind {
                ProviderKind::OpenAi => check_endpoint_reachability(&selection.api_base),
                ProviderKind::Codex => check_endpoint_reachability(&selection.codex_endpoint),
            };
            endpoint
                .get("reachable")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        })
        .unwrap_or(false);

    let provider_selection = match selection {
        Ok(selection) => {
            let mut payload = selection.payload();
            payload["error"] = Value::Null;
            payload
        }
        Err(error) => json!({
            "requested": cli.provider.as_str(),
            "resolved": Value::Null,
            "reason": Value::Null,
            "error": {
                "code": error.code,
                "message": error.message,
                "detail": error.detail,
            },
        }),
    };

    CommandOutcome {
        payload: json!({
            "ok": ready,
            "command": "doctor",
            "version": VERSION,
            "provider_selection": provider_selection,
            "providers": {
                "openai": {"auth": openai_auth, "endpoint": openai_endpoint},
                "codex": {"auth": codex_auth, "endpoint": codex_endpoint},
                "configured": redact_app_config(&config)["providers"].clone(),
            },
            "defaults": {
                "provider": "auto",
                "config_file": config_path.display().to_string(),
                "default_provider": config.default_provider,
                "openai_model": DEFAULT_OPENAI_MODEL,
                "codex_model": DEFAULT_CODEX_MODEL,
                "codex_endpoint": cli.endpoint,
                "openai_api_base": cli.openai_api_base,
            },
            "retry_policy": {
                "max_retries": DEFAULT_RETRY_COUNT,
                "base_delay_seconds": DEFAULT_RETRY_DELAY_SECONDS,
            }
        }),
        exit_status: 0,
    }
}

pub(crate) fn run_auth_inspect(cli: &Cli) -> Result<CommandOutcome, AppError> {
    let auth_path = PathBuf::from(&cli.auth_file);
    let config = load_app_config(&cli_config_path(cli))?;
    let providers = json!({
        "openai": inspect_openai_auth(cli.api_key.as_deref()),
        "codex": inspect_codex_auth_file(&auth_path),
        "configured": redact_app_config(&config)["providers"].clone(),
    });
    if cli.provider == "openai"
        && !providers["openai"]
            .get("ready")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    {
        return Err(AppError::new(
            "api_key_missing",
            format!("Missing {}.", OPENAI_API_KEY_ENV),
        ));
    }
    if cli.provider == "codex"
        && !providers["codex"]
            .get("ready")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    {
        return Err(AppError::new(
            "access_token_missing",
            "auth.json did not contain a usable access_token.",
        ));
    }
    Ok(CommandOutcome {
        payload: json!({
            "ok": true,
            "command": "auth inspect",
            "requested_provider": cli.provider.as_str(),
            "providers": providers,
        }),
        exit_status: 0,
    })
}

pub(crate) fn run_models_list() -> CommandOutcome {
    CommandOutcome {
        payload: json!({
            "ok": true,
            "command": "models list",
            "providers": build_known_model_payloads(),
        }),
        exit_status: 0,
    }
}
