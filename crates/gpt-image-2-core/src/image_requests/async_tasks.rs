#![allow(unused_imports)]

use super::*;
use std::time::Instant;

#[derive(Debug)]
pub(crate) struct OpenAiRequestResult {
    pub(crate) payload: Value,
    pub(crate) retry_count: usize,
    pub(crate) async_task: Option<Value>,
}

#[derive(Debug)]
struct AsyncTaskReceipt {
    task_id: String,
    poll_url: String,
    status: String,
    retry_after_seconds: u64,
    result: Option<Value>,
}

struct AsyncSubmitTarget<'a> {
    endpoint: &'a str,
    api_base: &'a str,
    operation: &'a str,
}

pub(crate) fn request_openai_with_transport(
    selection: &ProviderSelection,
    operation: &str,
    auth_state: &OpenAiAuthState,
    body: &Value,
    logger: &mut JsonEventLogger,
    mut recovery: Option<&mut RecoveryContext>,
    proxy: &ProxyConfig,
) -> Result<OpenAiRequestResult, AppError> {
    if selection.image_transport == IMAGE_TRANSPORT_SUB2API_ASYNC {
        return request_sub2api_async(
            selection, operation, auth_state, body, logger, recovery, proxy,
        );
    }

    let endpoint = build_openai_operation_endpoint(&selection.api_base, operation)?;
    let (payload, retry_count) =
        execute_openai_with_retry(logger, &selection.resolved, |logger| {
            if operation == "edit" {
                request_openai_edit_once(
                    &endpoint,
                    auth_state,
                    body,
                    logger,
                    recovery.as_deref_mut(),
                    proxy,
                )
            } else {
                request_openai_images_once(
                    &endpoint,
                    auth_state,
                    body,
                    logger,
                    recovery.as_deref_mut(),
                    proxy,
                )
            }
        })?;
    Ok(OpenAiRequestResult {
        payload,
        retry_count,
        async_task: None,
    })
}

fn request_sub2api_async(
    selection: &ProviderSelection,
    operation: &str,
    auth_state: &OpenAiAuthState,
    body: &Value,
    logger: &mut JsonEventLogger,
    mut recovery: Option<&mut RecoveryContext>,
    proxy: &ProxyConfig,
) -> Result<OpenAiRequestResult, AppError> {
    let endpoint = build_sub2api_async_endpoint(&selection.api_base, operation)?;
    let target = AsyncSubmitTarget {
        endpoint: &endpoint,
        api_base: &selection.api_base,
        operation,
    };
    // An async submission is not safe to retry: the remote task may already
    // have been created even when the response is lost or rewritten to a 5xx.
    // sub2api does not currently expose an idempotency contract for this
    // endpoint, so a second POST could create and bill a duplicate task.
    let receipt = submit_sub2api_async_once(
        &target,
        auth_state,
        body,
        logger,
        recovery.as_deref_mut(),
        proxy,
    )?;
    let submit_retry_count = 0;

    emit_progress_event(
        logger,
        &selection.resolved,
        "async_task_submitted",
        "sub2api async image task accepted.",
        "running",
        Some(10),
        json!({
            "task_id": receipt.task_id,
            "poll_url": receipt.poll_url,
            "task_status": receipt.status,
            "retry_after_seconds": receipt.retry_after_seconds,
        }),
    );

    if receipt.status == "completed" {
        let payload = completed_task_result(
            receipt.result,
            &receipt.task_id,
            logger,
            recovery.as_deref_mut(),
        )?;
        return Ok(OpenAiRequestResult {
            payload,
            retry_count: submit_retry_count,
            async_task: Some(json!({
                "task_id": receipt.task_id,
                "poll_url": receipt.poll_url,
                "status": "completed",
                "poll_attempts": 0,
                "transient_retries": 0,
            })),
        });
    }
    if is_failed_task_status(&receipt.status) {
        if let Some(ctx) = recovery.as_deref_mut() {
            let _ = ctx.mark_remote_task_status(&receipt.status);
        }
        return Err(async_task_failed_error(
            &receipt.task_id,
            &receipt.status,
            None,
        ));
    }
    if !is_pending_task_status(&receipt.status) {
        return Err(AppError::new(
            "async_task_invalid_response",
            format!(
                "sub2api returned an unsupported task status: {}",
                receipt.status
            ),
        )
        .with_detail(json!({
            "task_id": receipt.task_id,
            "status": receipt.status,
        })));
    }

    let poll_result = poll_sub2api_task(
        &receipt,
        auth_state,
        AsyncPollPolicy {
            initial_delay_seconds: poll_delay_seconds(
                receipt.retry_after_seconds,
                selection.poll_interval_seconds,
            ),
            interval_seconds: selection.poll_interval_seconds,
            timeout_seconds: selection.poll_timeout_seconds,
        },
        logger,
        recovery,
        proxy,
    )?;
    Ok(OpenAiRequestResult {
        payload: poll_result.payload,
        // Keep the established top-level retry contract scoped to request
        // submission retries (max DEFAULT_RETRY_COUNT). Async polling is
        // timeout-bound and may retry more often, so expose that independent
        // counter only inside async_task.transient_retries.
        retry_count: submit_retry_count,
        async_task: Some(json!({
            "task_id": receipt.task_id,
            "poll_url": receipt.poll_url,
            "status": "completed",
            "poll_attempts": poll_result.poll_attempts,
            "transient_retries": poll_result.transient_retries,
        })),
    })
}

