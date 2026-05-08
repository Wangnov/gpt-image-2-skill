#![allow(unused_imports)]

use super::*;

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
