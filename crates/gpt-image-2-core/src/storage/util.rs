use std::collections::BTreeMap;
use std::fs;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use hmac::{Hmac, Mac};
use md5::Md5;
use reqwest::StatusCode;
use reqwest::blocking::{Client, Response};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use url::Url;

use crate::{
    AppError, CredentialRef, DEFAULT_REQUEST_TIMEOUT, build_user_agent, resolve_credential,
};

use super::{StorageConfig, StorageTargetConfig, StorageUploadOverrides};

pub(crate) const BAIDU_NETDISK_CHUNK_SIZE: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone)]
pub(super) struct UploadOutput {
    pub(super) index: usize,
    pub(super) path: PathBuf,
    pub(super) bytes: u64,
}

#[derive(Debug, Clone)]
pub(super) struct StorageUploadOutcome {
    pub(super) url: Option<String>,
    pub(super) bytes: Option<u64>,
    pub(super) metadata: Value,
}

pub(super) fn storage_target_type(target: &StorageTargetConfig) -> &'static str {
    match target {
        StorageTargetConfig::Local { .. } => "local",
        StorageTargetConfig::S3 { .. } => "s3",
        StorageTargetConfig::WebDav { .. } => "webdav",
        StorageTargetConfig::Http { .. } => "http",
        StorageTargetConfig::Sftp { .. } => "sftp",
        StorageTargetConfig::BaiduNetdisk { .. } => "baidu_netdisk",
        StorageTargetConfig::Pan123Open { .. } => "pan123_open",
    }
}

pub(super) fn upload_now() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
}

fn parse_output_index(value: &Value, fallback: usize) -> usize {
    value
        .get("index")
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .unwrap_or(fallback)
}