pub fn resume_sub2api_remote_task(
    provider_name: &str,
    recovery_job_id: &str,
    job_dir: &Path,
    remote_task: &RemoteImageTask,
) -> Result<Value, AppError> {
    let config = load_app_config(&default_config_path())?;
    let provider = config.providers.get(provider_name).ok_or_else(|| {
        AppError::new(
            "provider_unknown",
            format!("Unknown provider: {provider_name}"),
        )
    })?;
    let selection =
        configured_provider_selection(provider_name, provider, "remote_task_recovery", None)?;
    let (api_key, source) = get_provider_credential(provider_name, provider, "api_key")?;
    let auth_state = OpenAiAuthState { api_key, source };
    let proxy = resolve_effective_proxy(&config.proxy, Some(provider));
    validate_proxy_config(&proxy)?;
    let poll_url = resolve_sub2api_poll_url(
        &selection.api_base,
        Some(&remote_task.poll_url),
        &remote_task.task_id,
    )?;
    let receipt = AsyncTaskReceipt {
        task_id: remote_task.task_id.clone(),
        poll_url: poll_url.clone(),
        status: remote_task.status.clone(),
        retry_after_seconds: selection.poll_interval_seconds,
        result: None,
    };
    let mut tracked_task = remote_task.clone();
    tracked_task.poll_url = poll_url;
    let mut recovery = RecoveryContext::new(recovery_job_id.to_string(), job_dir.to_path_buf())?;
    recovery.restore_remote_task(tracked_task)?;
    let mut logger = JsonEventLogger::new(false);
    match poll_sub2api_task(
        &receipt,
        &auth_state,
        AsyncPollPolicy {
            initial_delay_seconds: 0,
            interval_seconds: selection.poll_interval_seconds,
            timeout_seconds: selection.poll_timeout_seconds,
        },
        &mut logger,
        Some(&mut recovery),
        &proxy,
    ) {
        Ok(result) => Ok(result.payload),
        Err(error) => {
            let _ = recovery.finish_error(RecoveryStage::Submitted, &error);
            Err(error)
        }
    }
}

struct PollResult {
    payload: Value,
    poll_attempts: usize,
    transient_retries: usize,
}

#[derive(Debug, Clone, Copy)]
struct AsyncPollPolicy {
    initial_delay_seconds: u64,
    interval_seconds: u64,
    timeout_seconds: u64,
}

