use std::fs;
use std::time::Duration;

use reqwest::header::CONTENT_TYPE;
use serde_json::json;

use super::super::util::*;
use crate::{
    AppError, CredentialRef, DEFAULT_REQUEST_TIMEOUT, resolve_credential,
    validate_remote_http_target,
};

pub(super) fn upload_to_webdav(
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
                "error": sanitized_request_error(&error),
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
            "error": sanitized_request_error(&error),
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
