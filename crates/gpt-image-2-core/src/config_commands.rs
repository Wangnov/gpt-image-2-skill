#![allow(unused_imports)]

use super::*;

pub(crate) fn run_config_command(
    cli: &Cli,
    command: &ConfigCommand,
) -> Result<CommandOutcome, AppError> {
    match &command.config_command {
        ConfigSubcommand::Path => Ok(CommandOutcome {
            payload: json!({
                "ok": true,
                "command": "config path",
                "config_dir": shared_config_dir().display().to_string(),
                "config_file": cli_config_path(cli).display().to_string(),
                "history_file": history_db_path().display().to_string(),
                "jobs_dir": jobs_dir().display().to_string(),
            }),
            exit_status: 0,
        }),
        ConfigSubcommand::Inspect => {
            let path = cli_config_path(cli);
            let config = load_app_config(&path)?;
            Ok(CommandOutcome {
                payload: json!({
                    "ok": true,
                    "command": "config inspect",
                    "config_file": path.display().to_string(),
                    "exists": path.is_file(),
                    "config": redact_app_config(&config),
                }),
                exit_status: 0,
            })
        }
        ConfigSubcommand::ListProviders => {
            let path = cli_config_path(cli);
            let config = load_app_config(&path)?;
            Ok(CommandOutcome {
                payload: json!({
                    "ok": true,
                    "command": "config list-providers",
                    "default_provider": config.default_provider,
                    "providers": redact_app_config(&config)["providers"].clone(),
                }),
                exit_status: 0,
            })
        }
        ConfigSubcommand::SetDefault(args) => {
            validate_provider_name(&args.name)?;
            let path = cli_config_path(cli);
            let mut config = load_app_config(&path)?;
            if !provider_is_builtin(&args.name) && !config.providers.contains_key(&args.name) {
                return Err(AppError::new(
                    "provider_unknown",
                    format!("Unknown provider: {}", args.name),
                ));
            }
            config.default_provider = Some(args.name.clone());
            save_app_config(&path, &config)?;
            Ok(CommandOutcome {
                payload: json!({
                    "ok": true,
                    "command": "config set-default",
                    "default_provider": args.name,
                    "config_file": path.display().to_string(),
                }),
                exit_status: 0,
            })
        }
        ConfigSubcommand::AddProvider(args) => run_config_add_provider(cli, args),
        ConfigSubcommand::RemoveProvider(args) => {
            let path = cli_config_path(cli);
            let mut config = load_app_config(&path)?;
            let removed = config.providers.remove(&args.name).is_some();
            if config.default_provider.as_deref() == Some(args.name.as_str()) {
                config.default_provider = None;
            }
            save_app_config(&path, &config)?;
            Ok(CommandOutcome {
                payload: json!({
                    "ok": true,
                    "command": "config remove-provider",
                    "provider": args.name,
                    "removed": removed,
                }),
                exit_status: 0,
            })
        }
        ConfigSubcommand::TestProvider(args) => {
            let selection = select_configured_provider(cli, &args.name, "config_test_provider")?;
            let endpoint = match selection.kind {
                ProviderKind::OpenAi => check_endpoint_reachability(&selection.api_base),
                ProviderKind::Codex => check_endpoint_reachability(&selection.codex_endpoint),
            };
            Ok(CommandOutcome {
                payload: json!({
                    "ok": endpoint.get("reachable").and_then(Value::as_bool).unwrap_or(false),
                    "command": "config test-provider",
                    "provider_selection": selection.payload(),
                    "endpoint": endpoint,
                }),
                exit_status: 0,
            })
        }
    }
}

pub(crate) fn run_config_add_provider(
    cli: &Cli,
    args: &AddProviderArgs,
) -> Result<CommandOutcome, AppError> {
    validate_provider_name(&args.name)?;
    let path = cli_config_path(cli);
    let mut config = load_app_config(&path)?;
    if args.supports_n && args.no_supports_n {
        return Err(AppError::new(
            "invalid_provider_config",
            "Use either --supports-n or --no-supports-n, not both.",
        ));
    }
    let edit_region_mode = args
        .edit_region_mode
        .as_deref()
        .map(normalize_edit_region_mode)
        .transpose()?;
    let mut credentials = BTreeMap::new();
    if let Some(api_key) = &args.api_key {
        credentials.insert(
            "api_key".to_string(),
            CredentialRef::File {
                value: api_key.clone(),
            },
        );
    }
    if let Some(api_key_env) = &args.api_key_env {
        credentials.insert(
            "api_key".to_string(),
            CredentialRef::Env {
                env: api_key_env.clone(),
            },
        );
    }
    if let Some(account_id) = &args.account_id {
        credentials.insert(
            "account_id".to_string(),
            CredentialRef::File {
                value: account_id.clone(),
            },
        );
    }
    if let Some(access_token) = &args.access_token {
        credentials.insert(
            "access_token".to_string(),
            CredentialRef::File {
                value: access_token.clone(),
            },
        );
    }
    if let Some(refresh_token) = &args.refresh_token {
        credentials.insert(
            "refresh_token".to_string(),
            CredentialRef::File {
                value: refresh_token.clone(),
            },
        );
    }
    let model = args
        .model
        .clone()
        .or_else(|| match args.provider_type.as_str() {
            "codex" => Some(DEFAULT_CODEX_MODEL.to_string()),
            _ => Some(DEFAULT_OPENAI_MODEL.to_string()),
        });
    let supports_n = if args.supports_n {
        Some(true)
    } else if args.no_supports_n {
        Some(false)
    } else {
        None
    };
    config.providers.insert(
        args.name.clone(),
        ProviderConfig {
            provider_type: args.provider_type.clone(),
            api_base: args.api_base.clone(),
            endpoint: args.endpoint.clone(),
            model,
            credentials,
            supports_n,
            edit_region_mode,
        },
    );
    if args.set_default || config.default_provider.is_none() {
        config.default_provider = Some(args.name.clone());
    }
    save_app_config(&path, &config)?;
    Ok(CommandOutcome {
        payload: json!({
            "ok": true,
            "command": "config add-provider",
            "provider": args.name,
            "config_file": path.display().to_string(),
            "config": redact_app_config(&config),
        }),
        exit_status: 0,
    })
}

