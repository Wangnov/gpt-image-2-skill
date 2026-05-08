#![allow(unused_imports)]

use super::*;

pub(crate) fn read_body_json(path: &str) -> Result<Value, AppError> {
    let raw = if path == "-" {
        let mut full = String::new();
        let mut stdin = io::stdin();
        stdin.read_to_string(&mut full).map_err(|error| {
            AppError::new("invalid_body_json", "Unable to read stdin body.")
                .with_detail(json!({ "error": error.to_string() }))
        })?;
        full
    } else {
        fs::read_to_string(path).map_err(|error| {
            AppError::new("invalid_body_json", "Unable to read request body.")
                .with_detail(json!({"error": error.to_string(), "body_file": path}))
        })?
    };
    let parsed: Value = serde_json::from_str(&raw).map_err(|error| {
        AppError::new("invalid_body_json", "Request body must be valid JSON.")
            .with_detail(json!({ "error": error.to_string() }))
    })?;
    if !parsed.is_object() {
        return Err(AppError::new(
            "invalid_body_json",
            "Request body must be a JSON object.",
        ));
    }
    Ok(parsed)
}

pub(crate) fn configured_provider_selection(
    requested: &str,
    provider: &ProviderConfig,
    reason: &str,
    api_key_override: Option<&str>,
) -> Result<ProviderSelection, AppError> {
    let edit_region_mode = provider
        .edit_region_mode
        .as_deref()
        .map(normalize_edit_region_mode)
        .transpose()?;
    match provider.provider_type.as_str() {
        "openai" | "openai-compatible" => {
            let api_base = provider
                .api_base
                .clone()
                .unwrap_or_else(|| DEFAULT_OPENAI_API_BASE.to_string());
            if api_key_override
                .map(|value| value.trim().is_empty())
                .unwrap_or(true)
            {
                let _ = get_provider_credential(requested, provider, "api_key")?;
            }
            Ok(ProviderSelection {
                requested: requested.to_string(),
                resolved: requested.to_string(),
                reason: reason.to_string(),
                kind: ProviderKind::OpenAi,
                api_base,
                codex_endpoint: DEFAULT_CODEX_ENDPOINT.to_string(),
                default_model: provider
                    .model
                    .clone()
                    .unwrap_or_else(|| DEFAULT_OPENAI_MODEL.to_string()),
                supports_n: provider
                    .supports_n
                    .unwrap_or(provider.provider_type == "openai"),
                edit_region_mode: edit_region_mode.unwrap_or_else(|| {
                    default_edit_region_mode(&provider.provider_type).to_string()
                }),
            })
        }
        "codex" => {
            let _ = get_provider_credential(requested, provider, "access_token")?;
            Ok(ProviderSelection {
                requested: requested.to_string(),
                resolved: requested.to_string(),
                reason: reason.to_string(),
                kind: ProviderKind::Codex,
                api_base: DEFAULT_OPENAI_API_BASE.to_string(),
                codex_endpoint: provider
                    .endpoint
                    .clone()
                    .unwrap_or_else(|| DEFAULT_CODEX_ENDPOINT.to_string()),
                default_model: provider
                    .model
                    .clone()
                    .unwrap_or_else(|| DEFAULT_CODEX_MODEL.to_string()),
                supports_n: false,
                edit_region_mode: edit_region_mode
                    .unwrap_or_else(|| EDIT_REGION_REFERENCE_HINT.to_string()),
            })
        }
        other => Err(AppError::new(
            "provider_kind_unsupported",
            format!("Unsupported provider type: {other}"),
        )
        .with_detail(json!({"provider": requested, "type": other}))),
    }
}

pub(crate) const EDIT_REGION_NATIVE_MASK: &str = "native-mask";

pub(crate) const EDIT_REGION_REFERENCE_HINT: &str = "reference-hint";

pub(crate) const EDIT_REGION_NONE: &str = "none";

pub(crate) fn default_edit_region_mode(provider_type: &str) -> &'static str {
    match provider_type {
        "openai" => EDIT_REGION_NATIVE_MASK,
        "codex" => EDIT_REGION_REFERENCE_HINT,
        _ => EDIT_REGION_REFERENCE_HINT,
    }
}

pub(crate) fn normalize_edit_region_mode(value: &str) -> Result<String, AppError> {
    match value {
        EDIT_REGION_NATIVE_MASK | EDIT_REGION_REFERENCE_HINT | EDIT_REGION_NONE => {
            Ok(value.to_string())
        }
        other => Err(AppError::new(
            "invalid_provider_config",
            format!("Unsupported edit_region_mode: {other}"),
        )
        .with_detail(json!({
            "allowed": [EDIT_REGION_NATIVE_MASK, EDIT_REGION_REFERENCE_HINT, EDIT_REGION_NONE]
        }))),
    }
}

