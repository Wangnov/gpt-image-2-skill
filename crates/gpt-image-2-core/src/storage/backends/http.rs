use std::collections::BTreeMap;
use std::fs;
use std::time::Duration;

use reqwest::blocking::multipart::{Form, Part};
use serde_json::{Value, json};

use super::super::util::*;
use crate::{AppError, CredentialRef, DEFAULT_REQUEST_TIMEOUT, validate_remote_http_target};

pub(super) fn upload_to_http(
    url: &str,
    method: &str,
    headers: &BTreeMap<String, CredentialRef>,
    public_url_json_pointer: Option<&str>,
    job_id: &str,
    output: &UploadOutput,
) -> Result<StorageUploadOutcome, AppError> {
    let (_, host_label, addrs) = validate_remote_http_target(url, "HTTP storage")?;
    if !output.path.is_file() {
        return Err(AppError::new(
            "storage_source_missing",
            "Generated output file is missing.",
        )
        .with_detail(json!({"path": output.path.display().to_string()})));
    }
    let bytes = fs::read(&output.path).map_err(|error| {
        AppError::new("storage_read_failed", "Unable to read generated output.").with_detail(
            json!({"path": output.path.display().to_string(), "error": error.to_string()}),
        )
    })?;
    let mime = mime_guess::from_path(&output.path).first_or_octet_stream();
    let file_name = output_file_name(output);
    let part = Part::bytes(bytes.clone())
        .file_name(file_name.clone())
        .mime_str(mime.as_ref())
        .map_err(|error| {
            AppError::new(
                "storage_http_multipart_failed",
                "Unable to build HTTP upload part.",
            )
            .with_detail(json!({"error": error.to_string()}))
        })?;
    let form = Form::new()
        .text("job_id", job_id.to_string())
        .text("output_index", output.index.to_string())
        .text("key", storage_object_key(job_id, output))
        .part("file", part);
    let client = pinned_http_client(
        &host_label,
        &addrs,
        Duration::from_secs(DEFAULT_REQUEST_TIMEOUT.min(120)),
        "storage_http_client_failed",
        "Unable to build HTTP storage client.",
    )?;
    let mut request = match method.to_ascii_uppercase().as_str() {
        "PUT" => client.put(url),
        "PATCH" => client.patch(url),
        "POST" | "" => client.post(url),
        other => {
            return Err(AppError::new(
                "storage_http_method_unsupported",
                format!("Unsupported HTTP storage method: {other}"),
            ));
        }
    };
    let resolved_headers = resolve_storage_headers(headers)?;
    request = request.headers(resolved_headers).multipart(form);
    let response = request.send().map_err(|error| {
        AppError::new("storage_http_request_failed", "HTTP storage upload failed.").with_detail(
            json!({
                "url": redact_url_for_log(url),
                "error": sanitized_request_error(&error),
            }),
        )
    })?;
    let status = response.status();
    let body = response.text().unwrap_or_default();
    if !status.is_success() {
        return Err(AppError::new(
            "storage_http_status_failed",
            format!("HTTP storage upload returned {status}."),
        )
        .with_detail(json!({
            "url": redact_url_for_log(url),
            "body": sanitized_response_body(&body),
        })));
    }
    let response_json = serde_json::from_str::<Value>(&body).unwrap_or(Value::Null);
    let extracted_url =
        http_url_if_safe(json_pointer_string(&response_json, public_url_json_pointer));
    Ok(StorageUploadOutcome {
        url: extracted_url,
        bytes: Some(bytes.len() as u64),
        metadata: json!({
            "http_status": status.as_u16(),
            "url_from_response": public_url_json_pointer
                .map(|_| json_pointer_string(&response_json, public_url_json_pointer).is_some())
                .unwrap_or(false),
        }),
    })
}