fn poll_sub2api_task(
    receipt: &AsyncTaskReceipt,
    auth_state: &OpenAiAuthState,
    policy: AsyncPollPolicy,
    logger: &mut JsonEventLogger,
    mut recovery: Option<&mut RecoveryContext>,
    proxy: &ProxyConfig,
) -> Result<PollResult, AppError> {
    let client = make_client(DEFAULT_REQUEST_TIMEOUT.min(policy.timeout_seconds), proxy)?;
    let started = Instant::now();
    let mut delay_seconds = policy.initial_delay_seconds.min(60);
    let mut poll_attempts = 0;
    let mut transient_retries = 0;
    let mut last_status = receipt.status.clone();

    loop {
        sleep_with_deadline(
            delay_seconds,
            started,
            policy.timeout_seconds,
            &receipt.task_id,
        )?;
        poll_attempts += 1;
        let timeout = Duration::from_secs(policy.timeout_seconds);
        let remaining = timeout.saturating_sub(started.elapsed());
        if remaining.is_zero() {
            return Err(async_task_timeout_error(
                &receipt.task_id,
                policy.timeout_seconds,
            ));
        }
        let response = match client
            .get(&receipt.poll_url)
            .header(AUTHORIZATION, format!("Bearer {}", auth_state.api_key))
            .header(ACCEPT, "application/json")
            .timeout(remaining.min(Duration::from_secs(DEFAULT_REQUEST_TIMEOUT)))
            .send()
        {
            Ok(response) => response,
            Err(error) => {
                if started.elapsed() >= timeout {
                    return Err(async_task_timeout_error(
                        &receipt.task_id,
                        policy.timeout_seconds,
                    ));
                }
                transient_retries += 1;
                emit_async_poll_retry(
                    logger,
                    &receipt.task_id,
                    transient_retries,
                    policy.interval_seconds,
                    &error.to_string(),
                    None,
                );
                delay_seconds = policy.interval_seconds;
                continue;
            }
        };

        let retry_after = poll_delay_from_headers(response.headers(), policy.interval_seconds);
        if let Some(ctx) = recovery.as_deref_mut() {
            ctx.mark_response_headers(response.headers())?;
        }
        if !response.status().is_success() {
            let status = response.status();
            let detail = response.text().unwrap_or_default();
            let error = http_status_error(status, detail);
            if should_retry(&error) {
                transient_retries += 1;
                emit_async_poll_retry(
                    logger,
                    &receipt.task_id,
                    transient_retries,
                    retry_after,
                    &error.message,
                    error.status_code,
                );
                delay_seconds = retry_after;
                continue;
            }
            return Err(error);
        }

        let task = read_json_object_response(response, "sub2api task poll")?;
        let status = task
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("processing")
            .to_ascii_lowercase();
        if let Some(ctx) = recovery.as_deref_mut() {
            ctx.mark_remote_task_status(&status)?;
        }
        if status != last_status {
            emit_progress_event(
                logger,
                "sub2api",
                "async_task_status",
                "sub2api async image task status changed.",
                "running",
                None,
                json!({
                    "task_id": receipt.task_id,
                    "task_status": status,
                    "poll_attempts": poll_attempts,
                }),
            );
            last_status = status.clone();
        }
        if status == "completed" {
            let payload = completed_task_result(
                task.get("result").cloned(),
                &receipt.task_id,
                logger,
                recovery.as_deref_mut(),
            )?;
            return Ok(PollResult {
                payload,
                poll_attempts,
                transient_retries,
            });
        }
        if is_failed_task_status(&status) {
            return Err(async_task_failed_error(
                &receipt.task_id,
                &status,
                task.get("error").cloned(),
            ));
        }
        if !is_pending_task_status(&status) {
            return Err(AppError::new(
                "async_task_invalid_response",
                format!("sub2api returned an unsupported task status: {status}"),
            )
            .with_detail(json!({
                "task_id": receipt.task_id,
                "status": status,
            })));
        }
        delay_seconds = retry_after;
    }
}

