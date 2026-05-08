#![allow(unused_imports)]

use super::*;

#[derive(Debug, Clone, Default)]
pub struct StorageUploadOverrides {
    pub targets: Option<Vec<String>>,
    pub fallback_targets: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageTestResult {
    pub ok: bool,
    pub target: String,
    pub target_type: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u128>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<Value>,
    #[serde(default)]
    pub unsupported: bool,
    #[serde(default)]
    pub local_only: bool,
}

#[derive(Debug, Clone)]
pub(crate) struct UploadOutput {
    pub(crate) index: usize,
    pub(crate) path: PathBuf,
    pub(crate) bytes: u64,
}

#[derive(Debug, Clone)]
pub(crate) struct StorageUploadOutcome {
    pub(crate) url: Option<String>,
    pub(crate) bytes: Option<u64>,
    pub(crate) metadata: Value,
}

pub(crate) fn storage_target_type(target: &StorageTargetConfig) -> &'static str {
    match target {
        StorageTargetConfig::Local { .. } => "local",
        StorageTargetConfig::S3 { .. } => "s3",
        StorageTargetConfig::WebDav { .. } => "webdav",
        StorageTargetConfig::Http { .. } => "http",
        StorageTargetConfig::Sftp { .. } => "sftp",
    }
}

pub(crate) fn upload_now() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
}

pub(crate) fn parse_output_index(value: &Value, fallback: usize) -> usize {
    value
        .get("index")
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .unwrap_or(fallback)
}

pub(crate) fn upload_outputs_from_job(job: &Value) -> Vec<UploadOutput> {
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

pub(crate) fn path_safe_token(value: &str, fallback: &str) -> String {
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

pub(crate) fn output_file_name(output: &UploadOutput) -> String {
    output
        .path
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| path_safe_token(name, "image.png"))
        .unwrap_or_else(|| "image.png".to_string())
}

pub(crate) fn storage_object_key(job_id: &str, output: &UploadOutput) -> String {
    format!(
        "{}/{}-{}",
        path_safe_token(job_id, "job"),
        output.index + 1,
        output_file_name(output)
    )
}

pub(crate) fn join_storage_url(base: &str, key: &str) -> String {
    format!(
        "{}/{}",
        base.trim_end_matches('/'),
        key.split('/')
            .map(|part| part.replace(' ', "%20"))
            .collect::<Vec<_>>()
            .join("/")
    )
}

pub(crate) fn target_names_for_upload(
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

pub(crate) fn resolve_storage_headers(
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

pub(crate) fn json_pointer_string(value: &Value, pointer: Option<&str>) -> Option<String> {
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

pub(crate) fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut value = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        value.push(HEX[(byte >> 4) as usize] as char);
        value.push(HEX[(byte & 0x0f) as usize] as char);
    }
    value
}

pub(crate) fn sha256_hex(bytes: &[u8]) -> String {
    hex_lower(&Sha256::digest(bytes))
}

pub(crate) fn hmac_sha256(key: &[u8], data: &str) -> Result<Vec<u8>, AppError> {
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

pub(crate) fn pinned_http_client(
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
        .build()
        .map_err(|error| {
            AppError::new(error_code, error_message)
                .with_detail(json!({"error": error.to_string()}))
        })
}

pub(crate) fn s3_encode_key_segment(value: &str) -> String {
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

pub(crate) fn s3_canonical_uri(key: &str) -> String {
    format!(
        "/{}",
        key.split('/')
            .map(s3_encode_key_segment)
            .collect::<Vec<_>>()
            .join("/")
    )
}

pub(crate) fn s3_host_header(url: &Url) -> Result<String, AppError> {
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

pub(crate) fn response_body_snippet(body: &str) -> String {
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

pub(crate) fn is_sensitive_response_key(key: &str) -> bool {
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

pub(crate) fn redact_storage_response_value(key: Option<&str>, value: &Value) -> Value {
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

pub(crate) fn sanitized_response_body(body: &str) -> Value {
    match serde_json::from_str::<Value>(body) {
        Ok(value) => redact_storage_response_value(None, &value),
        Err(_) => json!(response_body_snippet(body)),
    }
}

pub(crate) fn http_url_if_safe(url: Option<String>) -> Option<String> {
    let url = url?;
    let parsed = Url::parse(&url).ok()?;
    match parsed.scheme() {
        "http" | "https" => Some(url),
        _ => None,
    }
}

pub(crate) fn storage_error_message(error: AppError) -> String {
    if let Some(detail) = error.detail {
        format!("{}: {}", error.message, detail)
    } else {
        error.message
    }
}
