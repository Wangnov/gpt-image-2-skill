#![allow(unused_imports)]

use super::*;

pub(crate) fn json_object(value: &Value) -> Result<&Map<String, Value>, AppError> {
    value
        .as_object()
        .ok_or_else(|| AppError::new("invalid_json_shape", "Expected a JSON object."))
}

pub(crate) fn get_token_container(auth_json: &Value) -> &Map<String, Value> {
    auth_json
        .get("tokens")
        .and_then(Value::as_object)
        .unwrap_or_else(|| auth_json.as_object().expect("auth json should stay object"))
}

pub(crate) fn get_token_container_mut(auth_json: &mut Value) -> &mut Map<String, Value> {
    if auth_json.get("tokens").and_then(Value::as_object).is_some() {
        auth_json
            .get_mut("tokens")
            .and_then(Value::as_object_mut)
            .expect("tokens object should stay mutable")
    } else {
        auth_json
            .as_object_mut()
            .expect("auth json should stay object")
    }
}

pub(crate) fn read_auth_json(auth_path: &Path) -> Result<Value, AppError> {
    let raw = fs::read_to_string(auth_path).map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            AppError::new(
                "auth_missing",
                format!("Auth file not found: {}", auth_path.display()),
            )
            .with_detail(json!({ "auth_file": auth_path.display().to_string() }))
        } else {
            AppError::new(
                "auth_read_failed",
                format!("Unable to read auth file: {}", auth_path.display()),
            )
            .with_detail(json!({
                "auth_file": auth_path.display().to_string(),
                "error": error.to_string(),
            }))
        }
    })?;
    let parsed: Value = serde_json::from_str(&raw).map_err(|error| {
        AppError::new(
            "auth_invalid_json",
            format!("Invalid JSON in auth file: {}", auth_path.display()),
        )
        .with_detail(json!({
            "auth_file": auth_path.display().to_string(),
            "error": error.to_string(),
        }))
    })?;
    if !parsed.is_object() {
        return Err(AppError::new(
            "auth_invalid_shape",
            "auth.json must contain a JSON object.",
        )
        .with_detail(json!({ "auth_file": auth_path.display().to_string() })));
    }
    Ok(parsed)
}

pub(crate) fn decode_jwt_payload(token: &str) -> Result<Value, AppError> {
    let mut parts = token.split('.');
    let _header = parts.next();
    let payload = parts
        .next()
        .ok_or_else(|| AppError::new("invalid_jwt", "Invalid JWT format."))?;
    let decoded = URL_SAFE_NO_PAD
        .decode(payload)
        .or_else(|_| STANDARD.decode(payload))
        .map_err(|_| AppError::new("invalid_jwt", "Unable to decode JWT payload."))?;
    let parsed: Value = serde_json::from_slice(&decoded)
        .map_err(|_| AppError::new("invalid_jwt", "Unable to decode JWT payload."))?;
    if !parsed.is_object() {
        return Err(AppError::new(
            "invalid_jwt",
            "Decoded JWT payload is not a JSON object.",
        ));
    }
    Ok(parsed)
}

pub(crate) fn try_decode_jwt_payload(token: Option<&str>) -> Option<Value> {
    token.and_then(|value| decode_jwt_payload(value).ok())
}

pub(crate) fn resolve_account_id(
    access_token: &str,
    account_id: Option<&str>,
) -> Result<String, AppError> {
    if let Some(value) = account_id
        && !value.is_empty()
    {
        return Ok(value.to_string());
    }
    let payload = decode_jwt_payload(access_token)?;
    let auth_claim = payload
        .get("https://api.openai.com/auth")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            AppError::new("account_id_missing", "Missing auth claims in access token.")
        })?;
    let claim_account_id = auth_claim
        .get("chatgpt_account_id")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            AppError::new(
                "account_id_missing",
                "Missing chatgpt_account_id in token claims.",
            )
        })?;
    Ok(claim_account_id.to_string())
}