fn submit_sub2api_async_once(
    target: &AsyncSubmitTarget<'_>,
    auth_state: &OpenAiAuthState,
    body: &Value,
    logger: &mut JsonEventLogger,
    mut recovery: Option<&mut RecoveryContext>,
    proxy: &ProxyConfig,
) -> Result<AsyncTaskReceipt, AppError> {
    logger.emit(
        "local",
        "request.started",
        json!({
            "provider": "sub2api",
            "endpoint": target.endpoint,
            "transport": IMAGE_TRANSPORT_SUB2API_ASYNC,
        }),
    );
    emit_progress_event(
        logger,
        "sub2api",
        "request_started",
        "sub2api async image request submitted.",
        "running",
        Some(0),
        json!({
            "endpoint": target.endpoint,
            "transport": IMAGE_TRANSPORT_SUB2API_ASYNC,
        }),
    );
    let client_request_id = if let Some(ctx) = recovery.as_deref_mut() {
        let client_request_id = ctx.begin_attempt()?;
        test_fault::record_provider_http_attempt(&ctx.job_id);
        Some(client_request_id)
    } else {
        None
    };
    let client = make_client(DEFAULT_REQUEST_TIMEOUT, proxy)?;
    let mut request = if target.operation == "edit" {
        client
            .post(target.endpoint)
            .header(AUTHORIZATION, format!("Bearer {}", auth_state.api_key))
            .header(ACCEPT, "application/json")
            .multipart(build_openai_edit_form(body)?)
    } else {
        client
            .post(target.endpoint)
            .header(AUTHORIZATION, format!("Bearer {}", auth_state.api_key))
            .header(CONTENT_TYPE, "application/json")
            .header(ACCEPT, "application/json")
            .body(body.to_string())
    };
    if let Some(client_request_id) = &client_request_id {
        request = request.header("X-Client-Request-Id", client_request_id);
    }
    let response = request.send().map_err(|error| {
        AppError::new("network_error", "sub2api async submission failed.")
            .with_detail(json!({ "error": error.to_string() }))
    })?;
    let retry_after = retry_after_seconds(response.headers(), DEFAULT_IMAGE_POLL_INTERVAL_SECONDS);
    if let Some(ctx) = recovery.as_deref_mut() {
        ctx.mark_response_headers(response.headers())?;
    }
    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().unwrap_or_default();
        return Err(http_status_error(status, detail));
    }
    let payload = read_json_object_response(response, "sub2api async submission")?;
    let receipt = parse_async_task_receipt(payload, target.api_base, retry_after)?;
    if let Some(ctx) = recovery {
        ctx.mark_remote_task(&receipt.task_id, &receipt.poll_url, &receipt.status)?;
    }
    Ok(receipt)
}

fn parse_async_task_receipt(
    payload: Value,
    api_base: &str,
    retry_after_seconds: u64,
) -> Result<AsyncTaskReceipt, AppError> {
    let task_id = payload
        .get("task_id")
        .or_else(|| payload.get("id"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            AppError::new(
                "async_submit_invalid_response",
                "sub2api async submission did not return a task_id.",
            )
            .with_detail(redact_event_payload(&payload))
        })?
        .to_string();
    let poll_url = resolve_sub2api_poll_url(
        api_base,
        payload.get("poll_url").and_then(Value::as_str),
        &task_id,
    )?;
    let status = payload
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("processing")
        .to_ascii_lowercase();
    Ok(AsyncTaskReceipt {
        task_id,
        poll_url,
        status,
        retry_after_seconds,
        result: payload.get("result").cloned(),
    })
}