pub(crate) fn select_configured_provider(
    cli: &Cli,
    requested: &str,
    reason: &str,
) -> Result<ProviderSelection, AppError> {
    let config_path = cli_config_path(cli);
    let config = load_app_config(&config_path)?;
    let provider = config.providers.get(requested).ok_or_else(|| {
        AppError::new("provider_unknown", format!("Unknown provider: {requested}"))
            .with_detail(json!({"config_file": config_path.display().to_string()}))
    })?;
    configured_provider_selection(requested, provider, reason, cli.api_key.as_deref())
}

pub(crate) fn select_builtin_provider(
    cli: &Cli,
    requested: &str,
) -> Result<ProviderSelection, AppError> {
    if matches!(requested, "openai" | "codex") {
        let config_path = cli_config_path(cli);
        let config = load_app_config(&config_path)?;
        if let Some(provider) = config.providers.get(requested) {
            return configured_provider_selection(
                requested,
                provider,
                "explicit_config_provider",
                cli.api_key.as_deref(),
            );
        }
    }

    let auth_path = PathBuf::from(&cli.auth_file);
    let openai_ready = inspect_openai_auth(cli.api_key.as_deref())
        .get("ready")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let codex_ready = inspect_codex_auth_file(&auth_path)
        .get("ready")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    match requested {
        "openai" => {
            if !openai_ready {
                return Err(AppError::new(
                    "api_key_missing",
                    format!("Missing {}.", OPENAI_API_KEY_ENV),
                ));
            }
            Ok(ProviderSelection {
                requested: requested.to_string(),
                resolved: "openai".to_string(),
                reason: "explicit".to_string(),
                kind: ProviderKind::OpenAi,
                api_base: cli.openai_api_base.clone(),
                codex_endpoint: cli.endpoint.clone(),
                default_model: DEFAULT_OPENAI_MODEL.to_string(),
                supports_n: true,
                edit_region_mode: EDIT_REGION_NATIVE_MASK.to_string(),
            })
        }
        "codex" => {
            if !codex_ready {
                return Err(AppError::new(
                    "access_token_missing",
                    format!("Missing access_token in {}", auth_path.display()),
                ));
            }
            Ok(ProviderSelection {
                requested: requested.to_string(),
                resolved: "codex".to_string(),
                reason: "explicit".to_string(),
                kind: ProviderKind::Codex,
                api_base: cli.openai_api_base.clone(),
                codex_endpoint: cli.endpoint.clone(),
                default_model: DEFAULT_CODEX_MODEL.to_string(),
                supports_n: false,
                edit_region_mode: EDIT_REGION_REFERENCE_HINT.to_string(),
            })
        }
        "auto" => {
            let config_path = cli_config_path(cli);
            let config = load_app_config(&config_path)?;
            if let Some(default_provider) = config.default_provider.as_deref()
                && let Some(provider) = config.providers.get(default_provider)
            {
                return configured_provider_selection(
                    default_provider,
                    provider,
                    "config_default_provider",
                    cli.api_key.as_deref(),
                );
            }
            if openai_ready {
                Ok(ProviderSelection {
                    requested: "auto".to_string(),
                    resolved: "openai".to_string(),
                    reason: "auto_openai_api_key".to_string(),
                    kind: ProviderKind::OpenAi,
                    api_base: cli.openai_api_base.clone(),
                    codex_endpoint: cli.endpoint.clone(),
                    default_model: DEFAULT_OPENAI_MODEL.to_string(),
                    supports_n: true,
                    edit_region_mode: EDIT_REGION_NATIVE_MASK.to_string(),
                })
            } else if codex_ready {
                Ok(ProviderSelection {
                    requested: "auto".to_string(),
                    resolved: "codex".to_string(),
                    reason: "auto_codex_auth".to_string(),
                    kind: ProviderKind::Codex,
                    api_base: cli.openai_api_base.clone(),
                    codex_endpoint: cli.endpoint.clone(),
                    default_model: DEFAULT_CODEX_MODEL.to_string(),
                    supports_n: false,
                    edit_region_mode: EDIT_REGION_REFERENCE_HINT.to_string(),
                })
            } else {
                Err(
                    AppError::new("provider_unavailable", "No usable provider auth was found.")
                        .with_detail(json!({
                            "openai": inspect_openai_auth(cli.api_key.as_deref()),
                            "codex": inspect_codex_auth_file(&auth_path),
                            "config_file": config_path.display().to_string(),
                            "configured_providers": config.providers.keys().cloned().collect::<Vec<_>>(),
                        })),
                )
            }
        }
        _ => select_configured_provider(cli, requested, "explicit_config_provider"),
    }
}