pub(crate) fn compute_expiry_details(exp_seconds: Option<i64>) -> Value {
    match exp_seconds {
        Some(exp) => {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64;
            json!({
                "expires_at": exp,
                "expired": exp <= now,
                "seconds_until_expiry": exp - now,
            })
        }
        None => json!({
            "expires_at": Value::Null,
            "expired": Value::Null,
            "seconds_until_expiry": Value::Null,
        }),
    }
}

pub(crate) fn resolve_auth_identity(payload: Option<&Value>) -> Value {
    let mut result = Map::new();
    if let Some(payload) = payload {
        if let Some(email) = payload
            .get("https://api.openai.com/profile")
            .and_then(Value::as_object)
            .and_then(|profile| profile.get("email"))
            .and_then(Value::as_str)
        {
            result.insert("email".to_string(), json!(email));
        }
        if let Some(auth_claim) = payload
            .get("https://api.openai.com/auth")
            .and_then(Value::as_object)
        {
            if let Some(plan_type) = auth_claim.get("chatgpt_plan_type").and_then(Value::as_str) {
                result.insert("plan_type".to_string(), json!(plan_type));
            }
            if let Some(chatgpt_user_id) = auth_claim.get("chatgpt_user_id").and_then(Value::as_str)
            {
                result.insert("chatgpt_user_id".to_string(), json!(chatgpt_user_id));
            }
        }
    }
    Value::Object(result)
}

pub fn inspect_codex_auth_file(auth_path: &Path) -> Value {
    let mut result = json!({
        "auth_file": auth_path.display().to_string(),
        "auth_source": "config",
        "exists": auth_path.is_file(),
        "provider": "codex",
    });

    if !auth_path.is_file() {
        result["ready"] = json!(false);
        result["parse_ok"] = json!(false);
        result["auth_source"] = json!("missing");
        result["message"] = json!("auth.json was not found.");
        return result;
    }

    let auth_json = match read_auth_json(auth_path) {
        Ok(auth_json) => auth_json,
        Err(error) => {
            result["ready"] = json!(false);
            result["parse_ok"] = json!(false);
            result["message"] = json!(error.message);
            result["error"] = json!({
                "code": error.code,
                "detail": error.detail,
            });
            return result;
        }
    };

    let tokens = get_token_container(&auth_json);
    let access_token = tokens.get("access_token").and_then(Value::as_str);
    let refresh_token = tokens.get("refresh_token").and_then(Value::as_str);
    let id_token = tokens.get("id_token").and_then(Value::as_str);
    let access_payload = try_decode_jwt_payload(access_token);
    let auth_mode = auth_json
        .get("auth_mode")
        .and_then(Value::as_str)
        .or_else(|| auth_json.get("type").and_then(Value::as_str));
    let exp_seconds = access_payload
        .as_ref()
        .and_then(|payload| payload.get("exp"))
        .and_then(Value::as_i64);
    let identity = resolve_auth_identity(access_payload.as_ref());
    let account_id = access_token.and_then(|token| {
        resolve_account_id(token, tokens.get("account_id").and_then(Value::as_str)).ok()
    });

    result["ready"] = json!(access_token.is_some());
    result["parse_ok"] = json!(true);
    result["auth_mode"] = json!(auth_mode);
    result["access_token_present"] = json!(access_token.is_some());
    result["refresh_token_present"] = json!(refresh_token.is_some());
    result["id_token_present"] = json!(id_token.is_some());
    result["account_id"] = json!(account_id);
    result["last_refresh"] = auth_json
        .get("last_refresh")
        .cloned()
        .unwrap_or(Value::Null);
    if let Some(object) = result.as_object_mut() {
        if let Some(details) = compute_expiry_details(exp_seconds).as_object() {
            for (key, value) in details {
                object.insert(key.clone(), value.clone());
            }
        }
        if let Some(identity_object) = identity.as_object() {
            for (key, value) in identity_object {
                object.insert(key.clone(), value.clone());
            }
        }
    }
    result
}

