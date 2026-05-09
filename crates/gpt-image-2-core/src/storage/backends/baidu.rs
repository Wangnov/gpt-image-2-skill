use reqwest::blocking::Client;
use reqwest::blocking::multipart::{Form, Part};
use serde_json::json;

use super::super::types::{
    BaiduNetdiskAuthMode, StorageTargetConfig, effective_baidu_netdisk_auth_mode,
};
use super::super::util::*;
use crate::{AppError, CredentialRef};

const BAIDU_NETDISK_REFRESH_ENDPOINT: &str = "https://openapi.baidu.com/oauth/2.0/token";
pub(crate) const BAIDU_NETDISK_FILE_ENDPOINT: &str = "https://pan.baidu.com/rest/2.0/xpan/file";
const BAIDU_NETDISK_UPLOAD_ENDPOINT: &str = "https://d.pcs.baidu.com/rest/2.0/pcs/superfile2";

fn baidu_netdisk_access_token(
    client: &Client,
    auth_mode: BaiduNetdiskAuthMode,
    app_key: &str,
    secret_key: Option<&CredentialRef>,
    access_token: Option<&CredentialRef>,
    refresh_token: Option<&CredentialRef>,
) -> Result<String, AppError> {
    match auth_mode {
        BaiduNetdiskAuthMode::Personal => resolve_required_credential(
            access_token,
            "storage_baidu_credentials_missing",
            "Baidu Netdisk access token is missing.",
        ),
        BaiduNetdiskAuthMode::Oauth => {
            if app_key.trim().is_empty() {
                return Err(AppError::new(
                    "storage_baidu_credentials_missing",
                    "Baidu Netdisk app key is missing.",
                ));
            }
            let refresh_token = resolve_required_credential(
                refresh_token,
                "storage_baidu_credentials_missing",
                "Baidu Netdisk refresh token is missing.",
            )?;
            let secret_key = resolve_required_credential(
                secret_key,
                "storage_baidu_credentials_missing",
                "Baidu Netdisk secret key is missing.",
            )?;
            let response = client
                .get(BAIDU_NETDISK_REFRESH_ENDPOINT)
                .query(&[
                    ("grant_type", "refresh_token"),
                    ("refresh_token", refresh_token.as_str()),
                    ("client_id", app_key),
                    ("client_secret", secret_key.as_str()),
                ])
                .send()
                .map_err(|error| {
                    AppError::new(
                        "storage_baidu_token_failed",
                        "Baidu Netdisk token refresh failed.",
                    )
                    .with_detail(json!({"error": sanitized_request_error(&error)}))
                })?;
            let (_, payload) = storage_response_json(response, "storage_baidu_token_failed")?;
            required_json_string(&payload, "/access_token", "storage_baidu_token_failed")
        }
    }
}

