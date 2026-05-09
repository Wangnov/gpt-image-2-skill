use std::time::Duration;

use reqwest::blocking::Client;
use reqwest::blocking::multipart::{Form, Part};
use serde_json::{Value, json};
use url::Url;

use super::super::types::{
    Pan123OpenAuthMode, StorageTargetConfig, effective_pan123_open_auth_mode,
};
use super::super::util::*;
use crate::{AppError, CredentialRef, DEFAULT_REQUEST_TIMEOUT, validate_remote_http_target};

pub(crate) const PAN123_OPEN_TOKEN_ENDPOINT: &str =
    "https://open-api.123pan.com/api/v1/access_token";
const PAN123_OPEN_UPLOAD_CREATE_ENDPOINT: &str =
    "https://open-api.123pan.com/upload/v2/file/create";
const PAN123_OPEN_UPLOAD_COMPLETE_ENDPOINT: &str =
    "https://open-api.123pan.com/upload/v2/file/upload_complete";
const PAN123_OPEN_UPLOAD_ASYNC_RESULT_ENDPOINT: &str =
    "https://open-api.123pan.com/upload/v2/file/upload_async_result";
const PAN123_OPEN_DIRECT_LINK_ENDPOINT: &str = "https://open-api.123pan.com/api/v1/direct-link/url";

fn pan123_access_token(
    client: &Client,
    auth_mode: Pan123OpenAuthMode,
    client_id: &str,
    client_secret: Option<&CredentialRef>,
    access_token: Option<&CredentialRef>,
) -> Result<String, AppError> {
    match auth_mode {
        Pan123OpenAuthMode::AccessToken => resolve_required_credential(
            access_token,
            "storage_pan123_credentials_missing",
            "123 Netdisk access token is missing.",
        ),
        Pan123OpenAuthMode::Client => {
            if client_id.trim().is_empty() {
                return Err(AppError::new(
                    "storage_pan123_credentials_missing",
                    "123 Netdisk client id is missing.",
                ));
            }
            let client_secret = resolve_required_credential(
                client_secret,
                "storage_pan123_credentials_missing",
                "123 Netdisk client secret is missing.",
            )?;
            let response = client
                .post(PAN123_OPEN_TOKEN_ENDPOINT)
                .json(&json!({
                    "clientID": client_id,
                    "clientSecret": client_secret,
                }))
                .send()
                .map_err(|error| {
                    AppError::new(
                        "storage_pan123_token_failed",
                        "123 Netdisk token request failed.",
                    )
                    .with_detail(json!({"error": sanitized_request_error(&error)}))
                })?;
            let (_, payload) = storage_response_json(response, "storage_pan123_token_failed")?;
            if !value_code_success(&payload, &[0, 200]) {
                return Err(AppError::new(
                    "storage_pan123_token_failed",
                    "123 Netdisk token request returned an error.",
                )
                .with_detail(redact_storage_response_value(None, &payload)));
            }
            required_json_string(
                payload_data(&payload),
                "/accessToken",
                "storage_pan123_token_failed",
            )
        }
    }
}

fn pan123_json_ok(payload: &Value) -> bool {
    value_code_success(payload, &[0, 200])
}

fn pan123_file_id(payload: &Value) -> Option<u64> {
    optional_json_u64(
        payload,
        &[
            "/fileID",
            "/fileId",
            "/file_id",
            "/FileID",
            "/info/fileID",
            "/info/fileId",
            "/fileList/0/fileID",
            "/fileList/0/fileId",
        ],
    )
}

fn pan123_upload_id(payload: &Value) -> Result<String, AppError> {
    optional_json_string(
        payload,
        &[
            "/preuploadID",
            "/preuploadId",
            "/preUploadID",
            "/preUploadId",
            "/uploadID",
            "/uploadId",
        ],
    )
    .ok_or_else(|| {
        AppError::new(
            "storage_pan123_precreate_failed",
            "123 Netdisk upload precreate response missed upload id.",
        )
        .with_detail(redact_storage_response_value(None, payload))
    })
}

fn pan123_slice_size(payload: &Value, total: usize) -> usize {
    optional_json_u64(
        payload,
        &[
            "/sliceSize",
            "/slice_size",
            "/partSize",
            "/part_size",
            "/sliceSizeInBytes",
        ],
    )
    .and_then(|value| usize::try_from(value).ok())
    .filter(|value| *value > 0)
    .unwrap_or(total.max(1))
}

