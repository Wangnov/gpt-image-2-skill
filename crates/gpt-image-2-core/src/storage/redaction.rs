use serde_json::{Map, Value, json};

use crate::{redact_credential_ref, redact_optional_credential};

use super::{
    StorageConfig, StorageTargetConfig, effective_baidu_netdisk_auth_mode,
    effective_pan123_open_auth_mode,
};

fn redact_storage_target_config(target: &StorageTargetConfig) -> Value {
    match target {
        StorageTargetConfig::Local {
            directory,
            public_base_url,
        } => json!({
            "type": "local",
            "directory": directory,
            "public_base_url": public_base_url,
        }),
        StorageTargetConfig::S3 {
            bucket,
            region,
            endpoint,
            prefix,
            access_key_id,
            secret_access_key,
            session_token,
            public_base_url,
        } => json!({
            "type": "s3",
            "bucket": bucket,
            "region": region,
            "endpoint": endpoint,
            "prefix": prefix,
            "access_key_id": redact_optional_credential(access_key_id),
            "secret_access_key": redact_optional_credential(secret_access_key),
            "session_token": redact_optional_credential(session_token),
            "public_base_url": public_base_url,
        }),
        StorageTargetConfig::WebDav {
            url,
            username,
            password,
            public_base_url,
        } => json!({
            "type": "webdav",
            "url": url,
            "username": username,
            "password": redact_optional_credential(password),
            "public_base_url": public_base_url,
        }),
        StorageTargetConfig::Http {
            url,
            method,
            headers,
            public_url_json_pointer,
        } => json!({
            "type": "http",
            "url": url,
            "method": method,
            "headers": headers.iter().map(|(key, credential)| {
                (key.clone(), redact_credential_ref(credential))
            }).collect::<Map<String, Value>>(),
            "public_url_json_pointer": public_url_json_pointer,
        }),
        StorageTargetConfig::Sftp {
            host,
            port,
            host_key_sha256,
            username,
            password,
            private_key,
            remote_dir,
            public_base_url,
        } => json!({
            "type": "sftp",
            "host": host,
            "port": port,
            "host_key_sha256": host_key_sha256,
            "username": username,
            "password": redact_optional_credential(password),
            "private_key": redact_optional_credential(private_key),
            "remote_dir": remote_dir,
            "public_base_url": public_base_url,
        }),
        StorageTargetConfig::BaiduNetdisk {
            auth_mode,
            app_key,
            secret_key,
            access_token,
            refresh_token,
            app_name,
            remote_dir,
            public_base_url,
        } => json!({
            "type": "baidu_netdisk",
            "auth_mode": effective_baidu_netdisk_auth_mode(*auth_mode, access_token.as_ref()),
            "app_key": app_key,
            "secret_key": redact_optional_credential(secret_key),
            "access_token": redact_optional_credential(access_token),
            "refresh_token": redact_optional_credential(refresh_token),
            "app_name": app_name,
            "remote_dir": remote_dir,
            "public_base_url": public_base_url,
        }),
        StorageTargetConfig::Pan123Open {
            auth_mode,
            client_id,
            client_secret,
            access_token,
            parent_id,
            use_direct_link,
        } => json!({
            "type": "pan123_open",
            "auth_mode": effective_pan123_open_auth_mode(*auth_mode, access_token.as_ref()),
            "client_id": client_id,
            "client_secret": redact_optional_credential(client_secret),
            "access_token": redact_optional_credential(access_token),
            "parent_id": parent_id,
            "use_direct_link": use_direct_link,
        }),
    }
}

pub(crate) fn redact_storage_config(config: &StorageConfig) -> Value {
    json!({
        "targets": config.targets.iter().map(|(name, target)| {
            (name.clone(), redact_storage_target_config(target))
        }).collect::<Map<String, Value>>(),
        "default_targets": config.default_targets,
        "fallback_targets": config.fallback_targets,
        "fallback_policy": config.fallback_policy,
        "upload_concurrency": config.upload_concurrency,
        "target_concurrency": config.target_concurrency,
    })
}
