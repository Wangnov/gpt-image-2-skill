#![allow(unused_imports)]

use super::*;

pub(crate) fn run_target_uploads(
    config: &StorageConfig,
    job_id: &str,
    output: &UploadOutput,
    target_names: &[String],
    role: &str,
) -> Result<bool, AppError> {
    let target_concurrency = config.target_concurrency.clamp(1, 32);
    let (tx, rx) = mpsc::channel::<Result<bool, AppError>>();
    let mut active = 0usize;
    let mut completed = false;
    let mut first_error = None;
    for target_name in target_names {
        while active >= target_concurrency {
            match rx.recv() {
                Ok(Ok(value)) => {
                    completed |= value;
                    active = active.saturating_sub(1);
                }
                Ok(Err(error)) => {
                    first_error.get_or_insert(error);
                    active = active.saturating_sub(1);
                }
                Err(_) => break,
            }
        }
        if let Some(target) = config.targets.get(target_name) {
            let tx = tx.clone();
            let job_id = job_id.to_string();
            let output = output.clone();
            let target_name = target_name.clone();
            let target = target.clone();
            let role = role.to_string();
            thread::spawn(move || {
                let result = record_upload_attempt(&job_id, &output, &target_name, &target, &role);
                let _ = tx.send(result);
            });
            active += 1;
        } else {
            if let Err(error) = record_missing_storage_target(job_id, output, target_name, role) {
                first_error.get_or_insert(error);
            }
        }
    }
    drop(tx);
    while active > 0 {
        match rx.recv() {
            Ok(Ok(value)) => {
                completed |= value;
                active -= 1;
            }
            Ok(Err(error)) => {
                first_error.get_or_insert(error);
                active -= 1;
            }
            Err(_) => break,
        }
    }
    if let Some(error) = first_error {
        Err(error)
    } else {
        Ok(completed)
    }
}

pub fn upload_job_outputs_to_storage(
    config: &StorageConfig,
    job: &Value,
    overrides: StorageUploadOverrides,
) -> Result<Vec<OutputUploadRecord>, AppError> {
    let Some(job_id) = job.get("id").and_then(Value::as_str) else {
        return Err(AppError::new(
            "storage_job_invalid",
            "Job id is required before uploading outputs.",
        ));
    };
    let outputs = upload_outputs_from_job(job);
    if outputs.is_empty() {
        return list_output_upload_records(job_id);
    }
    let (primary_names, fallback_names) = target_names_for_upload(config, &overrides);
    if primary_names.is_empty() && config.fallback_policy != StorageFallbackPolicy::Always {
        return list_output_upload_records(job_id);
    }
    let upload_concurrency = config.upload_concurrency.clamp(1, 32);
    let (tx, rx) = mpsc::channel::<Result<(), AppError>>();
    let mut active = 0usize;
    let mut first_error = None;
    for output in outputs {
        while active >= upload_concurrency {
            match rx.recv() {
                Ok(Ok(())) => {}
                Ok(Err(error)) => {
                    first_error.get_or_insert(error);
                }
                Err(_) => break,
            }
            active = active.saturating_sub(1);
        }
        let tx = tx.clone();
        let job_id = job_id.to_string();
        let config = config.clone();
        let primary_names = primary_names.clone();
        let fallback_names = fallback_names.clone();
        thread::spawn(move || {
            let primary_completed =
                match run_target_uploads(&config, &job_id, &output, &primary_names, "primary") {
                    Ok(value) => value,
                    Err(error) => {
                        let _ = tx.send(Err(error));
                        return;
                    }
                };
            let should_run_fallback = match config.fallback_policy {
                StorageFallbackPolicy::Never => false,
                StorageFallbackPolicy::Always => true,
                StorageFallbackPolicy::OnFailure => !primary_names.is_empty() && !primary_completed,
            };
            if should_run_fallback {
                if let Err(error) =
                    run_target_uploads(&config, &job_id, &output, &fallback_names, "fallback")
                {
                    let _ = tx.send(Err(error));
                    return;
                }
            }
            let _ = tx.send(Ok(()));
        });
        active += 1;
    }
    drop(tx);
    while active > 0 {
        match rx.recv() {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                first_error.get_or_insert(error);
            }
            Err(_) => break,
        }
        active -= 1;
    }
    if let Some(error) = first_error {
        return Err(error);
    }
    list_output_upload_records(job_id)
}

