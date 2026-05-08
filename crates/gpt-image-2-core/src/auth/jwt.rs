#![allow(unused_imports)]

use super::*;

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
