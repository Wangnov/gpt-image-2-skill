#![allow(unused_imports)]

use super::*;

pub(crate) fn refresh_access_token(
    auth_state: &mut CodexAuthState,
    proxy: &ProxyConfig,
) -> Result<Value, AppError> {
    let Some(refresh_token) = auth_state.refresh_token.clone() else {
        return Err(AppError::new(
            "refresh_token_missing",
            "Missing refresh_token in auth.json",
        ));
    };
    let client = make_client(DEFAULT_REFRESH_TIMEOUT, proxy)?;
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

pub(crate) fn check_endpoint_reachability(endpoint: &str, proxy: &ProxyConfig) -> Value {
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
    let proxy_mode = proxy_mode_str(proxy.mode);

    // Probe through the resolved proxy (System honors the environment, None
    // forces direct, Custom uses the configured URL) so the result reflects the
    // path real requests take — a direct TCP probe would wrongly report
    // "unreachable" whenever the endpoint is only reachable via a proxy. Any
    // HTTP response, including 4xx/5xx, proves the network path works.
    let client = match make_client(ENDPOINT_CHECK_TIMEOUT, proxy) {
        Ok(client) => client,
        Err(error) => {
            return json!({
                "endpoint": endpoint,
                "host": host,
                "port": port,
                "scheme": url.scheme(),
                "reachable": false,
                "proxy": proxy_mode,
                "error": error.message,
            });
        }
    };
    match client.head(endpoint).send() {
        Ok(response) => json!({
            "endpoint": endpoint,
            "host": host,
            "port": port,
            "scheme": url.scheme(),
            "reachable": true,
            "proxy": proxy_mode,
            "status": response.status().as_u16(),
            "tls_ok": if url.scheme() == "https" { Value::Bool(true) } else { Value::Null },
            "error": Value::Null,
        }),
        Err(error) => json!({
            "endpoint": endpoint,
            "host": host,
            "port": port,
            "scheme": url.scheme(),
            "reachable": false,
            "proxy": proxy_mode,
            "error": error.to_string(),
        }),
    }
}
