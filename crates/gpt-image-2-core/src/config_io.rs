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
    let mut content = serde_json::to_string_pretty(config).map_err(|error| {
        AppError::new("config_write_failed", "Unable to serialize config.")
            .with_detail(json!({"error": error.to_string()}))
    })?;
    content.push('\n');
    atomic_write_private(path, content.as_bytes(), "config_write_failed")
}

/// Monotonic suffix so two writers in the same process never pick the same
/// temp path; combined with the pid it stays unique across processes too.
static ATOMIC_WRITE_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Open a fresh, private (0600 on unix) temp file. `create_new` guarantees we
/// never adopt a file another writer is mid-write on, and the mode is applied
/// at creation so a secrets temp is never briefly group/world-readable.
fn create_private_temp(temp: &Path) -> std::io::Result<fs::File> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(temp)
}

/// Write `bytes` to `path` atomically: fill a unique, private temp file, fsync
/// it, then rename over the target. A crash can leave a temp file but never a
/// half-written or briefly world-readable target — which matters because
/// auth.json / config.json hold secrets and auth.json is shared with the
/// Codex CLI. Concurrent writers keep last-writer-wins semantics without
/// corrupting each other, since each renames its own private temp.
pub(crate) fn atomic_write_private(
    path: &Path,
    bytes: &[u8],
    error_code: &'static str,
) -> Result<(), AppError> {
    let detail = |extra: Value| {
        let mut map = json!({"config_file": path.display().to_string()});
        if let (Value::Object(map), Value::Object(extra)) = (&mut map, extra) {
            map.extend(extra);
        }
        map
    };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            AppError::new(error_code, "Unable to create config directory.")
                .with_detail(detail(json!({"error": error.to_string()})))
        })?;
    }
    let seq = ATOMIC_WRITE_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let suffix = format!(".{}.{seq}.tmp", std::process::id());
    let mut file_name = path.file_name().unwrap_or_default().to_os_string();
    file_name.push(&suffix);
    let temp = match path.parent() {
        Some(parent) => parent.join(file_name),
        None => PathBuf::from(file_name),
    };
    {
        let mut file = create_private_temp(&temp).map_err(|error| {
            AppError::new(error_code, "Unable to create temp config file.")
                .with_detail(detail(json!({"error": error.to_string()})))
        })?;
        file.write_all(bytes).map_err(|error| {
            let _ = fs::remove_file(&temp);
            AppError::new(error_code, "Unable to write temp config file.")
                .with_detail(detail(json!({"error": error.to_string()})))
        })?;
        file.sync_all().map_err(|error| {
            let _ = fs::remove_file(&temp);
            AppError::new(error_code, "Unable to flush temp config file.")
                .with_detail(detail(json!({"error": error.to_string()})))
        })?;
    }
    fs::rename(&temp, path).map_err(|error| {
        let _ = fs::remove_file(&temp);
        AppError::new(error_code, "Unable to finalize config file.")
            .with_detail(detail(json!({"error": error.to_string()})))
    })?;
    // The target inherits the temp's 0600; non-unix is a no-op.
    set_private_file_permissions(path)?;
    if let Some(parent) = path.parent()
        && let Ok(dir) = fs::File::open(parent)
    {
        let _ = dir.sync_all();
    }
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
                    "proxy": provider.proxy.as_ref().map(redact_proxy_config),
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
        "proxy": redact_proxy_config(&config.proxy),
        "logging": redact_logging_config(&config.logging),
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
