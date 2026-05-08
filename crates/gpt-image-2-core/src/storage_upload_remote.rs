#![allow(unused_imports)]

use super::*;

pub(crate) fn upload_to_webdav(
    url: &str,
    username: Option<&str>,
    password: Option<&CredentialRef>,
    public_base_url: Option<&str>,
    job_id: &str,
    output: &UploadOutput,
) -> Result<StorageUploadOutcome, AppError> {
    let (_, host_label, addrs) = validate_remote_http_target(url, "WebDAV storage")?;
    if !output.path.is_file() {
        return Err(AppError::new(
            "storage_source_missing",
            "Generated output file is missing.",
        )
        .with_detail(json!({"path": output.path.display().to_string()})));
    }
    let key = storage_object_key(job_id, output);
    let endpoint = join_storage_url(url, &key);
    let bytes = fs::read(&output.path).map_err(|error| {
        AppError::new("storage_read_failed", "Unable to read generated output.").with_detail(
            json!({"path": output.path.display().to_string(), "error": error.to_string()}),
        )
    })?;
    let client = pinned_http_client(
        &host_label,
        &addrs,
        Duration::from_secs(DEFAULT_REQUEST_TIMEOUT.min(120)),
        "storage_webdav_client_failed",
        "Unable to build WebDAV client.",
    )?;
    let resolved_password = if username.is_some_and(|value| !value.trim().is_empty()) {
        Some(
            password
                .map(resolve_credential)
                .transpose()?
                .map(|(value, _)| value)
                .unwrap_or_default(),
        )
    } else {
        None
    };
    let parent_keys = key
        .split('/')
        .scan(String::new(), |state, part| {
            if state.is_empty() {
                state.push_str(part);
            } else {
                state.push('/');
                state.push_str(part);
            }
            Some(state.clone())
        })
        .take_while(|value| value != &key)
        .collect::<Vec<_>>();
    for parent_key in parent_keys {
        let collection_url = join_storage_url(url, &parent_key);
        let mut request = client.request(
            reqwest::Method::from_bytes(b"MKCOL").unwrap(),
            &collection_url,
        );
        if let Some(username) = username.filter(|value| !value.trim().is_empty()) {
            request = request.basic_auth(username.to_string(), resolved_password.clone());
        }
        let response = request.send().map_err(|error| {
            AppError::new(
                "storage_webdav_mkcol_failed",
                "WebDAV collection creation failed.",
            )
            .with_detail(json!({
                "url": redact_url_for_log(&collection_url),
                "error": error.to_string(),
            }))
        })?;
        let status = response.status();
        if !(status.is_success() || matches!(status.as_u16(), 405 | 409)) {
            let body = response.text().unwrap_or_default();
            return Err(AppError::new(
                "storage_webdav_mkcol_failed",
                format!("WebDAV MKCOL returned {status}."),
            )
            .with_detail(json!({
                "url": redact_url_for_log(&collection_url),
                "body": sanitized_response_body(&body),
            })));
        }
    }
    let mut request = client
        .put(&endpoint)
        .header(
            CONTENT_TYPE,
            mime_guess::from_path(&output.path)
                .first_or_octet_stream()
                .as_ref(),
        )
        .body(bytes.clone());
    if let Some(username) = username.filter(|value| !value.trim().is_empty()) {
        request = request.basic_auth(username.to_string(), resolved_password);
    }
    let response = request.send().map_err(|error| {
        AppError::new(
            "storage_webdav_request_failed",
            "WebDAV storage upload failed.",
        )
        .with_detail(json!({
            "url": redact_url_for_log(&endpoint),
            "error": error.to_string(),
        }))
    })?;
    let status = response.status();
    let body = response.text().unwrap_or_default();
    if !status.is_success() {
        return Err(AppError::new(
            "storage_webdav_status_failed",
            format!("WebDAV storage upload returned {status}."),
        )
        .with_detail(json!({
            "url": redact_url_for_log(&endpoint),
            "body": sanitized_response_body(&body),
        })));
    }
    Ok(StorageUploadOutcome {
        url: http_url_if_safe(public_base_url.map(|base| join_storage_url(base, &key))),
        bytes: Some(bytes.len() as u64),
        metadata: json!({
            "key": key,
            "webdav_url": redact_url_for_log(&endpoint),
            "http_status": status.as_u16(),
        }),
    })
}

pub(crate) fn ensure_remote_dir(sftp: &ssh2::Sftp, remote_dir: &Path) {
    let mut current = PathBuf::new();
    for component in remote_dir.components() {
        current.push(component.as_os_str());
        if current.as_os_str().is_empty() {
            continue;
        }
        let _ = sftp.mkdir(&current, 0o755);
    }
}

pub(crate) fn sftp_expected_host_key(expected: Option<&str>) -> Result<&str, AppError> {
    expected
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::new(
                "storage_sftp_host_key_missing",
                "SFTP storage requires a SHA256 host key fingerprint.",
            )
        })
}

pub(crate) fn strip_sha256_prefix(value: &str) -> &str {
    if value.len() >= 7 && value[..7].eq_ignore_ascii_case("SHA256:") {
        &value[7..]
    } else {
        value
    }
}

pub(crate) fn sftp_host_key_matches(expected: &str, actual_hex: &str, actual_base64: &str) -> bool {
    let expected = strip_sha256_prefix(expected.trim());
    let compact_expected = expected.replace(':', "");
    compact_expected.eq_ignore_ascii_case(actual_hex)
        || expected == actual_base64
        || expected.trim_end_matches('=') == actual_base64.trim_end_matches('=')
}