fn completed_task_result(
    result: Option<Value>,
    task_id: &str,
    logger: &mut JsonEventLogger,
    recovery: Option<&mut RecoveryContext>,
) -> Result<Value, AppError> {
    let mut payload = result.ok_or_else(|| {
        AppError::new(
            "async_task_invalid_response",
            "Completed sub2api task did not include the OpenAI Images result.",
        )
        .with_detail(json!({ "task_id": task_id }))
    })?;
    if let Some(raw) = payload.as_str() {
        payload = serde_json::from_str(raw).map_err(|error| {
            AppError::new(
                "async_task_invalid_response",
                "Completed sub2api task result was not valid JSON.",
            )
            .with_detail(json!({
                "task_id": task_id,
                "error": error.to_string(),
            }))
        })?;
    }
    if !payload.is_object() {
        return Err(AppError::new(
            "async_task_invalid_response",
            "Completed sub2api task result must be an OpenAI Images response object.",
        )
        .with_detail(json!({ "task_id": task_id })));
    }
    if let Some(ctx) = recovery {
        let raw = serde_json::to_string(&payload).map_err(|error| {
            AppError::new(
                "recovery_json_encode_failed",
                "Unable to encode completed async image response.",
            )
            .with_detail(json!({ "error": error.to_string() }))
        })?;
        ctx.mark_response_body_completed()?;
        ctx.spool_raw_response(&raw)?;
    }
    emit_progress_event(
        logger,
        "sub2api",
        "async_task_completed",
        "sub2api async image task completed.",
        "running",
        Some(95),
        json!({
            "task_id": task_id,
            "created": payload.get("created"),
            "image_count": payload
                .get("data")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or(0),
        }),
    );
    Ok(payload)
}

fn read_json_object_response(response: Response, context: &str) -> Result<Value, AppError> {
    let raw = response.text().map_err(|error| {
        AppError::new(
            "async_task_invalid_response",
            format!("{context} response body could not be read."),
        )
        .with_detail(json!({ "error": error.to_string() }))
    })?;
    let payload: Value = serde_json::from_str(&raw).map_err(|error| {
        AppError::new(
            "async_task_invalid_response",
            format!("{context} returned invalid JSON."),
        )
        .with_detail(json!({ "error": error.to_string() }))
    })?;
    if !payload.is_object() {
        return Err(AppError::new(
            "async_task_invalid_response",
            format!("{context} returned a non-object JSON payload."),
        ));
    }
    Ok(payload)
}

pub(crate) fn build_sub2api_async_endpoint(
    api_base: &str,
    operation: &str,
) -> Result<String, AppError> {
    Ok(format!(
        "{}/async",
        build_openai_operation_endpoint(api_base, operation)?
    ))
}

pub(crate) fn resolve_sub2api_poll_url(
    api_base: &str,
    poll_url: Option<&str>,
    task_id: &str,
) -> Result<String, AppError> {
    let base_text = format!("{}/", api_base.trim_end_matches('/'));
    let base = Url::parse(&base_text).map_err(|error| {
        AppError::new(
            "invalid_provider_config",
            "Provider api_base must be a valid absolute URL.",
        )
        .with_detail(json!({ "error": error.to_string() }))
    })?;
    let candidate = if let Some(poll_url) = poll_url.filter(|value| !value.trim().is_empty()) {
        base.join(poll_url).map_err(|error| {
            AppError::new(
                "async_poll_url_invalid",
                "sub2api returned an invalid poll_url.",
            )
            .with_detail(json!({ "error": error.to_string() }))
        })?
    } else {
        let mut fallback = base.clone();
        fallback
            .path_segments_mut()
            .map_err(|_| {
                AppError::new(
                    "async_poll_url_invalid",
                    "Provider api_base cannot be used to construct a task URL.",
                )
            })?
            .extend(["images", "tasks", task_id]);
        fallback
    };
    if !same_origin(&base, &candidate) {
        return Err(AppError::new(
            "async_poll_url_untrusted",
            "sub2api poll_url must use the same origin as api_base.",
        )
        .with_detail(json!({
            "api_base_origin": origin_label(&base),
            "poll_origin": origin_label(&candidate),
        })));
    }
    Ok(candidate.to_string())
}

fn same_origin(left: &Url, right: &Url) -> bool {
    left.scheme() == right.scheme()
        && left.host_str() == right.host_str()
        && left.port_or_known_default() == right.port_or_known_default()
}

fn origin_label(url: &Url) -> String {
    format!(
        "{}://{}{}",
        url.scheme(),
        url.host_str().unwrap_or_default(),
        url.port()
            .map(|port| format!(":{port}"))
            .unwrap_or_default()
    )
}