fn pan123_reuse_flag(payload: &Value) -> bool {
    payload
        .get("reuse")
        .or_else(|| payload.get("reuseFlag"))
        .or_else(|| payload.get("isReuse"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn pan123_single_file_flag(payload: &Value) -> bool {
    payload
        .get("singleFileUpload")
        .or_else(|| payload.get("single_file_upload"))
        .or_else(|| payload.get("singleFile"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn pan123_upload_domain(payload: &Value) -> Result<String, AppError> {
    optional_json_string(
        payload,
        &[
            "/uploadDomain",
            "/upload_domain",
            "/uploadHost",
            "/upload_host",
            "/domain",
        ],
    )
    .ok_or_else(|| {
        AppError::new(
            "storage_pan123_precreate_failed",
            "123 Netdisk upload precreate response missed upload domain.",
        )
        .with_detail(redact_storage_response_value(None, payload))
    })
}

pub(crate) fn pan123_upload_slice_url(upload_domain: &str) -> Result<String, AppError> {
    let base = upload_domain.trim().trim_end_matches('/');
    let url = if base.starts_with("http://") || base.starts_with("https://") {
        format!("{base}/upload/v2/file/slice")
    } else {
        format!("https://{base}/upload/v2/file/slice")
    };
    match Url::parse(&url).map(|parsed| parsed.scheme().to_string()) {
        Ok(scheme) if scheme == "http" || scheme == "https" => Ok(url),
        _ => Err(AppError::new(
            "storage_pan123_upload_failed",
            "123 Netdisk upload domain is not a valid HTTP URL.",
        )),
    }
}

pub(crate) fn pan123_upload_client(upload_url: &str) -> Result<Client, AppError> {
    let (_, host_label, addrs) = validate_remote_http_target(upload_url, "123 Netdisk upload")?;
    pinned_http_client(
        &host_label,
        &addrs,
        Duration::from_secs(DEFAULT_REQUEST_TIMEOUT.min(120)),
        "storage_pan123_client_failed",
        "Unable to build 123 Netdisk upload client.",
    )
}

fn pan123_upload_slice(
    token: &str,
    preupload_id: &str,
    upload_domain: &str,
    slice_no: usize,
    bytes: &[u8],
) -> Result<(), AppError> {
    let upload_url = pan123_upload_slice_url(upload_domain)?;
    let upload_client = pan123_upload_client(&upload_url)?;
    let slice_md5 = md5_hex(bytes);
    let file_name = format!("slice-{}", slice_no + 1);
    let part = Part::bytes(bytes.to_vec())
        .file_name(file_name)
        .mime_str("application/octet-stream")
        .map_err(|error| {
            AppError::new(
                "storage_pan123_upload_failed",
                "Unable to build 123 Netdisk upload part.",
            )
            .with_detail(json!({"error": error.to_string(), "slice_no": slice_no + 1}))
        })?;
    let slice_no_text = (slice_no + 1).to_string();
    let response = upload_client
        .post(upload_url)
        .bearer_auth(token)
        .query(&[
            ("preuploadID", preupload_id),
            ("sliceNo", slice_no_text.as_str()),
            ("sliceMD5", slice_md5.as_str()),
        ])
        .multipart(Form::new().part("slice", part))
        .send()
        .map_err(|error| {
            AppError::new(
                "storage_pan123_upload_failed",
                "123 Netdisk slice upload failed.",
            )
            .with_detail(
                json!({"error": sanitized_request_error(&error), "slice_no": slice_no + 1}),
            )
        })?;
    let (_, payload) = storage_response_json(response, "storage_pan123_upload_failed")?;
    if !pan123_json_ok(&payload) {
        return Err(AppError::new(
            "storage_pan123_upload_failed",
            "123 Netdisk slice upload returned an error.",
        )
        .with_detail(json!({
            "slice_no": slice_no + 1,
            "body": redact_storage_response_value(None, &payload),
        })));
    }
    Ok(())
}

fn pan123_direct_link(
    client: &Client,
    token: &str,
    file_id: u64,
) -> Result<Option<String>, AppError> {
    let response = client
        .get(PAN123_OPEN_DIRECT_LINK_ENDPOINT)
        .bearer_auth(token)
        .query(&[("fileID", file_id.to_string())])
        .send()
        .map_err(|error| {
            AppError::new(
                "storage_pan123_direct_link_failed",
                "123 Netdisk direct link request failed.",
            )
            .with_detail(json!({"error": sanitized_request_error(&error)}))
        })?;
    let (_, direct) = storage_response_json(response, "storage_pan123_direct_link_failed")?;
    if !pan123_json_ok(&direct) {
        return Err(AppError::new(
            "storage_pan123_direct_link_failed",
            "123 Netdisk direct link request returned an error.",
        )
        .with_detail(redact_storage_response_value(None, &direct)));
    }
    Ok(optional_json_string(
        payload_data(&direct),
        &[
            "/url",
            "/downloadUrl",
            "/downloadURL",
            "/directLink",
            "/directLinkURL",
        ],
    )
    .and_then(|url| http_url_if_safe(Some(url))))
}

fn pan123_try_direct_link(client: &Client, token: &str, file_id: Option<u64>) -> Option<String> {
    let file_id = file_id?;
    pan123_direct_link(client, token, file_id).ok().flatten()
}

#[cfg(test)]
pub(crate) fn pan123_file_name_from_key(key: &str, fallback: &str) -> String {
    key.rsplit('/')
        .next()
        .filter(|value| !value.trim().is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| fallback.to_string())
}

#[cfg(not(test))]
fn pan123_file_name_from_key(key: &str, fallback: &str) -> String {
    key.rsplit('/')
        .next()
        .filter(|value| !value.trim().is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| fallback.to_string())
}

fn pan123_complete_upload(
    client: &Client,
    token: &str,
    preupload_id: &str,
) -> Result<Value, AppError> {
    let response = client
        .post(PAN123_OPEN_UPLOAD_COMPLETE_ENDPOINT)
        .bearer_auth(token)
        .json(&json!({"preuploadID": preupload_id}))
        .send()
        .map_err(|error| {
            AppError::new(
                "storage_pan123_complete_failed",
                "123 Netdisk upload complete request failed.",
            )
            .with_detail(json!({"error": sanitized_request_error(&error)}))
        })?;
    let (_, completed) = storage_response_json(response, "storage_pan123_complete_failed")?;
    if !pan123_json_ok(&completed) {
        return Err(AppError::new(
            "storage_pan123_complete_failed",
            "123 Netdisk upload complete returned an error.",
        )
        .with_detail(redact_storage_response_value(None, &completed)));
    }
    Ok(completed)
}

fn pan123_async_upload_result(client: &Client, token: &str, preupload_id: &str) -> Option<Value> {
    let response = client
        .get(PAN123_OPEN_UPLOAD_ASYNC_RESULT_ENDPOINT)
        .bearer_auth(token)
        .query(&[("preuploadID", preupload_id)])
        .send()
        .ok()?;
    let (_, payload) =
        storage_response_json(response, "storage_pan123_async_result_failed").ok()?;
    Some(payload)
}

pub(super) fn upload_to_pan123_open(
    target: &StorageTargetConfig,
    job_id: &str,
    output: &UploadOutput,
) -> Result<StorageUploadOutcome, AppError> {
    let StorageTargetConfig::Pan123Open {
        auth_mode,
        client_id,
        client_secret,
        access_token,
        parent_id,
        use_direct_link,
    } = target
    else {
        return Err(AppError::new(
            "storage_target_type_mismatch",
            "Expected 123 Netdisk storage target.",
        ));
    };
    let bytes = read_upload_bytes(output)?;
    let client = netdisk_http_client()?;
    let auth_mode = effective_pan123_open_auth_mode(*auth_mode, access_token.as_ref());
    let token = pan123_access_token(
        &client,
        auth_mode,
        client_id,
        client_secret.as_ref(),
        access_token.as_ref(),
    )?;
    let key = storage_object_key(job_id, output);
    let file_name = pan123_file_name_from_key(&key, &output_file_name(output));
    let etag = md5_hex(&bytes);
    let response = client
        .post(PAN123_OPEN_UPLOAD_CREATE_ENDPOINT)
        .bearer_auth(&token)
        .json(&json!({
            "parentFileID": parent_id,
            "filename": file_name,
            "etag": etag,
            "size": bytes.len(),
            "duplicate": 1,
        }))
        .send()
        .map_err(|error| {
            AppError::new(
                "storage_pan123_precreate_failed",
                "123 Netdisk upload precreate failed.",
            )
            .with_detail(json!({"error": sanitized_request_error(&error)}))
        })?;
    let (_, precreate) = storage_response_json(response, "storage_pan123_precreate_failed")?;
    if !pan123_json_ok(&precreate) {
        return Err(AppError::new(
            "storage_pan123_precreate_failed",
            "123 Netdisk upload precreate returned an error.",
        )
        .with_detail(redact_storage_response_value(None, &precreate)));
    }
    let data = payload_data(&precreate);
    if pan123_reuse_flag(data) {
        let file_id = pan123_file_id(data);
        let public_url = if *use_direct_link {
            pan123_try_direct_link(&client, &token, file_id)
        } else {
            None
        };
        return Ok(StorageUploadOutcome {
            url: public_url,
            bytes: Some(bytes.len() as u64),
            metadata: json!({
                "key": key,
                "file_id": file_id,
                "etag": etag,
                "reused": true,
            }),
        });
    }
    let preupload_id = pan123_upload_id(data)?;
    let mut file_id = pan123_file_id(data);
    let single_file_upload = pan123_single_file_flag(data);
    let mut slice_count = 0usize;
    if !single_file_upload {
        let upload_domain = pan123_upload_domain(data)?;
        let slice_size = pan123_slice_size(data, bytes.len());
        for (slice_no, chunk) in bytes.chunks(slice_size).enumerate() {
            pan123_upload_slice(&token, &preupload_id, &upload_domain, slice_no, chunk)?;
            slice_count = slice_no + 1;
        }
    }
    let completed = pan123_complete_upload(&client, &token, &preupload_id)?;
    let completed_data = payload_data(&completed);
    file_id = file_id.or_else(|| pan123_file_id(completed_data));
    if file_id.is_none()
        && let Some(async_result) = pan123_async_upload_result(&client, &token, &preupload_id)
    {
        file_id = pan123_file_id(payload_data(&async_result));
    }
    let public_url = if *use_direct_link {
        pan123_try_direct_link(&client, &token, file_id)
    } else {
        None
    };
    Ok(StorageUploadOutcome {
        url: public_url,
        bytes: Some(bytes.len() as u64),
        metadata: json!({
            "key": key,
            "file_id": file_id,
            "preupload_id": preupload_id,
            "single_file_upload": single_file_upload,
            "slice_count": slice_count,
            "etag": etag,
        }),
    })
}
