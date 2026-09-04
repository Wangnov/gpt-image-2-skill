#![allow(unused_imports)]

use super::*;

fn atlas_endpoint(api_base: &str, path: &str) -> String {
    format!("{}{}", api_base.trim_end_matches('/'), path)
}

fn parse_atlas_response(response: Response, action: &str) -> Result<Value, AppError> {
    let status = response.status();
    let raw = response.text().map_err(|error| {
        AppError::new(
            "invalid_json_response",
            format!("Unable to read Atlas {action} response."),
        )
        .with_detail(json!({"error": error.to_string()}))
    })?;
    if !status.is_success() {
        return Err(http_status_error(status, raw));
    }
    serde_json::from_str::<Value>(&raw).map_err(|error| {
        AppError::new(
            "invalid_json_response",
            format!("Atlas {action} returned invalid JSON."),
        )
        .with_detail(json!({"error": error.to_string()}))
    })
}

pub(crate) fn validate_atlas_image_args(shared: &SharedImageArgs) -> Result<(), AppError> {
    if shared.prompt.trim().is_empty() {
        return Err(AppError::new(
            "invalid_prompt",
            "Atlas Cloud requires a non-empty prompt.",
        ));
    }
    if shared.instructions != DEFAULT_INSTRUCTIONS {
        return Err(AppError::new(
            "unsupported_option",
            "--instructions is not supported by the Atlas image provider.",
        ));
    }
    if shared.background != Background::Auto {
        return Err(AppError::new(
            "unsupported_option",
            "The Atlas image provider currently supports --background auto only.",
        ));
    }
    if shared.output_compression.is_some() {
        return Err(AppError::new(
            "unsupported_option",
            "--compression is not supported by the Atlas image provider.",
        ));
    }
    if shared.n.unwrap_or(1) != 1 {
        return Err(AppError::new(
            "unsupported_option",
            "The Atlas image provider currently supports one output per request.",
        ));
    }
    if shared.output_format == Some(OutputFormat::Webp) {
        return Err(AppError::new(
            "unsupported_option",
            "The Atlas image provider supports jpeg and png output formats.",
        ));
    }
    Ok(())
}

pub(crate) fn build_atlas_image_body(shared: &SharedImageArgs, model: &str) -> Value {
    let mut body = Map::new();
    body.insert("model".to_string(), json!(model));
    body.insert("prompt".to_string(), json!(&shared.prompt));
    maybe_add_value(
        &mut body,
        "size",
        shared.size.as_deref().map(|value| json!(value)),
    );
    maybe_add_value(
        &mut body,
        "quality",
        shared
            .quality
            .filter(|value| *value != Quality::Auto)
            .map(|value| json!(value.as_str())),
    );
    maybe_add_value(
        &mut body,
        "output_format",
        shared.output_format.map(|value| json!(value.as_str())),
    );
    maybe_add_value(
        &mut body,
        "moderation",
        shared.moderation.map(|value| json!(value.as_str())),
    );
    Value::Object(body)
}

