#![allow(unused_imports)]

use super::*;

pub(crate) fn execute_openai_with_retry<T, F>(
    logger: &mut JsonEventLogger,
    provider: &str,
    mut run_once: F,
) -> Result<(T, usize), AppError>
where
    F: FnMut(&mut JsonEventLogger) -> Result<T, AppError>,
{
    let mut retry_count = 0;
    loop {
        match run_once(logger) {
            Ok(value) => return Ok((value, retry_count)),
            Err(error) => {
                if retry_count >= DEFAULT_RETRY_COUNT || !should_retry(&error) {
                    return Err(error);
                }
                retry_count += 1;
                let delay_seconds = compute_retry_delay_seconds(retry_count);
                emit_progress_event(
                    logger,
                    provider,
                    "retry_scheduled",
                    "Retry scheduled after transient failure.",
                    "running",
                    None,
                    json!({
                        "retry_number": retry_count,
                        "max_retries": DEFAULT_RETRY_COUNT,
                        "delay_seconds": delay_seconds,
                        "reason": error.message,
                        "status_code": error.status_code,
                    }),
                );
                std::thread::sleep(Duration::from_secs(delay_seconds));
            }
        }
    }
}

pub(crate) fn request_codex_with_retry(
    endpoint: &str,
    auth_state: &mut CodexAuthState,
    body: &Value,
    logger: &mut JsonEventLogger,
) -> Result<(Value, bool, usize), AppError> {
    let mut auth_refreshed = false;
    let mut retry_count = 0;
    loop {
        match request_codex_responses_once(endpoint, auth_state, body, logger) {
            Ok(value) => return Ok((value, auth_refreshed, retry_count)),
            Err(error) => {
                if error.status_code == Some(401) && !auth_refreshed {
                    emit_progress_event(
                        logger,
                        "codex",
                        "auth_refresh_started",
                        "Refreshing Codex access token.",
                        "running",
                        Some(2),
                        json!({ "endpoint": REFRESH_ENDPOINT }),
                    );
                    let payload = refresh_access_token(auth_state)?;
                    logger.emit(
                        "local",
                        "auth.refresh.completed",
                        redact_event_payload(&payload),
                    );
                    emit_progress_event(
                        logger,
                        "codex",
                        "auth_refresh_completed",
                        "Codex access token refreshed.",
                        "running",
                        Some(4),
                        json!({}),
                    );
                    auth_refreshed = true;
                    continue;
                }
                if retry_count >= DEFAULT_RETRY_COUNT || !should_retry(&error) {
                    return Err(error);
                }
                retry_count += 1;
                let delay_seconds = compute_retry_delay_seconds(retry_count);
                emit_progress_event(
                    logger,
                    "codex",
                    "retry_scheduled",
                    "Retry scheduled after transient failure.",
                    "running",
                    None,
                    json!({
                        "retry_number": retry_count,
                        "max_retries": DEFAULT_RETRY_COUNT,
                        "delay_seconds": delay_seconds,
                        "reason": error.message,
                        "status_code": error.status_code,
                    }),
                );
                std::thread::sleep(Duration::from_secs(delay_seconds));
            }
        }
    }
}
