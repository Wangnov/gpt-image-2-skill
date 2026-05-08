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
