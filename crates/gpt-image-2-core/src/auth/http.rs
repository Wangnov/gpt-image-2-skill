#![allow(unused_imports)]

use super::*;

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
