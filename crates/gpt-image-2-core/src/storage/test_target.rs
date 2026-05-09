use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{AppError, resolve_credential, validate_remote_http_target};

use super::backends::{
    BAIDU_NETDISK_FILE_ENDPOINT, PAN123_OPEN_TOKEN_ENDPOINT, authenticate_sftp_session,
    connect_sftp_session, s3_endpoint_and_host,
};
use super::types::StorageTargetConfig;
use super::util::{
    credential_resolves_non_empty, pinned_http_client, redact_url_for_log, resolve_storage_headers,
    storage_error_message, storage_target_type,
};
use super::{
    BaiduNetdiskAuthMode, Pan123OpenAuthMode, effective_baidu_netdisk_auth_mode,
    effective_pan123_open_auth_mode,
};

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
                                "error": super::util::sanitized_request_error(&error),
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
                            "error": super::util::sanitized_request_error(&error),
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
            let access_key_ready = access_key_id
                .as_ref()
                .is_some_and(credential_resolves_non_empty);
            let secret_key_ready = secret_access_key
                .as_ref()
                .is_some_and(credential_resolves_non_empty);
            let credential_ready = access_key_ready && secret_key_ready;
            let endpoint_url = s3_endpoint_and_host(
                bucket,
                region.as_deref(),
                endpoint.as_deref(),
                ".gpt-image-2-storage-test",
            );
            let endpoint_ready = credential_ready
                && endpoint_url
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
        StorageTargetConfig::BaiduNetdisk {
            auth_mode,
            app_key,
            secret_key,
            access_token,
            refresh_token,
            app_name,
            remote_dir,
            ..
        } => {
            let access_token_ready = access_token
                .as_ref()
                .is_some_and(credential_resolves_non_empty);
            let secret_key_ready = secret_key
                .as_ref()
                .is_some_and(credential_resolves_non_empty);
            let refresh_token_ready = refresh_token
                .as_ref()
                .is_some_and(credential_resolves_non_empty);
            let mode = effective_baidu_netdisk_auth_mode(*auth_mode, access_token.as_ref());
            let credential_ready = match mode {
                BaiduNetdiskAuthMode::Personal => access_token_ready,
                BaiduNetdiskAuthMode::Oauth => {
                    !app_key.trim().is_empty() && secret_key_ready && refresh_token_ready
                }
            };
            let app_name_ready = !app_name.trim().is_empty();
            let endpoint_ready = credential_ready
                && app_name_ready
                && validate_remote_http_target(
                    BAIDU_NETDISK_FILE_ENDPOINT,
                    "Baidu Netdisk storage",
                )
                .is_ok();
            let ok = credential_ready && app_name_ready && endpoint_ready;
            StorageTestResult {
                ok,
                target: name.to_string(),
                target_type,
                message: if ok {
                    "百度网盘 OpenAPI 配置可用于上传；请确认应用已开通网盘上传权限。".to_string()
                } else if !credential_ready {
                    match mode {
                        BaiduNetdiskAuthMode::Personal => {
                            "百度网盘个人对接需要 access_token。".to_string()
                        }
                        BaiduNetdiskAuthMode::Oauth => {
                            "百度网盘 OAuth 对接需要 app_key + secret_key + refresh_token。"
                                .to_string()
                        }
                    }
                } else if !app_name_ready {
                    "百度网盘应用名称不能为空；请填写百度网盘开放平台应用目录名。".to_string()
                } else {
                    "百度网盘 OpenAPI 端点不可达；请检查本机网络或代理设置。".to_string()
                },
                latency_ms: None,
                detail: Some(json!({
                    "auth_mode": mode,
                    "app_key_present": !app_key.trim().is_empty(),
                    "access_token_ready": access_token_ready,
                    "secret_key_ready": secret_key_ready,
                    "refresh_token_ready": refresh_token_ready,
                    "credential_ready": credential_ready,
                    "app_name_present": app_name_ready,
                    "endpoint_ready": endpoint_ready,
                    "app_name": app_name,
                    "remote_dir": remote_dir,
                })),
                unsupported: false,
                local_only: false,
            }
        }
        StorageTargetConfig::Pan123Open {
            auth_mode,
            client_id,
            client_secret,
            access_token,
            parent_id,
            use_direct_link,
        } => {
            let access_token_ready = access_token
                .as_ref()
                .is_some_and(credential_resolves_non_empty);
            let client_secret_ready = client_secret
                .as_ref()
                .is_some_and(credential_resolves_non_empty);
            let client_credentials_ready = !client_id.trim().is_empty() && client_secret_ready;
            let mode = effective_pan123_open_auth_mode(*auth_mode, access_token.as_ref());
            let credential_ready = match mode {
                Pan123OpenAuthMode::Client => client_credentials_ready,
                Pan123OpenAuthMode::AccessToken => access_token_ready,
            };
            let endpoint_ready = credential_ready
                && validate_remote_http_target(PAN123_OPEN_TOKEN_ENDPOINT, "123 Netdisk storage")
                    .is_ok();
            let ok = credential_ready && endpoint_ready;
            StorageTestResult {
                ok,
                target: name.to_string(),
                target_type,
                message: if ok {
                    "123 网盘 OpenAPI 配置可用于上传；直链需要账号侧开通直链能力。".to_string()
                } else if !credential_ready {
                    match mode {
                        Pan123OpenAuthMode::Client => {
                            "123 网盘 client 对接需要 client_id + client_secret。".to_string()
                        }
                        Pan123OpenAuthMode::AccessToken => {
                            "123 网盘 access_token 对接需要 access_token。".to_string()
                        }
                    }
                } else {
                    "123 网盘 OpenAPI 端点不可达；请检查本机网络或代理设置。".to_string()
                },
                latency_ms: None,
                detail: Some(json!({
                    "auth_mode": mode,
                    "client_id_present": !client_id.trim().is_empty(),
                    "access_token_ready": access_token_ready,
                    "client_secret_ready": client_secret_ready,
                    "client_credentials_ready": client_credentials_ready,
                    "credential_ready": credential_ready,
                    "endpoint_ready": endpoint_ready,
                    "parent_id": parent_id,
                    "use_direct_link": use_direct_link,
                })),
                unsupported: false,
                local_only: false,
            }
        }
    };
    result.latency_ms = Some(started.elapsed().unwrap_or_default().as_millis());
    result
}