pub(crate) fn verify_sftp_host_key(
    session: &Session,
    expected: Option<&str>,
) -> Result<String, AppError> {
    let expected = sftp_expected_host_key(expected)?;
    let (host_key, _) = session.host_key().ok_or_else(|| {
        AppError::new(
            "storage_sftp_host_key_unavailable",
            "SFTP server did not provide a host key.",
        )
    })?;
    let digest = Sha256::digest(host_key);
    let actual_hex = hex_lower(&digest);
    let actual_base64 = STANDARD.encode(digest);
    if !sftp_host_key_matches(expected, &actual_hex, &actual_base64) {
        return Err(AppError::new(
            "storage_sftp_host_key_mismatch",
            "SFTP host key fingerprint does not match.",
        )
        .with_detail(json!({
            "expected": expected,
            "actual": format!("SHA256:{}", actual_base64.trim_end_matches('=')),
        })));
    }
    Ok(format!("SHA256:{}", actual_base64.trim_end_matches('=')))
}

pub(crate) fn connect_sftp_session(
    host: &str,
    port: u16,
    host_key_sha256: Option<&str>,
) -> Result<(Session, String), AppError> {
    sftp_expected_host_key(host_key_sha256)?;
    let addrs = validate_remote_tcp_target(host, port, "SFTP storage")?;
    let tcp = TcpStream::connect(addrs.as_slice()).map_err(|error| {
        AppError::new(
            "storage_sftp_connect_failed",
            "Unable to connect to SFTP server.",
        )
        .with_detail(json!({"host": host, "port": port, "error": error.to_string()}))
    })?;
    let mut session = Session::new().map_err(|error| {
        AppError::new(
            "storage_sftp_session_failed",
            "Unable to create SFTP session.",
        )
        .with_detail(json!({"error": error.to_string()}))
    })?;
    session.set_tcp_stream(tcp);
    session.handshake().map_err(|error| {
        AppError::new("storage_sftp_handshake_failed", "SFTP handshake failed.")
            .with_detail(json!({"host": host, "error": error.to_string()}))
    })?;
    let host_key_fingerprint = verify_sftp_host_key(&session, host_key_sha256)?;
    Ok((session, host_key_fingerprint))
}

pub(crate) fn authenticate_sftp_session(
    session: &Session,
    host: &str,
    username: &str,
    password: Option<&CredentialRef>,
    private_key: Option<&CredentialRef>,
) -> Result<(), AppError> {
    if let Some(private_key) = private_key {
        let (private_key, _) = resolve_credential(private_key)?;
        let passphrase = password
            .map(resolve_credential)
            .transpose()?
            .map(|(value, _)| value);
        session
            .userauth_pubkey_memory(username, None, &private_key, passphrase.as_deref())
            .map_err(|error| {
                AppError::new("storage_sftp_auth_failed", "SFTP private-key auth failed.")
                    .with_detail(
                        json!({"host": host, "username": username, "error": error.to_string()}),
                    )
            })?;
    } else if let Some(password) = password {
        let (password, _) = resolve_credential(password)?;
        session
            .userauth_password(username, &password)
            .map_err(|error| {
                AppError::new("storage_sftp_auth_failed", "SFTP password auth failed.").with_detail(
                    json!({"host": host, "username": username, "error": error.to_string()}),
                )
            })?;
    } else {
        return Err(AppError::new(
            "storage_sftp_auth_missing",
            "SFTP storage requires a password or private key.",
        ));
    }
    if !session.authenticated() {
        return Err(AppError::new(
            "storage_sftp_auth_failed",
            "SFTP authentication failed.",
        ));
    }
    Ok(())
}

pub(crate) fn upload_to_sftp(
    host: &str,
    port: u16,
    host_key_sha256: Option<&str>,
    username: &str,
    password: Option<&CredentialRef>,
    private_key: Option<&CredentialRef>,
    remote_dir: &str,
    public_base_url: Option<&str>,
    job_id: &str,
    output: &UploadOutput,
) -> Result<StorageUploadOutcome, AppError> {
    if !output.path.is_file() {
        return Err(AppError::new(
            "storage_source_missing",
            "Generated output file is missing.",
        )
        .with_detail(json!({"path": output.path.display().to_string()})));
    }
    let (session, host_key_fingerprint) = connect_sftp_session(host, port, host_key_sha256)?;
    authenticate_sftp_session(&session, host, username, password, private_key)?;
    let sftp = session.sftp().map_err(|error| {
        AppError::new("storage_sftp_open_failed", "Unable to open SFTP subsystem.")
            .with_detail(json!({"error": error.to_string()}))
    })?;
    let key = storage_object_key(job_id, output);
    let remote_base = PathBuf::from(remote_dir);
    let destination = remote_base.join(&key);
    if let Some(parent) = destination.parent() {
        ensure_remote_dir(&sftp, parent);
    }
    let bytes = fs::read(&output.path).map_err(|error| {
        AppError::new("storage_read_failed", "Unable to read generated output.").with_detail(
            json!({"path": output.path.display().to_string(), "error": error.to_string()}),
        )
    })?;
    let mut remote = sftp.create(&destination).map_err(|error| {
        AppError::new(
            "storage_sftp_create_failed",
            "Unable to create remote SFTP file.",
        )
        .with_detail(json!({"path": destination.display().to_string(), "error": error.to_string()}))
    })?;
    remote.write_all(&bytes).map_err(|error| {
        AppError::new(
            "storage_sftp_write_failed",
            "Unable to write remote SFTP file.",
        )
        .with_detail(json!({"path": destination.display().to_string(), "error": error.to_string()}))
    })?;
    Ok(StorageUploadOutcome {
        url: http_url_if_safe(public_base_url.map(|base| join_storage_url(base, &key))),
        bytes: Some(bytes.len() as u64),
        metadata: json!({
            "key": key,
            "remote_path": destination.display().to_string(),
            "host_key_sha256": host_key_fingerprint,
        }),
    })
}
