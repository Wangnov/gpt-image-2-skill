#![allow(unused_imports)]

use super::*;

pub(crate) fn resolve_openai_api_key(
    api_key_override: Option<&str>,
) -> (Option<String>, &'static str) {
    if let Some(value) = api_key_override
        && !value.trim().is_empty()
    {
        return (Some(value.to_string()), "flag");
    }
    match std::env::var(OPENAI_API_KEY_ENV) {
        Ok(value) if !value.trim().is_empty() => (Some(value), "env"),
        _ => (None, "missing"),
    }
}

pub(crate) fn load_codex_auth_state(auth_path: &Path) -> Result<CodexAuthState, AppError> {
    let auth_json = read_auth_json(auth_path)?;
    let tokens = get_token_container(&auth_json);
    let access_token = tokens
        .get("access_token")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            AppError::new(
                "access_token_missing",
                format!("Missing access_token in {}", auth_path.display()),
            )
            .with_detail(json!({ "auth_file": auth_path.display().to_string() }))
        })?
        .to_string();
    let refresh_token = tokens
        .get("refresh_token")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let account_id = resolve_account_id(
        &access_token,
        tokens.get("account_id").and_then(Value::as_str),
    )?;
    Ok(CodexAuthState {
        auth_path: auth_path.to_path_buf(),
        auth_json,
        access_token,
        refresh_token,
        account_id,
        persistence: CodexAuthPersistence::AuthFile,
    })
}

pub(crate) fn load_openai_auth_state(
    api_key_override: Option<&str>,
) -> Result<OpenAiAuthState, AppError> {
    let (api_key, source) = resolve_openai_api_key(api_key_override);
    let Some(api_key) = api_key else {
        return Err(AppError::new(
            "api_key_missing",
            format!("Missing {}.", OPENAI_API_KEY_ENV),
        )
        .with_detail(json!({
            "provider": "openai",
            "env_var": OPENAI_API_KEY_ENV,
        })));
    };
    Ok(OpenAiAuthState {
        api_key,
        source: source.to_string(),
    })
}

pub(crate) fn load_openai_auth_state_for(
    cli: &Cli,
    selection: &ProviderSelection,
) -> Result<OpenAiAuthState, AppError> {
    if let Some(api_key) = cli.api_key.as_deref()
        && !api_key.trim().is_empty()
    {
        return Ok(OpenAiAuthState {
            api_key: api_key.to_string(),
            source: "flag".to_string(),
        });
    }
    let config = load_app_config(&cli_config_path(cli))?;
    if let Some(provider) = config.providers.get(&selection.resolved) {
        let (api_key, source) = get_provider_credential(&selection.resolved, provider, "api_key")?;
        return Ok(OpenAiAuthState { api_key, source });
    }
    if selection.resolved == "openai" {
        return load_openai_auth_state(None);
    }
    Err(AppError::new(
        "provider_unknown",
        format!("Unknown provider: {}", selection.resolved),
    ))
}

pub(crate) fn load_codex_auth_state_for(
    cli: &Cli,
    selection: &ProviderSelection,
) -> Result<CodexAuthState, AppError> {
    let config_path = cli_config_path(cli);
    let config = load_app_config(&config_path)?;
    if selection.resolved == "codex" && !config.providers.contains_key(&selection.resolved) {
        return load_codex_auth_state(Path::new(&cli.auth_file));
    }
    let provider = config.providers.get(&selection.resolved).ok_or_else(|| {
        AppError::new(
            "provider_unknown",
            format!("Unknown provider: {}", selection.resolved),
        )
    })?;
    let (access_token, _) = get_provider_credential(&selection.resolved, provider, "access_token")?;
    let refresh_token = provider
        .credentials
        .get("refresh_token")
        .and_then(|credential| resolve_credential(credential).ok().map(|(value, _)| value));
    let account_id = provider
        .credentials
        .get("account_id")
        .and_then(|credential| resolve_credential(credential).ok().map(|(value, _)| value));
    let account_id = resolve_account_id(&access_token, account_id.as_deref())?;
    let auth_access_token = access_token.clone();
    let auth_refresh_token = refresh_token.clone();
    let auth_account_id = account_id.clone();
    let auth_json = json!({
        "tokens": {
            "access_token": auth_access_token,
            "refresh_token": auth_refresh_token,
            "account_id": auth_account_id,
        }
    });
    Ok(CodexAuthState {
        auth_path: config_path.clone(),
        auth_json,
        access_token,
        refresh_token,
        account_id,
        persistence: CodexAuthPersistence::ConfigProvider {
            config_path,
            provider_name: selection.resolved.clone(),
            credential_sources: provider.credentials.clone(),
        },
    })
}