pub(crate) fn request_atlas_prediction(
    api_base: &str,
    api_key: &str,
    body: &Value,
    logger: &mut JsonEventLogger,
    proxy: &ProxyConfig,
    poll_attempts: usize,
    poll_delay_seconds: u64,
) -> Result<(Value, usize), AppError> {
    let client = make_client(DEFAULT_REQUEST_TIMEOUT, proxy)?;
    let submit_endpoint = atlas_endpoint(api_base, ATLAS_GENERATE_PATH);
    emit_progress_event(
        logger,
        "atlas",
        "request_started",
        "Atlas image request submitted.",
        "running",
        Some(0),
        json!({"endpoint": submit_endpoint}),
    );

    // Generation is billable, so the POST is intentionally attempted exactly once.
    let submitted = parse_atlas_response(
        client
            .post(&submit_endpoint)
            .header(AUTHORIZATION, format!("Bearer {api_key}"))
            .header(CONTENT_TYPE, "application/json")
            .header(ACCEPT, "application/json")
            .body(body.to_string())
            .send()
            .map_err(|error| {
                AppError::new("network_error", "Atlas generation request failed.")
                    .with_detail(json!({"error": error.to_string()}))
            })?,
        "generation",
    )?;
    let request_id = submitted
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| {
            !value.is_empty()
                && value
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric() || "-_.".contains(character))
        })
        .ok_or_else(|| {
            AppError::new(
                "invalid_json_response",
                "Atlas generation response did not include a valid request id.",
            )
        })?;

    if submitted.get("status").and_then(Value::as_str) == Some("completed") {
        return Ok((submitted, 0));
    }

    let result_endpoint = atlas_endpoint(api_base, &format!("{ATLAS_RESULT_PATH}/{request_id}"));
    for attempt in 1..=poll_attempts {
        if poll_delay_seconds > 0 {
            let delay = poll_delay_seconds.saturating_mul(attempt.min(5) as u64);
            thread::sleep(Duration::from_secs(delay));
        }
        let response = client
            .get(&result_endpoint)
            .header(AUTHORIZATION, format!("Bearer {api_key}"))
            .header(ACCEPT, "application/json")
            .send()
            .map_err(|error| {
                AppError::new("network_error", "Atlas result request failed.")
                    .with_detail(json!({"error": error.to_string()}))
            })
            .and_then(|response| parse_atlas_response(response, "result"));
        let payload = match response {
            Ok(payload) => payload,
            Err(error) if attempt < poll_attempts && should_retry(&error) => continue,
            Err(error) => return Err(error),
        };
        match payload.get("status").and_then(Value::as_str) {
            Some("completed") => return Ok((payload, attempt)),
            Some("failed") => {
                return Err(
                    AppError::new("prediction_failed", "Atlas image generation failed.")
                        .with_detail(redact_event_payload(&payload)),
                );
            }
            Some("created" | "processing") => {
                emit_progress_event(
                    logger,
                    "atlas",
                    "polling",
                    "Waiting for Atlas image generation.",
                    "running",
                    None,
                    json!({"attempt": attempt, "max_attempts": poll_attempts}),
                );
            }
            status => {
                return Err(AppError::new(
                    "invalid_json_response",
                    "Atlas result returned an unknown status.",
                )
                .with_detail(json!({"status": status})));
            }
        }
    }
    Err(AppError::new(
        "request_timeout",
        "Timed out waiting for Atlas image generation.",
    )
    .with_detail(json!({"request_id": request_id, "poll_attempts": poll_attempts})))
}