fn clean_netdisk_path_segment(value: &str) -> Option<String> {
    let trimmed = value.trim().trim_matches('/');
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub(crate) fn baidu_netdisk_remote_path(
    app_name: &str,
    remote_dir: Option<&str>,
    key: &str,
) -> String {
    let app_name =
        clean_netdisk_path_segment(app_name).unwrap_or_else(|| "gpt-image-2".to_string());
    let remote_dir = remote_dir
        .unwrap_or("")
        .split('/')
        .filter_map(clean_netdisk_path_segment)
        .collect::<Vec<_>>()
        .join("/");
    if remote_dir.is_empty() {
        format!("/apps/{app_name}/{key}")
    } else {
        format!("/apps/{app_name}/{remote_dir}/{key}")
    }
}

pub(super) fn upload_to_baidu_netdisk(
    target: &StorageTargetConfig,
    job_id: &str,
    output: &UploadOutput,
) -> Result<StorageUploadOutcome, AppError> {
    let StorageTargetConfig::BaiduNetdisk {
        auth_mode,
        app_key,
        secret_key,
        access_token,
        refresh_token,
        app_name,
        remote_dir,
        public_base_url,
    } = target
    else {
        return Err(AppError::new(
            "storage_target_type_mismatch",
            "Expected Baidu Netdisk storage target.",
        ));
    };
    let bytes = read_upload_bytes(output)?;
    let key = storage_object_key(job_id, output);
    let path = baidu_netdisk_remote_path(app_name, remote_dir.as_deref(), &key);
    let client = netdisk_http_client()?;
    let auth_mode = effective_baidu_netdisk_auth_mode(*auth_mode, access_token.as_ref());
    let token = baidu_netdisk_access_token(
        &client,
        auth_mode,
        app_key,
        secret_key.as_ref(),
        access_token.as_ref(),
        refresh_token.as_ref(),
    )?;
    let content_md5 = md5_hex(&bytes);
    let block_hashes = baidu_netdisk_block_list(&bytes);
    let block_list = serde_json::to_string(&block_hashes).map_err(|error| {
        AppError::new(
            "storage_baidu_precreate_failed",
            "Unable to build Baidu Netdisk block list.",
        )
        .with_detail(json!({"error": error.to_string()}))
    })?;
    let size = bytes.len().to_string();
    let response = client
        .post(BAIDU_NETDISK_FILE_ENDPOINT)
        .query(&[("method", "precreate"), ("access_token", token.as_str())])
        .form(&[
            ("path", path.as_str()),
            ("size", size.as_str()),
            ("isdir", "0"),
            ("autoinit", "1"),
            ("rtype", "3"),
            ("block_list", block_list.as_str()),
        ])
        .send()
        .map_err(|error| {
            AppError::new(
                "storage_baidu_precreate_failed",
                "Baidu Netdisk precreate failed.",
            )
            .with_detail(json!({"error": sanitized_request_error(&error)}))
        })?;
    let (_, precreate) = storage_response_json(response, "storage_baidu_precreate_failed")?;
    if !value_code_success(&precreate, &[0]) {
        return Err(AppError::new(
            "storage_baidu_precreate_failed",
            "Baidu Netdisk precreate returned an error.",
        )
        .with_detail(redact_storage_response_value(None, &precreate)));
    }
    let uploadid = required_json_string(&precreate, "/uploadid", "storage_baidu_precreate_failed")?;
    let mime = mime_guess::from_path(&output.path)
        .first_or_octet_stream()
        .to_string();
    let base_file_name = output_file_name(output);
    for partseq in 0..baidu_netdisk_chunk_count(&bytes) {
        let partseq_text = partseq.to_string();
        let chunk = baidu_netdisk_chunk(&bytes, partseq);
        let part = Part::bytes(chunk.to_vec())
            .file_name(format!("{base_file_name}.part{partseq}"))
            .mime_str(&mime)
            .map_err(|error| {
                AppError::new(
                    "storage_baidu_upload_failed",
                    "Unable to build Baidu upload part.",
                )
                .with_detail(json!({"error": error.to_string(), "partseq": partseq}))
            })?;
        let response = client
            .post(BAIDU_NETDISK_UPLOAD_ENDPOINT)
            .query(&[
                ("method", "upload"),
                ("type", "tmpfile"),
                ("access_token", token.as_str()),
                ("path", path.as_str()),
                ("uploadid", uploadid.as_str()),
                ("partseq", partseq_text.as_str()),
            ])
            .multipart(Form::new().part("file", part))
            .send()
            .map_err(|error| {
                AppError::new(
                    "storage_baidu_upload_failed",
                    "Baidu Netdisk upload failed.",
                )
                .with_detail(json!({"error": sanitized_request_error(&error), "partseq": partseq}))
            })?;
        let (_, uploaded) = storage_response_json(response, "storage_baidu_upload_failed")?;
        if !value_code_success(&uploaded, &[0]) {
            return Err(AppError::new(
                "storage_baidu_upload_failed",
                "Baidu Netdisk upload returned an error.",
            )
            .with_detail(json!({
                "partseq": partseq,
                "body": redact_storage_response_value(None, &uploaded),
            })));
        }
    }
    let response = client
        .post(BAIDU_NETDISK_FILE_ENDPOINT)
        .query(&[("method", "create"), ("access_token", token.as_str())])
        .form(&[
            ("path", path.as_str()),
            ("size", size.as_str()),
            ("isdir", "0"),
            ("rtype", "3"),
            ("uploadid", uploadid.as_str()),
            ("block_list", block_list.as_str()),
        ])
        .send()
        .map_err(|error| {
            AppError::new(
                "storage_baidu_create_failed",
                "Baidu Netdisk create failed.",
            )
            .with_detail(json!({"error": sanitized_request_error(&error)}))
        })?;
    let (_, created) = storage_response_json(response, "storage_baidu_create_failed")?;
    if !value_code_success(&created, &[0]) {
        return Err(AppError::new(
            "storage_baidu_create_failed",
            "Baidu Netdisk create returned an error.",
        )
        .with_detail(redact_storage_response_value(None, &created)));
    }
    Ok(StorageUploadOutcome {
        url: http_url_if_safe(
            public_base_url
                .as_deref()
                .map(|base| join_storage_url(base, &key)),
        ),
        bytes: Some(bytes.len() as u64),
        metadata: json!({
            "key": key,
            "path": path,
            "fs_id": optional_json_u64(&created, &["/fs_id"]),
            "md5": content_md5,
            "block_list": block_hashes,
        }),
    })
}
