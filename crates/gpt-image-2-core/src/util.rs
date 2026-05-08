#![allow(unused_imports)]

use super::*;

pub(crate) fn build_user_agent() -> String {
    format!("{CLI_NAME}/{VERSION} local-cli")
}

pub(crate) fn now_iso() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    now.to_string()
}

pub(crate) fn emit_json(payload: &Value) {
    println!(
        "{}",
        serde_json::to_string_pretty(payload).unwrap_or_else(|_| "{\"ok\":false}".to_string())
    );
}

pub(crate) fn build_error_payload(error: AppError) -> (Value, i32) {
    let mut error_obj = json!({
        "code": error.code,
        "message": error.message,
    });
    if let Some(detail) = error.detail {
        error_obj["detail"] = redact_event_payload(&detail);
    }
    (
        json!({
            "ok": false,
            "error": error_obj,
        }),
        error.exit_status,
    )
}
