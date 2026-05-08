#![allow(unused_imports)]

use super::*;

pub fn load_app_config(path: &Path) -> Result<AppConfig, AppError> {
    if !path.is_file() {
        return Ok(AppConfig::default());
    }
    let raw = fs::read_to_string(path).map_err(|error| {
        AppError::new("config_read_failed", "Unable to read config file.").with_detail(
            json!({"config_file": path.display().to_string(), "error": error.to_string()}),
        )
    })?;
    serde_json::from_str(&raw).map_err(|error| {
        AppError::new("config_invalid_json", "Config file must be valid JSON.").with_detail(
            json!({"config_file": path.display().to_string(), "error": error.to_string()}),
        )
    })
}

pub fn save_app_config(path: &Path, config: &AppConfig) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            AppError::new("config_write_failed", "Unable to create config directory.").with_detail(
                json!({"config_file": path.display().to_string(), "error": error.to_string()}),
            )
        })?;
    }
    let mut content = serde_json::to_string_pretty(config).map_err(|error| {
        AppError::new("config_write_failed", "Unable to serialize config.")
            .with_detail(json!({"error": error.to_string()}))
    })?;
    content.push('\n');
    fs::write(path, content).map_err(|error| {
        AppError::new("config_write_failed", "Unable to write config file.").with_detail(
            json!({"config_file": path.display().to_string(), "error": error.to_string()}),
        )
    })?;
    set_private_file_permissions(path)?;
    Ok(())
}

#[cfg(unix)]
pub(crate) fn set_private_file_permissions(path: &Path) -> Result<(), AppError> {
    use std::os::unix::fs::PermissionsExt;
    let mut permissions = fs::metadata(path)
        .map_err(|error| {
            AppError::new(
                "config_write_failed",
                "Unable to inspect config permissions.",
            )
            .with_detail(
                json!({"config_file": path.display().to_string(), "error": error.to_string()}),
            )
        })?
        .permissions();
    permissions.set_mode(0o600);
    fs::set_permissions(path, permissions).map_err(|error| {
        AppError::new("config_write_failed", "Unable to set config permissions.").with_detail(
            json!({"config_file": path.display().to_string(), "error": error.to_string()}),
        )
    })
}

#[cfg(not(unix))]
pub(crate) fn set_private_file_permissions(_path: &Path) -> Result<(), AppError> {
    Ok(())
}

pub(crate) fn redact_credential_ref(value: &CredentialRef) -> Value {
    match value {
        CredentialRef::File { value } => json!({
            "source": "file",
            "present": !value.is_empty(),
            "value": {"_omitted": "secret"},
        }),
        CredentialRef::Env { env } => json!({
            "source": "env",
            "env": env,
            "present": std::env::var(env).map(|value| !value.trim().is_empty()).unwrap_or(false),
        }),
        CredentialRef::Keychain { service, account } => json!({
            "source": "keychain",
            "service": service.as_deref().unwrap_or(KEYCHAIN_SERVICE),
            "account": account,
            "present": read_keychain_secret(service.as_deref().unwrap_or(KEYCHAIN_SERVICE), account).is_ok(),
        }),
    }
}

pub(crate) fn redact_optional_credential(value: &Option<CredentialRef>) -> Value {
    value
        .as_ref()
        .map(redact_credential_ref)
        .unwrap_or(Value::Null)
}

pub(crate) fn redact_notification_config(config: &NotificationConfig) -> Value {
    json!({
        "enabled": config.enabled,
        "on_completed": config.on_completed,
        "on_failed": config.on_failed,
        "on_cancelled": config.on_cancelled,
        "toast": {
            "enabled": config.toast.enabled,
        },
        "system": {
            "enabled": config.system.enabled,
            "mode": config.system.mode,
        },
        "email": {
            "enabled": config.email.enabled,
            "smtp_host": config.email.smtp_host,
            "smtp_port": config.email.smtp_port,
            "tls": config.email.tls,
            "username": config.email.username,
            "password": redact_optional_credential(&config.email.password),
            "from": config.email.from,
            "to": config.email.to,
            "timeout_seconds": config.email.timeout_seconds,
        },
        "webhooks": config.webhooks.iter().map(|webhook| {
            json!({
                "id": webhook.id,
                "name": webhook.name,
                "enabled": webhook.enabled,
                "url": webhook.url,
                "method": webhook.method,
                "headers": webhook.headers.iter().map(|(key, credential)| {
                    (key.clone(), redact_credential_ref(credential))
                }).collect::<Map<String, Value>>(),
                "timeout_seconds": webhook.timeout_seconds,
            })
        }).collect::<Vec<_>>(),
    })
}

pub(crate) fn redact_storage_target_config(target: &StorageTargetConfig) -> Value {
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

pub fn redact_app_config(config: &AppConfig) -> Value {
    let providers = config
        .providers
        .iter()
        .map(|(name, provider)| {
            let credentials = provider
                .credentials
                .iter()
                .map(|(key, value)| (key.clone(), redact_credential_ref(value)))
                .collect::<Map<String, Value>>();
            (
                name.clone(),
                json!({
                    "type": provider.provider_type,
                    "api_base": provider.api_base,
                    "endpoint": provider.endpoint,
                    "model": provider.model,
                    "supports_n": provider.supports_n,
                    "credentials": credentials,
                }),
            )
        })
        .collect::<Map<String, Value>>();
    json!({
        "version": config.version,
        "default_provider": config.default_provider,
        "providers": providers,
        "notifications": redact_notification_config(&config.notifications),
        "storage": redact_storage_config(&config.storage),
        "paths": config.paths,
    })
}

pub(crate) fn provider_is_builtin(name: &str) -> bool {
    matches!(name, "auto" | "openai" | "codex")
}

pub(crate) fn validate_provider_name(name: &str) -> Result<(), AppError> {
    if name.trim().is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains(char::is_whitespace)
    {
        return Err(AppError::new(
            "provider_invalid_name",
            "Provider name must be a non-empty path-safe token.",
        ));
    }
    Ok(())
}