fn retry_after_seconds(headers: &HeaderMap, fallback: u64) -> u64 {
    headers
        .get("retry-after")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(fallback)
        .clamp(1, 60)
}

fn poll_delay_seconds(retry_after_seconds: u64, configured_interval_seconds: u64) -> u64 {
    retry_after_seconds
        .max(configured_interval_seconds)
        .clamp(1, 60)
}

fn poll_delay_from_headers(headers: &HeaderMap, configured_interval_seconds: u64) -> u64 {
    poll_delay_seconds(
        retry_after_seconds(headers, configured_interval_seconds),
        configured_interval_seconds,
    )
}

fn sleep_with_deadline(
    delay_seconds: u64,
    started: Instant,
    timeout_seconds: u64,
    task_id: &str,
) -> Result<(), AppError> {
    let elapsed = started.elapsed();
    let timeout = Duration::from_secs(timeout_seconds);
    if elapsed >= timeout {
        return Err(async_task_timeout_error(task_id, timeout_seconds));
    }
    let remaining = timeout.saturating_sub(elapsed);
    std::thread::sleep(Duration::from_secs(delay_seconds).min(remaining));
    if started.elapsed() >= timeout {
        return Err(async_task_timeout_error(task_id, timeout_seconds));
    }
    Ok(())
}

fn async_task_timeout_error(task_id: &str, timeout_seconds: u64) -> AppError {
    AppError::new(
        "async_task_timeout",
        "Timed out while waiting for the sub2api image task.",
    )
    .with_detail(json!({
        "task_id": task_id,
        "timeout_seconds": timeout_seconds,
        "remote_task_may_still_be_running": true,
    }))
}

fn emit_async_poll_retry(
    logger: &mut JsonEventLogger,
    task_id: &str,
    retry_number: usize,
    delay_seconds: u64,
    reason: &str,
    status_code: Option<u16>,
) {
    emit_progress_event(
        logger,
        "sub2api",
        "async_poll_retry",
        "Retrying sub2api task polling after a transient failure.",
        "running",
        None,
        json!({
            "task_id": task_id,
            "retry_number": retry_number,
            "delay_seconds": delay_seconds,
            "reason": reason,
            "status_code": status_code,
        }),
    );
}

fn is_pending_task_status(status: &str) -> bool {
    matches!(
        status,
        "pending" | "queued" | "processing" | "in_progress" | "running"
    )
}

fn is_failed_task_status(status: &str) -> bool {
    matches!(status, "failed" | "cancelled" | "expired")
}