pub(super) fn upload_outputs_from_job(job: &Value) -> Vec<UploadOutput> {
    job.get("outputs")
        .and_then(Value::as_array)
        .map(|outputs| {
            outputs
                .iter()
                .enumerate()
                .filter_map(|(fallback, output)| {
                    let path = output.get("path").and_then(Value::as_str)?;
                    let bytes = output.get("bytes").and_then(Value::as_u64).unwrap_or(0);
                    Some(UploadOutput {
                        index: parse_output_index(output, fallback),
                        path: PathBuf::from(path),
                        bytes,
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn path_safe_token(value: &str, fallback: &str) -> String {
    let token = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    if token.is_empty() {
        fallback.to_string()
    } else {
        token
    }
}

pub(super) fn output_file_name(output: &UploadOutput) -> String {
    output
        .path
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| path_safe_token(name, "image.png"))
        .unwrap_or_else(|| "image.png".to_string())
}

pub(super) fn storage_object_key(job_id: &str, output: &UploadOutput) -> String {
    format!(
        "{}/{}-{}",
        path_safe_token(job_id, "job"),
        output.index + 1,
        output_file_name(output)
    )
}

pub(super) fn join_storage_url(base: &str, key: &str) -> String {
    format!(
        "{}/{}",
        base.trim_end_matches('/'),
        key.split('/')
            .map(|part| part.replace(' ', "%20"))
            .collect::<Vec<_>>()
            .join("/")
    )
}

pub(super) fn target_names_for_upload(
    config: &StorageConfig,
    overrides: &StorageUploadOverrides,
) -> (Vec<String>, Vec<String>) {
    let primary = overrides
        .targets
        .clone()
        .unwrap_or_else(|| config.default_targets.clone());
    let fallback = overrides
        .fallback_targets
        .clone()
        .unwrap_or_else(|| config.fallback_targets.clone());
    (
        primary
            .into_iter()
            .map(|name| name.trim().to_string())
            .filter(|name| !name.is_empty())
            .collect(),
        fallback
            .into_iter()
            .map(|name| name.trim().to_string())
            .filter(|name| !name.is_empty())
            .collect(),
    )
}

pub(super) fn resolve_storage_headers(
    headers: &BTreeMap<String, CredentialRef>,
) -> Result<HeaderMap, AppError> {
    let mut resolved = HeaderMap::new();
    for (name, credential) in headers {
        let header_name = HeaderName::from_bytes(name.as_bytes()).map_err(|error| {
            AppError::new(
                "storage_header_invalid",
                "Invalid HTTP storage header name.",
            )
            .with_detail(json!({"header": name, "error": error.to_string()}))
        })?;
        let (value, _) = resolve_credential(credential)?;
        let header_value = HeaderValue::from_str(&value).map_err(|error| {
            AppError::new(
                "storage_header_invalid",
                "Invalid HTTP storage header value.",
            )
            .with_detail(json!({"header": name, "error": error.to_string()}))
        })?;
        resolved.insert(header_name, header_value);
    }
    Ok(resolved)
}

pub(super) fn json_pointer_string(value: &Value, pointer: Option<&str>) -> Option<String> {
    let pointer = pointer?.trim();
    if pointer.is_empty() {
        return None;
    }
    value.pointer(pointer).and_then(|value| {
        value
            .as_str()
            .map(ToString::to_string)
            .or_else(|| value.as_object().map(|_| value.to_string()))
    })
}

pub(super) fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut value = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        value.push(HEX[(byte >> 4) as usize] as char);
        value.push(HEX[(byte & 0x0f) as usize] as char);
    }
    value
}

pub(super) fn sha256_hex(bytes: &[u8]) -> String {
    hex_lower(&Sha256::digest(bytes))
}

pub(crate) fn md5_hex(bytes: &[u8]) -> String {
    hex_lower(&Md5::digest(bytes))
}

pub(crate) fn baidu_netdisk_block_list(bytes: &[u8]) -> Vec<String> {
    if bytes.is_empty() {
        return vec![md5_hex(bytes)];
    }
    bytes
        .chunks(BAIDU_NETDISK_CHUNK_SIZE)
        .map(md5_hex)
        .collect()
}

pub(super) fn baidu_netdisk_chunk_count(bytes: &[u8]) -> usize {
    if bytes.is_empty() {
        1
    } else {
        bytes.len().div_ceil(BAIDU_NETDISK_CHUNK_SIZE)
    }
}

pub(super) fn baidu_netdisk_chunk(bytes: &[u8], index: usize) -> &[u8] {
    let start = (index * BAIDU_NETDISK_CHUNK_SIZE).min(bytes.len());
    let end = ((index + 1) * BAIDU_NETDISK_CHUNK_SIZE).min(bytes.len());
    &bytes[start..end]
}

pub(super) fn hmac_sha256(key: &[u8], data: &str) -> Result<Vec<u8>, AppError> {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).map_err(|error| {
        AppError::new(
            "storage_s3_signing_failed",
            "Unable to initialize S3 signer.",
        )
        .with_detail(json!({"error": error.to_string()}))
    })?;
    mac.update(data.as_bytes());
    Ok(mac.finalize().into_bytes().to_vec())
}

pub(super) fn pinned_http_client(
    host_label: &str,
    addrs: &[SocketAddr],
    timeout: Duration,
    error_code: &'static str,
    error_message: &'static str,
) -> Result<Client, AppError> {
    Client::builder()
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::none())
        .resolve_to_addrs(host_label, addrs)
        .user_agent(build_user_agent())
        .build()
        .map_err(|error| {
            AppError::new(error_code, error_message)
                .with_detail(json!({"error": error.to_string()}))
        })
}

pub(super) fn s3_encode_key_segment(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                vec![byte as char]
            }
            other => format!("%{other:02X}").chars().collect(),
        })
        .collect()
}

pub(super) fn s3_canonical_uri(key: &str) -> String {
    format!(
        "/{}",
        key.split('/')
            .map(s3_encode_key_segment)
            .collect::<Vec<_>>()
            .join("/")
    )
}