pub(crate) fn run_atlas_image_command(
    cli: &Cli,
    selection: &ProviderSelection,
    shared: &SharedImageArgs,
) -> Result<CommandOutcome, AppError> {
    validate_atlas_image_args(shared)?;
    let auth_state = load_openai_auth_state_for(cli, selection)?;
    let proxy = effective_proxy_for(cli, &selection.resolved)?;
    let resolved_model = shared
        .model
        .clone()
        .unwrap_or_else(|| selection.default_model.clone());
    let body = build_atlas_image_body(shared, &resolved_model);
    let mut logger = JsonEventLogger::new(cli.json_events);
    let (payload, poll_count) = request_atlas_prediction(
        &selection.api_base,
        &auth_state.api_key,
        &body,
        &mut logger,
        &proxy,
        ATLAS_POLL_ATTEMPTS,
        ATLAS_POLL_DELAY_SECONDS,
    )?;
    let outputs = payload
        .get("outputs")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            AppError::new(
                "missing_image_result",
                "Atlas completed without an outputs array.",
            )
        })?;
    let image_bytes_list = outputs
        .iter()
        .map(|output| {
            output
                .as_str()
                .ok_or_else(|| {
                    AppError::new("invalid_json_response", "Atlas returned a non-URL output.")
                })
                .and_then(|url| download_result_image_bytes(url, &proxy))
        })
        .collect::<Result<Vec<_>, _>>()?;
    if image_bytes_list.is_empty() {
        return Err(AppError::new(
            "missing_image_result",
            "Atlas completed without a generated image.",
        ));
    }
    let output_path = PathBuf::from(&shared.out);
    let saved_files = save_images(&output_path, &image_bytes_list)?;
    let primary_output_path = primary_saved_output_path(&output_path, &saved_files);
    let history_job_id = record_history_job(
        "images generate",
        &selection.resolved,
        "completed",
        Some(&primary_output_path),
        history_image_metadata("generate", selection, shared, &saved_files),
    )
    .ok();
    emit_progress_event(
        &mut logger,
        "atlas",
        "output_saved",
        "Generated image files saved.",
        "completed",
        Some(100),
        json!({"file_count": saved_files.len(), "output": normalize_saved_output(&saved_files)}),
    );
    Ok(CommandOutcome {
        payload: json!({
            "ok": true,
            "command": "images generate",
            "provider": selection.resolved,
            "provider_selection": selection.payload(),
            "auth": {"source": auth_state.source, "refreshed": false},
            "request": summarize_image_request_options("atlas", "generate", &resolved_model, shared, 0, false, None),
            "response": {"request_id": payload.get("id"), "status": payload.get("status"), "image_count": image_bytes_list.len()},
            "output": normalize_saved_output(&saved_files),
            "history": {"job_id": history_job_id},
            "retry": {"submit_count": 1, "poll_count": poll_count},
            "events": {"count": logger.seq},
        }),
        exit_status: 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    fn shared_args(prompt: &str) -> SharedImageArgs {
        SharedImageArgs {
            prompt: prompt.to_string(),
            out: "result.png".to_string(),
            model: None,
            instructions: DEFAULT_INSTRUCTIONS.to_string(),
            background: Background::Auto,
            size: None,
            quality: None,
            output_format: None,
            output_compression: None,
            n: None,
            moderation: None,
            recovery_job_id: None,
            recovery_job_dir: None,
        }
    }

    fn read_request(stream: &mut TcpStream) -> String {
        let mut request = Vec::new();
        let mut buf = [0_u8; 1024];
        loop {
            let count = stream.read(&mut buf).unwrap();
            if count == 0 {
                break;
            }
            request.extend_from_slice(&buf[..count]);
            if request.windows(4).any(|window| window == b"\r\n\r\n") {
                break;
            }
        }
        String::from_utf8_lossy(&request).into_owned()
    }

    #[test]
    fn atlas_submits_once_and_retries_result_get_only() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let methods = Arc::new(Mutex::new(Vec::new()));
        let captured = Arc::clone(&methods);
        let server = thread::spawn(move || {
            let responses = [
                (200, r#"{"id":"req-1","status":"created","outputs":[]}"#),
                (500, r#"{"error":"temporary"}"#),
                (
                    200,
                    r#"{"id":"req-1","status":"completed","outputs":["https://cdn.example.com/image.png"]}"#,
                ),
            ];
            for (status, body) in responses {
                let (mut stream, _) = listener.accept().unwrap();
                let request = read_request(&mut stream);
                captured
                    .lock()
                    .unwrap()
                    .push(request.lines().next().unwrap_or_default().to_string());
                let reason = if status == 200 {
                    "OK"
                } else {
                    "Internal Server Error"
                };
                write!(
                    stream,
                    "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                )
                .unwrap();
            }
        });
        let mut logger = JsonEventLogger::new(false);
        let (result, polls) = request_atlas_prediction(
            &format!("http://{address}"),
            "atlas-test-key",
            &json!({"model": DEFAULT_ATLAS_MODEL, "prompt": "test"}),
            &mut logger,
            &ProxyConfig {
                mode: ProxyMode::None,
                ..Default::default()
            },
            3,
            0,
        )
        .unwrap();
        server.join().unwrap();
        let methods = methods.lock().unwrap();
        assert_eq!(
            methods
                .iter()
                .filter(|line| line.starts_with("POST "))
                .count(),
            1
        );
        assert_eq!(
            methods
                .iter()
                .filter(|line| line.starts_with("GET "))
                .count(),
            2
        );
        assert_eq!(result["status"], "completed");
        assert_eq!(polls, 2);
    }

    #[test]
    fn atlas_rejects_empty_prompt_before_submission() {
        let error = validate_atlas_image_args(&shared_args("   ")).unwrap_err();
        assert_eq!(error.code, "invalid_prompt");
    }
}