fn async_task_failed_error(task_id: &str, status: &str, detail: Option<Value>) -> AppError {
    AppError::new(
        "async_task_failed",
        format!("sub2api image task ended with status {status}."),
    )
    .with_detail(json!({
        "task_id": task_id,
        "status": status,
        "error": detail.map(|value| redact_event_payload(&value)),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};

    fn read_request(stream: &mut TcpStream) -> String {
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut bytes = Vec::new();
        let mut buffer = [0_u8; 2048];
        let header_end = loop {
            let read = stream.read(&mut buffer).unwrap();
            assert!(read > 0, "request closed before headers completed");
            bytes.extend_from_slice(&buffer[..read]);
            if let Some(position) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                break position + 4;
            }
        };
        let headers = String::from_utf8_lossy(&bytes[..header_end]);
        let content_length = headers
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse::<usize>().ok())
                    .flatten()
            })
            .unwrap_or(0);
        while bytes.len() < header_end + content_length {
            let read = stream.read(&mut buffer).unwrap();
            assert!(read > 0, "request closed before body completed");
            bytes.extend_from_slice(&buffer[..read]);
        }
        String::from_utf8_lossy(&bytes).to_string()
    }

    fn write_json_response(
        stream: &mut TcpStream,
        status: &str,
        body: &str,
        retry_after: Option<u64>,
    ) {
        let retry_after = retry_after
            .map(|seconds| format!("Retry-After: {seconds}\r\n"))
            .unwrap_or_default();
        write!(
            stream,
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\n{retry_after}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
        .unwrap();
        stream.flush().unwrap();
    }

    #[test]
    fn async_transport_submits_once_then_polls_to_openai_result() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut submit, _) = listener.accept().unwrap();
            let submit_request = read_request(&mut submit);
            assert!(submit_request.starts_with("POST /v1/images/generations/async "));
            write_json_response(
                &mut submit,
                "202 Accepted",
                r#"{"task_id":"task-rust","status":"processing","poll_url":"/v1/images/tasks/task-rust"}"#,
                Some(1),
            );

            let (mut poll, _) = listener.accept().unwrap();
            let poll_request = read_request(&mut poll);
            assert!(poll_request.starts_with("GET /v1/images/tasks/task-rust "));
            assert!(
                poll_request
                    .to_ascii_lowercase()
                    .contains("authorization: bearer sk-test")
            );
            write_json_response(
                &mut poll,
                "200 OK",
                r#"{"task_id":"task-rust","status":"completed","result":{"created":1,"data":[{"b64_json":"YWJjZA=="}]}}"#,
                None,
            );
        });
        let selection = ProviderSelection {
            requested: "sub2api".to_string(),
            resolved: "sub2api".to_string(),
            reason: "test".to_string(),
            kind: ProviderKind::OpenAi,
            api_base: format!("http://{address}/v1"),
            codex_endpoint: DEFAULT_CODEX_ENDPOINT.to_string(),
            default_model: DEFAULT_OPENAI_MODEL.to_string(),
            supports_n: true,
            edit_region_mode: EDIT_REGION_REFERENCE_HINT.to_string(),
            preset: PROVIDER_PRESET_SUB2API.to_string(),
            image_transport: IMAGE_TRANSPORT_SUB2API_ASYNC.to_string(),
            poll_interval_seconds: 1,
            poll_timeout_seconds: 30,
        };
        let auth = OpenAiAuthState {
            api_key: "sk-test".to_string(),
            source: "test".to_string(),
        };
        let proxy = ProxyConfig {
            mode: ProxyMode::None,
            ..ProxyConfig::default()
        };
        let mut logger = JsonEventLogger::new(false);

        let result = request_openai_with_transport(
            &selection,
            "generate",
            &auth,
            &json!({"model": "gpt-image-2", "prompt": "test"}),
            &mut logger,
            None,
            &proxy,
        )
        .unwrap();

        assert_eq!(result.payload["data"][0]["b64_json"], "YWJjZA==");
        assert_eq!(result.async_task.as_ref().unwrap()["task_id"], "task-rust");
        assert_eq!(result.retry_count, 0);
        server.join().unwrap();
    }

    #[test]
    fn async_poll_retries_do_not_exceed_the_submission_retry_contract() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut submit, _) = listener.accept().unwrap();
            let submit_request = read_request(&mut submit);
            assert!(submit_request.starts_with("POST /v1/images/generations/async "));
            write_json_response(
                &mut submit,
                "202 Accepted",
                r#"{"task_id":"task-retry","status":"processing","poll_url":"/v1/images/tasks/task-retry"}"#,
                Some(1),
            );

            let (mut transient_poll, _) = listener.accept().unwrap();
            let transient_request = read_request(&mut transient_poll);
            assert!(transient_request.starts_with("GET /v1/images/tasks/task-retry "));
            write_json_response(
                &mut transient_poll,
                "503 Service Unavailable",
                r#"{"error":{"message":"poll temporarily unavailable"}}"#,
                Some(1),
            );

            let (mut completed_poll, _) = listener.accept().unwrap();
            let completed_request = read_request(&mut completed_poll);
            assert!(completed_request.starts_with("GET /v1/images/tasks/task-retry "));
            write_json_response(
                &mut completed_poll,
                "200 OK",
                r#"{"task_id":"task-retry","status":"completed","result":{"created":1,"data":[{"b64_json":"YWJjZA=="}]}}"#,
                None,
            );
        });
        let selection = ProviderSelection {
            requested: "sub2api".to_string(),
            resolved: "sub2api".to_string(),
            reason: "test".to_string(),
            kind: ProviderKind::OpenAi,
            api_base: format!("http://{address}/v1"),
            codex_endpoint: DEFAULT_CODEX_ENDPOINT.to_string(),
            default_model: DEFAULT_OPENAI_MODEL.to_string(),
            supports_n: true,
            edit_region_mode: EDIT_REGION_REFERENCE_HINT.to_string(),
            preset: PROVIDER_PRESET_SUB2API.to_string(),
            image_transport: IMAGE_TRANSPORT_SUB2API_ASYNC.to_string(),
            poll_interval_seconds: 1,
            poll_timeout_seconds: 30,
        };
        let auth = OpenAiAuthState {
            api_key: "sk-test".to_string(),
            source: "test".to_string(),
        };
        let proxy = ProxyConfig {
            mode: ProxyMode::None,
            ..ProxyConfig::default()
        };
        let mut logger = JsonEventLogger::new(false);

        let result = request_openai_with_transport(
            &selection,
            "generate",
            &auth,
            &json!({"model": "gpt-image-2", "prompt": "test"}),
            &mut logger,
            None,
            &proxy,
        )
        .unwrap();

        assert_eq!(result.retry_count, 0);
        assert_eq!(result.async_task.as_ref().unwrap()["transient_retries"], 1);
        server.join().unwrap();
    }

    #[test]
    fn async_submission_failure_is_not_retried() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut submit, _) = listener.accept().unwrap();
            let submit_request = read_request(&mut submit);
            assert!(submit_request.starts_with("POST /v1/images/generations/async "));
            write_json_response(
                &mut submit,
                "500 Internal Server Error",
                r#"{"error":{"message":"uncertain acceptance"}}"#,
                None,
            );
            listener.set_nonblocking(true).unwrap();
            let deadline = Instant::now() + Duration::from_millis(1_500);
            while Instant::now() < deadline {
                match listener.accept() {
                    Ok(_) => panic!("async submission was retried"),
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(25));
                    }
                    Err(error) => panic!("unexpected listener error: {error}"),
                }
            }
        });
        let selection = ProviderSelection {
            requested: "sub2api".to_string(),
            resolved: "sub2api".to_string(),
            reason: "test".to_string(),
            kind: ProviderKind::OpenAi,
            api_base: format!("http://{address}/v1"),
            codex_endpoint: DEFAULT_CODEX_ENDPOINT.to_string(),
            default_model: DEFAULT_OPENAI_MODEL.to_string(),
            supports_n: true,
            edit_region_mode: EDIT_REGION_REFERENCE_HINT.to_string(),
            preset: PROVIDER_PRESET_SUB2API.to_string(),
            image_transport: IMAGE_TRANSPORT_SUB2API_ASYNC.to_string(),
            poll_interval_seconds: 1,
            poll_timeout_seconds: 30,
        };
        let auth = OpenAiAuthState {
            api_key: "sk-test".to_string(),
            source: "test".to_string(),
        };
        let proxy = ProxyConfig {
            mode: ProxyMode::None,
            ..ProxyConfig::default()
        };
        let mut logger = JsonEventLogger::new(false);
        let error = request_openai_with_transport(
            &selection,
            "generate",
            &auth,
            &json!({"model": "gpt-image-2", "prompt": "test"}),
            &mut logger,
            None,
            &proxy,
        )
        .unwrap_err();

        assert_eq!(error.status_code, Some(500));
        server.join().unwrap();
    }

    #[test]
    fn configured_poll_interval_is_a_lower_bound() {
        let mut headers = HeaderMap::new();
        headers.insert("retry-after", HeaderValue::from_static("3"));

        assert_eq!(poll_delay_from_headers(&headers, 10), 10);
        assert_eq!(poll_delay_from_headers(&headers, 1), 3);
    }
}