pub(super) fn s3_host_header(url: &Url) -> Result<String, AppError> {
    let host = url
        .host_str()
        .ok_or_else(|| AppError::new("storage_s3_url_invalid", "S3 endpoint host is missing."))?;
    Ok(match url.port() {
        Some(port) => format!("{host}:{port}"),
        None => host.to_string(),
    })
}

pub(crate) fn redact_url_for_log(url: &str) -> String {
    let Ok(mut parsed) = Url::parse(url) else {
        return url.chars().take(256).collect();
    };
    let _ = parsed.set_username("");
    let _ = parsed.set_password(None);
    parsed.set_query(None);
    parsed.set_fragment(None);
    parsed.to_string()
}

fn next_url_start(value: &str) -> Option<usize> {
    match (value.find("https://"), value.find("http://")) {
        (Some(https), Some(http)) => Some(https.min(http)),
        (Some(https), None) => Some(https),
        (None, Some(http)) => Some(http),
        (None, None) => None,
    }
}

fn url_end_offset(value: &str) -> usize {
    value
        .char_indices()
        .find(|(_, ch)| {
            ch.is_whitespace() || matches!(ch, ')' | '"' | '\'' | '<' | '>' | ']' | '}')
        })
        .map(|(index, _)| index)
        .unwrap_or(value.len())
}

pub(crate) fn sanitize_storage_error_message(message: impl AsRef<str>) -> String {
    let message = message.as_ref();
    let mut output = String::with_capacity(message.len());
    let mut offset = 0;

    while let Some(relative_start) = next_url_start(&message[offset..]) {
        let start = offset + relative_start;
        output.push_str(&message[offset..start]);
        let end = start + url_end_offset(&message[start..]);
        output.push_str(&redact_url_for_log(&message[start..end]));
        offset = end;
    }

    output.push_str(&message[offset..]);
    response_body_snippet(&output)
}

pub(super) fn sanitized_request_error(error: &reqwest::Error) -> String {
    sanitize_storage_error_message(error.to_string())
}

pub(super) fn response_body_snippet(body: &str) -> String {
    const MAX_LEN: usize = 2048;
    let mut snippet = body
        .chars()
        .map(|ch| {
            if ch.is_control() && ch != '\n' && ch != '\r' && ch != '\t' {
                ' '
            } else {
                ch
            }
        })
        .take(MAX_LEN + 1)
        .collect::<String>();
    if snippet.chars().count() > MAX_LEN {
        snippet = snippet.chars().take(MAX_LEN).collect::<String>();
        snippet.push_str("...");
    }
    snippet
}

fn is_sensitive_response_key(key: &str) -> bool {
    let lowered = key.to_ascii_lowercase();
    [
        "access_token",
        "refresh_token",
        "id_token",
        "authorization",
        "api_key",
        "token",
        "secret",
        "password",
        "signature",
        "credential",
        "set-cookie",
        "cookie",
        "url",
    ]
    .iter()
    .any(|needle| lowered.contains(needle))
}

pub(super) fn redact_storage_response_value(key: Option<&str>, value: &Value) -> Value {
    if key.is_some_and(is_sensitive_response_key) {
        return json!({"_omitted": "secret"});
    }
    match value {
        Value::Object(object) => Value::Object(
            object
                .iter()
                .map(|(key, child)| (key.clone(), redact_storage_response_value(Some(key), child)))
                .collect(),
        ),
        Value::Array(items) => Value::Array(
            items
                .iter()
                .take(20)
                .map(|item| redact_storage_response_value(None, item))
                .collect(),
        ),
        Value::String(text) if text.len() > 256 => json!(response_body_snippet(text)),
        _ => value.clone(),
    }
}

pub(super) fn sanitized_response_body(body: &str) -> Value {
    match serde_json::from_str::<Value>(body) {
        Ok(value) => redact_storage_response_value(None, &value),
        Err(_) => json!(response_body_snippet(body)),
    }
}