pub(crate) fn run_secret_command(
    cli: &Cli,
    command: &SecretCommand,
) -> Result<CommandOutcome, AppError> {
    match &command.secret_command {
        SecretSubcommand::Set(args) => run_secret_set(cli, args),
        SecretSubcommand::Get(args) => run_secret_get(cli, args),
        SecretSubcommand::Delete(args) => run_secret_delete(cli, args),
    }
}

pub(crate) fn read_secret_value(args_value: &Option<String>) -> Result<String, AppError> {
    if let Some(value) = args_value {
        return Ok(value.clone());
    }
    let mut value = String::new();
    io::stdin().read_to_string(&mut value).map_err(|error| {
        AppError::new("secret_read_failed", "Unable to read secret from stdin.")
            .with_detail(json!({"error": error.to_string()}))
    })?;
    Ok(value.trim_end_matches(['\r', '\n']).to_string())
}

pub(crate) fn run_secret_set(cli: &Cli, args: &SecretSetArgs) -> Result<CommandOutcome, AppError> {
    let path = cli_config_path(cli);
    let mut config = load_app_config(&path)?;
    let provider = config.providers.get_mut(&args.provider).ok_or_else(|| {
        AppError::new(
            "provider_unknown",
            format!("Unknown provider: {}", args.provider),
        )
    })?;
    let credential = match args.source.as_str() {
        "file" => CredentialRef::File {
            value: read_secret_value(&args.value)?,
        },
        "env" => CredentialRef::Env {
            env: args.env.clone().ok_or_else(|| {
                AppError::new("secret_env_missing", "--env is required for env secrets.")
            })?,
        },
        "keychain" => {
            let account = args
                .account
                .clone()
                .unwrap_or_else(|| default_keychain_account(&args.provider, &args.name));
            let value = read_secret_value(&args.value)?;
            write_keychain_secret(KEYCHAIN_SERVICE, &account, &value)?;
            CredentialRef::Keychain {
                service: Some(KEYCHAIN_SERVICE.to_string()),
                account,
            }
        }
        other => {
            return Err(AppError::new(
                "secret_source_unsupported",
                format!("Unsupported secret source: {other}"),
            ));
        }
    };
    provider.credentials.insert(args.name.clone(), credential);
    save_app_config(&path, &config)?;
    Ok(CommandOutcome {
        payload: json!({
            "ok": true,
            "command": "secret set",
            "provider": args.provider,
            "name": args.name,
            "config_file": path.display().to_string(),
        }),
        exit_status: 0,
    })
}

pub(crate) fn run_secret_get(cli: &Cli, args: &SecretGetArgs) -> Result<CommandOutcome, AppError> {
    let config = load_app_config(&cli_config_path(cli))?;
    let provider = config.providers.get(&args.provider).ok_or_else(|| {
        AppError::new(
            "provider_unknown",
            format!("Unknown provider: {}", args.provider),
        )
    })?;
    let credential = provider.credentials.get(&args.name).ok_or_else(|| {
        AppError::new(
            "credential_missing",
            format!("Missing credential: {}", args.name),
        )
    })?;
    let resolved = resolve_credential(credential);
    if args.status {
        return Ok(CommandOutcome {
            payload: json!({
                "ok": true,
                "command": "secret get",
                "provider": args.provider,
                "name": args.name,
                "status": redact_credential_ref(credential),
                "ready": resolved.is_ok(),
            }),
            exit_status: 0,
        });
    }
    let (value, source) = resolved?;
    Ok(CommandOutcome {
        payload: json!({
            "ok": true,
            "command": "secret get",
            "provider": args.provider,
            "name": args.name,
            "source": source,
            "value": value,
        }),
        exit_status: 0,
    })
}

pub(crate) fn run_secret_delete(
    cli: &Cli,
    args: &SecretDeleteArgs,
) -> Result<CommandOutcome, AppError> {
    let path = cli_config_path(cli);
    let mut config = load_app_config(&path)?;
    let provider = config.providers.get_mut(&args.provider).ok_or_else(|| {
        AppError::new(
            "provider_unknown",
            format!("Unknown provider: {}", args.provider),
        )
    })?;
    let removed = provider.credentials.remove(&args.name);
    if let Some(CredentialRef::Keychain { service, account }) = &removed {
        let _ = delete_keychain_secret(service.as_deref().unwrap_or(KEYCHAIN_SERVICE), account);
    }
    save_app_config(&path, &config)?;
    Ok(CommandOutcome {
        payload: json!({
            "ok": true,
            "command": "secret delete",
            "provider": args.provider,
            "name": args.name,
            "removed": removed.is_some(),
        }),
        exit_status: 0,
    })
}
