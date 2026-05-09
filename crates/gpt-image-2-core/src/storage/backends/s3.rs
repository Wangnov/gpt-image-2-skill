use std::fs;
use std::time::Duration;

use chrono::Utc;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde_json::json;
use url::Url;

use super::super::types::StorageTargetConfig;
use super::super::util::*;
use crate::{AppError, DEFAULT_REQUEST_TIMEOUT, resolve_credential, validate_remote_http_target};

pub(crate) fn s3_endpoint_and_host(
    bucket: &str,
    region: Option<&str>,
    endpoint: Option<&str>,
    key: &str,
) -> Result<(String, String, String), AppError> {
    let canonical_uri = s3_canonical_uri(key);
    if let Some(endpoint) = endpoint.filter(|value| !value.trim().is_empty()) {
        let base = endpoint.trim_end_matches('/');
        let url = if base.contains("{bucket}") {
            format!("{}{}", base.replace("{bucket}", bucket), canonical_uri)
        } else {
            format!("{}/{bucket}{canonical_uri}", base)
        };
        let parsed = Url::parse(&url).map_err(|error| {
            AppError::new("storage_s3_url_invalid", "Invalid S3 endpoint URL.")
                .with_detail(json!({"url": redact_url_for_log(&url), "error": error.to_string()}))
        })?;
        let host = s3_host_header(&parsed)?;
        return Ok((url, host, parsed.path().to_string()));
    }
    let region = region
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("us-east-1");
    let host = if region == "us-east-1" {
        format!("{bucket}.s3.amazonaws.com")
    } else {
        format!("{bucket}.s3.{region}.amazonaws.com")
    };
    Ok((
        format!("https://{host}{canonical_uri}"),
        host,
        canonical_uri,
    ))
}

fn s3_signing_key(secret_access_key: &str, date: &str, region: &str) -> Result<Vec<u8>, AppError> {
    let date_key = hmac_sha256(format!("AWS4{secret_access_key}").as_bytes(), date)?;
    let region_key = hmac_sha256(&date_key, region)?;
    let service_key = hmac_sha256(&region_key, "s3")?;
    hmac_sha256(&service_key, "aws4_request")
}

pub(super) fn upload_to_s3(
    target: &StorageTargetConfig,
    job_id: &str,
    output: &UploadOutput,
) -> Result<StorageUploadOutcome, AppError> {
    let StorageTargetConfig::S3 {
        bucket,
        region,
        endpoint,
        prefix,
        access_key_id,
        secret_access_key,
        session_token,
        public_base_url,
    } = target
    else {
        return Err(AppError::new(
            "storage_target_type_mismatch",
            "Expected S3 storage target.",
        ));
    };
    if !output.path.is_file() {
        return Err(AppError::new(
            "storage_source_missing",
            "Generated output file is missing.",
        )
        .with_detail(json!({"path": output.path.display().to_string()})));
    }
    let (access_key_id, _) = access_key_id
        .as_ref()
        .ok_or_else(|| {
            AppError::new(
                "storage_s3_credentials_missing",
                "S3 access key is missing.",
            )
        })
        .and_then(resolve_credential)?;
    let (secret_access_key, _) = secret_access_key
        .as_ref()
        .ok_or_else(|| {
            AppError::new(
                "storage_s3_credentials_missing",
                "S3 secret key is missing.",
            )
        })
        .and_then(resolve_credential)?;
    let session_token = session_token
        .as_ref()
        .map(resolve_credential)
        .transpose()?
        .map(|(value, _)| value);
    let bytes = fs::read(&output.path).map_err(|error| {
        AppError::new("storage_read_failed", "Unable to read generated output.").with_detail(
            json!({"path": output.path.display().to_string(), "error": error.to_string()}),
        )
    })?;
    let prefix = prefix.as_deref().unwrap_or("").trim_matches('/');
    let raw_key = storage_object_key(job_id, output);
    let key = if prefix.is_empty() {
        raw_key
    } else {
        format!("{prefix}/{raw_key}")
    };
    let signing_region = region
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("us-east-1");
    let (url, host, canonical_uri) =
        s3_endpoint_and_host(bucket, Some(signing_region), endpoint.as_deref(), &key)?;
    let (_, host_label, addrs) = validate_remote_http_target(&url, "S3 storage")?;
    let now = Utc::now();
    let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();
    let short_date = now.format("%Y%m%d").to_string();
    let payload_hash = sha256_hex(&bytes);
    let content_type = mime_guess::from_path(&output.path)
        .first_or_octet_stream()
        .to_string();
    let mut canonical_headers = format!(
        "content-type:{content_type}\nhost:{host}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{amz_date}\n"
    );
    let mut signed_headers = "content-type;host;x-amz-content-sha256;x-amz-date".to_string();
    if let Some(token) = &session_token {
        canonical_headers.push_str(&format!("x-amz-security-token:{token}\n"));
        signed_headers.push_str(";x-amz-security-token");
    }
    let canonical_request =
        format!("PUT\n{canonical_uri}\n\n{canonical_headers}\n{signed_headers}\n{payload_hash}");
    let credential_scope = format!("{short_date}/{signing_region}/s3/aws4_request");
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{amz_date}\n{credential_scope}\n{}",
        sha256_hex(canonical_request.as_bytes())
    );
    let signing_key = s3_signing_key(&secret_access_key, &short_date, signing_region)?;
    let signature = hex_lower(&hmac_sha256(&signing_key, &string_to_sign)?);
    let authorization = format!(
        "AWS4-HMAC-SHA256 Credential={access_key_id}/{credential_scope}, SignedHeaders={signed_headers}, Signature={signature}"
    );
    let client = pinned_http_client(
        &host_label,
        &addrs,
        Duration::from_secs(DEFAULT_REQUEST_TIMEOUT.min(120)),
        "storage_s3_client_failed",
        "Unable to build S3 storage client.",
    )?;
    let mut request = client
        .put(&url)
        .header("Host", host.clone())
        .header(CONTENT_TYPE, content_type)
        .header("x-amz-content-sha256", payload_hash)
        .header("x-amz-date", amz_date)
        .header(AUTHORIZATION, authorization)
        .body(bytes.clone());
    if let Some(token) = session_token {
        request = request.header("x-amz-security-token", token);
    }
    let response = request.send().map_err(|error| {
        AppError::new("storage_s3_request_failed", "S3 storage upload failed.").with_detail(json!({
            "url": redact_url_for_log(&url),
            "error": sanitized_request_error(&error),
        }))
    })?;
    let status = response.status();
    let etag = response
        .headers()
        .get("etag")
        .and_then(|value| value.to_str().ok())
        .map(ToString::to_string);
    let body = response.text().unwrap_or_default();
    if !status.is_success() {
        return Err(AppError::new(
            "storage_s3_status_failed",
            format!("S3 storage upload returned {status}."),
        )
        .with_detail(json!({
            "url": redact_url_for_log(&url),
            "body": sanitized_response_body(&body),
        })));
    }
    Ok(StorageUploadOutcome {
        url: http_url_if_safe(
            public_base_url
                .as_deref()
                .map(|base| join_storage_url(base, &key)),
        ),
        bytes: Some(bytes.len() as u64),
        metadata: json!({
            "bucket": bucket,
            "key": key,
            "endpoint": redact_url_for_log(&url),
            "etag": etag,
            "http_status": status.as_u16(),
        }),
    })
}