pub(super) fn http_url_if_safe(url: Option<String>) -> Option<String> {
    let url = url?;
    let parsed = Url::parse(&url).ok()?;
    match parsed.scheme() {
        "http" | "https" => Some(url),
        _ => None,
    }
}

pub(super) fn storage_error_message(error: AppError) -> String {
    if let Some(detail) = error.detail {
        format!("{}: {}", error.message, detail)
    } else {
        error.message
    }
}

pub(super) fn read_upload_bytes(output: &UploadOutput) -> Result<Vec<u8>, AppError> {
    if !output.path.is_file() {
        return Err(AppError::new(
            "storage_source_missing",
            "Generated output file is missing.",
        )
        .with_detail(json!({"path": output.path.display().to_string()})));
    }
    fs::read(&output.path).map_err(|error| {
        AppError::new("storage_read_failed", "Unable to read generated output.").with_detail(
            json!({"path": output.path.display().to_string(), "error": error.to_string()}),
        )
    })
}

pub(super) fn storage_response_json(
    response: Response,
    code: &'static str,
) -> Result<(StatusCode, Value), AppError> {
    let status = response.status();
    let body = response.text().unwrap_or_default();
    if !status.is_success() {
        return Err(
            AppError::new(code, format!("Storage API returned {status}."))
                .with_detail(json!({"body": sanitized_response_body(&body)})),
        );
    }
    let payload = serde_json::from_str::<Value>(&body).map_err(|error| {
        AppError::new(code, "Storage API returned invalid JSON.").with_detail(json!({
            "body": sanitized_response_body(&body),
            "error": error.to_string(),
        }))
    })?;
    Ok((status, payload))
}

pub(super) fn value_code_success(payload: &Value, ok_values: &[i64]) -> bool {
    payload
        .get("errno")
        .or_else(|| payload.get("code"))
        .and_then(Value::as_i64)
        .map(|code| ok_values.contains(&code))
        .unwrap_or(true)
}

pub(super) fn payload_data(payload: &Value) -> &Value {
    payload.get("data").unwrap_or(payload)
}

pub(super) fn required_json_string(
    payload: &Value,
    path: &str,
    error_code: &'static str,
) -> Result<String, AppError> {
    payload
        .pointer(path)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| {
            AppError::new(error_code, "Storage API response missed a required field.").with_detail(
                json!({"path": path, "body": redact_storage_response_value(None, payload)}),
            )
        })
}

pub(super) fn optional_json_string(payload: &Value, paths: &[&str]) -> Option<String> {
    paths.iter().find_map(|path| {
        payload
            .pointer(path)
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(ToString::to_string)
    })
}

pub(super) fn optional_json_u64(payload: &Value, paths: &[&str]) -> Option<u64> {
    paths.iter().find_map(|path| {
        payload.pointer(path).and_then(|value| {
            value
                .as_u64()
                .or_else(|| value.as_str().and_then(|text| text.parse::<u64>().ok()))
        })
    })
}

pub(super) fn resolve_required_credential(
    credential: Option<&CredentialRef>,
    code: &'static str,
    message: &'static str,
) -> Result<String, AppError> {
    credential
        .ok_or_else(|| AppError::new(code, message))
        .and_then(resolve_credential)
        .map(|(value, _)| value)
}

pub(super) fn credential_resolves_non_empty(credential: &CredentialRef) -> bool {
    resolve_credential(credential)
        .map(|(value, _)| !value.trim().is_empty())
        .unwrap_or(false)
}

pub(super) fn netdisk_http_client() -> Result<Client, AppError> {
    Client::builder()
        .timeout(Duration::from_secs(DEFAULT_REQUEST_TIMEOUT.min(120)))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(build_user_agent())
        .build()
        .map_err(|error| {
            AppError::new(
                "storage_netdisk_client_failed",
                "Unable to build netdisk client.",
            )
            .with_detail(json!({"error": error.to_string()}))
        })
}