pub fn test_storage_target(name: &str, target: &StorageTargetConfig) -> StorageTestResult {
    let started = SystemTime::now();
    let target_type = storage_target_type(target).to_string();
    let mut result = match target {
        StorageTargetConfig::Local { directory, .. } => {
            let check = fs::create_dir_all(directory).and_then(|_| {
                let path = directory.join(".gpt-image-2-storage-test");
                fs::write(&path, b"ok")?;
                let _ = fs::remove_file(&path);
                Ok(())
            });
            match check {
                Ok(()) => StorageTestResult {
                    ok: true,
                    target: name.to_string(),
                    target_type,
                    message: "本地目录可写。".to_string(),
                    latency_ms: None,
                    detail: Some(json!({"directory": directory.display().to_string()})),
                    unsupported: false,
                    local_only: true,
                },
                Err(error) => StorageTestResult {
                    ok: false,
                    target: name.to_string(),
                    target_type,
                    message: format!("本地目录不可写：{error}"),
                    latency_ms: None,
                    detail: Some(json!({"directory": directory.display().to_string()})),
                    unsupported: false,
                    local_only: true,
                },
            }
        }
        StorageTargetConfig::Http { url, headers, .. } => {
            let check = validate_remote_http_target(url, "HTTP storage").and_then(
                |(_, host_label, addrs)| {
                    let client = pinned_http_client(
                        &host_label,
                        &addrs,
                        Duration::from_secs(10),
                        "storage_http_client_failed",
                        "Unable to build HTTP storage client.",
                    )?;
                    let mut request = client.head(url);
                    request = request.headers(resolve_storage_headers(headers)?);
                    request.send().map_err(|error| {
                        AppError::new("storage_http_request_failed", "HTTP storage test failed.")
                            .with_detail(json!({
                                "url": redact_url_for_log(url),
                                "error": error.to_string(),
                            }))
                    })
                },
            );
            match check {
                Ok(response) => StorageTestResult {
                    ok: response.status().is_success() || response.status().as_u16() == 405,
                    target: name.to_string(),
                    target_type,
                    message: format!("HTTP 目标可达：{}", response.status()),
                    latency_ms: None,
                    detail: Some(json!({"status": response.status().as_u16()})),
                    unsupported: false,
                    local_only: false,
                },
                Err(error) => {
                    let message = error.message.clone();
                    StorageTestResult {
                        ok: false,
                        target: name.to_string(),
                        target_type,
                        message: format!("HTTP 目标不可达：{message}"),
                        latency_ms: None,
                        detail: Some(json!({"error": storage_error_message(error)})),
                        unsupported: false,
                        local_only: false,
                    }
                }
            }
        }
        StorageTargetConfig::WebDav {
            url,
            username,
            password,
            ..
        } => {
            let check = validate_remote_http_target(url, "WebDAV storage").and_then(
                |(_, host_label, addrs)| {
                    let client = pinned_http_client(
                        &host_label,
                        &addrs,
                        Duration::from_secs(10),
                        "storage_webdav_client_failed",
                        "Unable to build WebDAV client.",
                    )?;
                    let mut request =
                        client.request(reqwest::Method::from_bytes(b"PROPFIND").unwrap(), url);
                    request = request.header("Depth", "0");
                    if let Some(username) =
                        username.as_deref().filter(|value| !value.trim().is_empty())
                    {
                        let password = password
                            .as_ref()
                            .map(resolve_credential)
                            .transpose()?
                            .map(|(value, _)| value)
                            .unwrap_or_default();
                        request = request.basic_auth(username.to_string(), Some(password));
                    }
                    request.send().map_err(|error| {
                        AppError::new(
                            "storage_webdav_request_failed",
                            "WebDAV storage test failed.",
                        )
                        .with_detail(json!({
                            "url": redact_url_for_log(url),
                            "error": error.to_string(),
                        }))
                    })
                },
            );
            match check {
                Ok(response) => StorageTestResult {
                    ok: response.status().is_success()
                        || matches!(response.status().as_u16(), 207 | 405),
                    target: name.to_string(),
                    target_type,
                    message: format!("WebDAV 目标可达：{}", response.status()),
                    latency_ms: None,
                    detail: Some(json!({"status": response.status().as_u16()})),
                    unsupported: false,
                    local_only: false,
                },
                Err(error) => {
                    let message = error.message.clone();
                    StorageTestResult {
                        ok: false,
                        target: name.to_string(),
                        target_type,
                        message: format!("WebDAV 目标不可达：{message}"),
                        latency_ms: None,
                        detail: Some(json!({"error": storage_error_message(error)})),
                        unsupported: false,
                        local_only: false,
                    }
                }
            }
        }
        StorageTargetConfig::Sftp {
            host,
            port,
            host_key_sha256,
            username,
            password,
            private_key,
            remote_dir,
            ..
        } => {
            let check = connect_sftp_session(host, *port, host_key_sha256.as_deref()).and_then(
                |(session, fingerprint)| {
                    authenticate_sftp_session(
                        &session,
                        host,
                        username,
                        password.as_ref(),
                        private_key.as_ref(),
                    )?;
                    let sftp = session.sftp().map_err(|error| {
                        AppError::new("storage_sftp_open_failed", "Unable to open SFTP subsystem.")
                            .with_detail(json!({"error": error.to_string()}))
                    })?;
                    sftp.stat(Path::new(remote_dir)).map_err(|error| {
                        AppError::new(
                            "storage_sftp_remote_dir_failed",
                            "Unable to access SFTP remote directory.",
                        )
                        .with_detail(json!({
                            "remote_dir": remote_dir,
                            "error": error.to_string(),
                        }))
                    })?;
                    Ok(fingerprint)
                },
            );
            match check {
                Ok(fingerprint) => StorageTestResult {
                    ok: true,
                    target: name.to_string(),
                    target_type,
                    message: "SFTP 认证与目录访问正常。".to_string(),
                    latency_ms: None,
                    detail: Some(json!({
                        "host": host,
                        "port": port,
                        "host_key_sha256": fingerprint,
                    })),
                    unsupported: false,
                    local_only: false,
                },
                Err(error) => StorageTestResult {
                    ok: false,
                    target: name.to_string(),
                    target_type,
                    message: format!("SFTP 目标不可用：{}", error.message),
                    latency_ms: None,
                    detail: Some(json!({
                        "host": host,
                        "port": port,
                        "error": storage_error_message(error),
                    })),
                    unsupported: false,
                    local_only: false,
                },
            }
        }
        StorageTargetConfig::S3 {
            bucket,
            region,
            endpoint,
            access_key_id,
            secret_access_key,
            ..
        } => {
            let access_key_ready =
                storage_credential_present_and_resolvable(access_key_id.as_ref()).is_ok();
            let secret_key_ready =
                storage_credential_present_and_resolvable(secret_access_key.as_ref()).is_ok();
            let credential_ready = access_key_ready && secret_key_ready;
            let endpoint_url = s3_endpoint_and_host(
                bucket,
                region.as_deref(),
                endpoint.as_deref(),
                ".gpt-image-2-storage-test",
            );
            let endpoint_ready = endpoint_url
                .as_ref()
                .map(|(url, _, _)| validate_remote_http_target(url, "S3 storage").is_ok())
                .unwrap_or(false);
            StorageTestResult {
                ok: credential_ready && endpoint_ready,
                target: name.to_string(),
                target_type,
                message: if credential_ready && endpoint_ready {
                    "S3 配置可用于上传。".to_string()
                } else if !credential_ready {
                    "S3 access key / secret key 不可用。".to_string()
                } else {
                    "S3 endpoint 配置无效。".to_string()
                },
                latency_ms: None,
                detail: Some(json!({
                    "bucket": bucket,
                    "region": region,
                    "access_key_ready": access_key_ready,
                    "secret_key_ready": secret_key_ready,
                    "endpoint_ready": endpoint_ready,
                })),
                unsupported: false,
                local_only: false,
            }
        }
    };
    result.latency_ms = Some(started.elapsed().unwrap_or_default().as_millis());
    result
}