pub(crate) fn select_image_provider(cli: &Cli) -> Result<ProviderSelection, AppError> {
    let requested = cli.provider.trim();
    select_builtin_provider(
        cli,
        if requested.is_empty() {
            "auto"
        } else {
            requested
        },
    )
}

pub(crate) fn select_request_provider(
    cli: &Cli,
    args: &RequestCreateArgs,
) -> Result<ProviderSelection, AppError> {
    let requested = cli.provider.trim();
    if requested != "auto" && !requested.is_empty() {
        return select_image_provider(cli);
    }
    let config_path = cli_config_path(cli);
    let config = load_app_config(&config_path)?;
    if let Some(default_provider) = config.default_provider.as_deref()
        && let Some(provider) = config.providers.get(default_provider)
    {
        return configured_provider_selection(
            default_provider,
            provider,
            "config_default_provider",
            cli.api_key.as_deref(),
        );
    }
    if args.request_operation == RequestOperation::Responses
        && inspect_codex_auth_file(Path::new(&cli.auth_file))
            .get("ready")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    {
        return Ok(ProviderSelection {
            requested: "auto".to_string(),
            resolved: "codex".to_string(),
            reason: "auto_request_responses".to_string(),
            kind: ProviderKind::Codex,
            api_base: cli.openai_api_base.clone(),
            codex_endpoint: cli.endpoint.clone(),
            default_model: DEFAULT_CODEX_MODEL.to_string(),
            supports_n: false,
            edit_region_mode: EDIT_REGION_REFERENCE_HINT.to_string(),
        });
    }
    if matches!(
        args.request_operation,
        RequestOperation::Generate | RequestOperation::Edit
    ) && inspect_openai_auth(cli.api_key.as_deref())
        .get("ready")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return Ok(ProviderSelection {
            requested: "auto".to_string(),
            resolved: "openai".to_string(),
            reason: "auto_request_images".to_string(),
            kind: ProviderKind::OpenAi,
            api_base: cli.openai_api_base.clone(),
            codex_endpoint: cli.endpoint.clone(),
            default_model: DEFAULT_OPENAI_MODEL.to_string(),
            supports_n: true,
            edit_region_mode: EDIT_REGION_NATIVE_MASK.to_string(),
        });
    }
    select_image_provider(cli)
}

pub(crate) fn validate_provider_specific_image_args(
    selection: &ProviderSelection,
    shared: &SharedImageArgs,
    mask: Option<&str>,
    input_fidelity: Option<InputFidelity>,
) -> Result<(), AppError> {
    if matches!(selection.kind, ProviderKind::Codex) {
        if shared.n.unwrap_or(1) != 1 {
            return Err(AppError::new(
                "unsupported_option",
                "--n is supported by the openai provider.",
            ));
        }
        if shared.moderation.is_some() {
            return Err(AppError::new(
                "unsupported_option",
                "--moderation is supported by the openai provider.",
            ));
        }
        if mask.is_some() {
            return Err(AppError::new(
                "unsupported_option",
                "--mask requires a provider with native-mask region editing.",
            ));
        }
        if input_fidelity.is_some() {
            return Err(AppError::new(
                "unsupported_option",
                "--input-fidelity is supported by the openai provider.",
            ));
        }
    }
    if mask.is_some() && selection.edit_region_mode != EDIT_REGION_NATIVE_MASK {
        return Err(AppError::new(
            "unsupported_option",
            "--mask requires a provider with native-mask region editing.",
        )
        .with_detail(json!({
            "provider": selection.resolved,
            "edit_region_mode": selection.edit_region_mode,
        })));
    }
    if matches!(selection.kind, ProviderKind::OpenAi) && shared.instructions != DEFAULT_INSTRUCTIONS
    {
        return Err(AppError::new(
            "unsupported_option",
            "--instructions is supported by the codex provider.",
        ));
    }
    Ok(())
}

pub(crate) fn validate_reference_image_count(count: usize) -> Result<(), AppError> {
    if count > MAX_REFERENCE_IMAGES {
        return Err(AppError::new(
            "ref_image_too_many",
            format!("At most {MAX_REFERENCE_IMAGES} reference images are supported."),
        )
        .with_detail(json!({
            "max": MAX_REFERENCE_IMAGES,
            "actual": count,
        })));
    }
    Ok(())
}

pub(crate) fn should_retry(error: &AppError) -> bool {
    if let Some(status_code) = error.status_code {
        return status_code == 429 || status_code >= 500;
    }
    matches!(
        error.code.as_str(),
        "network_error" | "request_failed" | "refresh_failed"
    )
}

pub(crate) fn compute_retry_delay_seconds(retry_number: usize) -> u64 {
    DEFAULT_RETRY_DELAY_SECONDS * (2_u64.pow((retry_number.saturating_sub(1)) as u32))
}