pub fn inspect_openai_auth(api_key_override: Option<&str>) -> Value {
    let (api_key, source) = resolve_openai_api_key(api_key_override);
    json!({
        "provider": "openai",
        "ready": api_key.is_some(),
        "auth_source": source,
        "api_key_present": api_key.is_some(),
        "env_var": OPENAI_API_KEY_ENV,
        "default_model": DEFAULT_OPENAI_MODEL,
    })
}

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

pub(crate) fn save_auth_json(auth_state: &CodexAuthState) -> Result<(), AppError> {
    match &auth_state.persistence {
        CodexAuthPersistence::AuthFile => {
            let mut content =
                serde_json::to_string_pretty(&auth_state.auth_json).map_err(|error| {
                    AppError::new("auth_write_failed", "Unable to serialize auth.json.")
                        .with_detail(json!({"error": error.to_string()}))
                })?;
            content.push('\n');
            fs::create_dir_all(
                auth_state
                    .auth_path
                    .parent()
                    .unwrap_or_else(|| Path::new(".")),
            )
            .map_err(|error| {
                AppError::new("auth_write_failed", "Unable to create auth directory.")
                    .with_detail(json!({"error": error.to_string()}))
            })?;
            fs::write(&auth_state.auth_path, content).map_err(|error| {
                AppError::new("auth_write_failed", "Unable to save auth.json.")
                    .with_detail(json!({"error": error.to_string()}))
            })?;
            Ok(())
        }
        CodexAuthPersistence::ConfigProvider {
            config_path,
            provider_name,
            credential_sources,
        } => save_codex_config_credentials(
            config_path,
            provider_name,
            credential_sources,
            &auth_state.access_token,
            auth_state.refresh_token.as_deref(),
            &auth_state.account_id,
        ),
        CodexAuthPersistence::SessionOnly => Ok(()),
    }
}

pub(crate) fn save_codex_config_credentials(
    config_path: &Path,
    provider_name: &str,
    credential_sources: &BTreeMap<String, CredentialRef>,
    access_token: &str,
    refresh_token: Option<&str>,
    account_id: &str,
) -> Result<(), AppError> {
    let mut config = load_app_config(config_path)?;
    let provider = config.providers.get_mut(provider_name).ok_or_else(|| {
        AppError::new(
            "provider_unknown",
            format!("Unknown provider: {provider_name}"),
        )
    })?;
    persist_credential_value(provider, credential_sources, "access_token", access_token)?;
    persist_credential_value(provider, credential_sources, "account_id", account_id)?;
    if let Some(refresh_token) = refresh_token {
        persist_credential_value(provider, credential_sources, "refresh_token", refresh_token)?;
    }
    save_app_config(config_path, &config)
}

pub(crate) fn persist_credential_value(
    provider: &mut ProviderConfig,
    credential_sources: &BTreeMap<String, CredentialRef>,
    key: &str,
    value: &str,
) -> Result<(), AppError> {
    match credential_sources.get(key) {
        Some(CredentialRef::File { .. }) | None => {
            provider.credentials.insert(
                key.to_string(),
                CredentialRef::File {
                    value: value.to_string(),
                },
            );
            Ok(())
        }
        Some(CredentialRef::Keychain { service, account }) => write_keychain_secret(
            service.as_deref().unwrap_or(KEYCHAIN_SERVICE),
            account,
            value,
        ),
        Some(CredentialRef::Env { .. }) => Ok(()),
    }
}

pub(crate) fn make_client(timeout_seconds: u64) -> Result<Client, AppError> {
    Client::builder()
        .timeout(Duration::from_secs(timeout_seconds))
        .user_agent(build_user_agent())
        .build()
        .map_err(|error| {
            AppError::new("http_client_error", "Unable to build HTTP client.")
                .with_detail(json!({ "error": error.to_string() }))
        })
}

pub(crate) fn http_status_error(status: StatusCode, detail: String) -> AppError {
    AppError::new("http_error", format!("HTTP {}", status.as_u16()))
        .with_detail(json!(detail))
        .with_status_code(status.as_u16())
}

pub(crate) fn refresh_access_token(auth_state: &mut CodexAuthState) -> Result<Value, AppError> {
    let Some(refresh_token) = auth_state.refresh_token.clone() else {
        return Err(AppError::new(
            "refresh_token_missing",
            "Missing refresh_token in auth.json",
        ));
    };
    let client = make_client(DEFAULT_REFRESH_TIMEOUT)?;
    let response = client
        .post(REFRESH_ENDPOINT)
        .header(CONTENT_TYPE, "application/json")
        .header(ACCEPT, "application/json")
        .json(&json!({
            "client_id": REFRESH_CLIENT_ID,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        }))
        .send()
        .map_err(|error| {
            AppError::new("refresh_failed", "Refresh request failed.")
                .with_detail(json!({ "error": error.to_string() }))
        })?;
    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().unwrap_or_else(|_| String::new());
        return Err(
            http_status_error(status, detail.clone()).with_detail(json!({
                "message": "Refresh request failed.",
                "detail": detail,
            })),
        );
    }
    let payload: Value = response.json().map_err(|error| {
        AppError::new("refresh_failed", "Refresh response was not valid JSON.")
            .with_detail(json!({ "error": error.to_string() }))
    })?;
    let access_token = payload
        .get("access_token")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            AppError::new(
                "refresh_failed",
                "Refresh response did not include access_token.",
            )
        })?
        .to_string();
    let refresh_token = payload
        .get("refresh_token")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let id_token = payload
        .get("id_token")
        .and_then(Value::as_str)
        .map(ToString::to_string);

    let tokens = get_token_container_mut(&mut auth_state.auth_json);
    tokens.insert("access_token".to_string(), json!(access_token));
    if let Some(refresh_token) = refresh_token.clone() {
        tokens.insert("refresh_token".to_string(), json!(refresh_token));
    }
    if let Some(id_token) = id_token {
        tokens.insert("id_token".to_string(), json!(id_token));
    }
    let account_id = resolve_account_id(
        payload
            .get("access_token")
            .and_then(Value::as_str)
            .unwrap_or(""),
        tokens.get("account_id").and_then(Value::as_str),
    )?;
    tokens.insert("account_id".to_string(), json!(account_id));
    if let Some(root) = auth_state.auth_json.as_object_mut() {
        root.insert("last_refresh".to_string(), json!(now_iso()));
    }
    auth_state.access_token = payload
        .get("access_token")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    auth_state.refresh_token = refresh_token;
    auth_state.account_id = account_id;
    save_auth_json(auth_state)?;
    Ok(payload)
}

pub(crate) fn check_endpoint_reachability(endpoint: &str) -> Value {
    let url = match Url::parse(endpoint) {
        Ok(url) => url,
        Err(error) => {
            return json!({
                "endpoint": endpoint,
                "reachable": false,
                "error": error.to_string(),
            });
        }
    };
    let host = url.host_str().unwrap_or_default().to_string();
    let port = url.port_or_known_default().unwrap_or(443);
    let mut reachable = false;
    let mut dns_resolved = false;
    let mut tcp_connected = false;
    let mut addresses = Vec::<String>::new();
    let mut error_text: Option<String> = None;

    match (host.as_str(), port).to_socket_addrs() {
        Ok(iter) => {
            dns_resolved = true;
            for address in iter {
                addresses.push(address.ip().to_string());
                if TcpStream::connect_timeout(&address, Duration::from_secs(ENDPOINT_CHECK_TIMEOUT))
                    .is_ok()
                {
                    tcp_connected = true;
                    reachable = true;
                    break;
                }
            }
            if !tcp_connected {
                error_text = Some("No address accepted a TCP connection.".to_string());
            }
        }
        Err(error) => {
            error_text = Some(error.to_string());
        }
    }

    json!({
        "endpoint": endpoint,
        "host": host,
        "port": port,
        "scheme": url.scheme(),
        "dns_resolved": dns_resolved,
        "tcp_connected": tcp_connected,
        "tls_ok": if url.scheme() == "https" { Value::Bool(reachable) } else { Value::Null },
        "reachable": reachable,
        "addresses": addresses,
        "error": error_text,
    })
}
