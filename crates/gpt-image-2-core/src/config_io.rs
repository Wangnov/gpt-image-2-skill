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

/// Write `bytes` to `path` atomically: fill a unique, private temp file, fsync
/// it, then persist it over the target. A crash can leave a temp file but never
/// a half-written or briefly world-readable target — which matters because
/// auth.json / config.json hold secrets and auth.json is shared with the Codex
/// CLI. Uses `tempfile` for the temp+persist so the replace is atomic on both
/// unix (rename) and Windows (ReplaceFile) — a bare `fs::rename` fails on
/// Windows when the target already exists.
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
    let parent = path.parent().filter(|p| !p.as_os_str().is_empty());
    if let Some(parent) = parent {
        fs::create_dir_all(parent).map_err(|error| {
            AppError::new(error_code, "Unable to create config directory.")
                .with_detail(detail(json!({"error": error.to_string()})))
        })?;
    }
    // A uniquely-named temp in the target dir (same filesystem, so persist is a
    // rename), created 0600 up front so secrets are never briefly readable.
    let mut builder = tempfile::Builder::new();
    builder.prefix(".").suffix(".tmp");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        builder.permissions(fs::Permissions::from_mode(0o600));
    }
    let dir = parent.unwrap_or_else(|| Path::new("."));
    let mut temp = builder.tempfile_in(dir).map_err(|error| {
        AppError::new(error_code, "Unable to create temp config file.")
            .with_detail(detail(json!({"error": error.to_string()})))
    })?;
    temp.write_all(bytes).map_err(|error| {
        AppError::new(error_code, "Unable to write temp config file.")
            .with_detail(detail(json!({"error": error.to_string()})))
    })?;
    temp.as_file().sync_all().map_err(|error| {
        AppError::new(error_code, "Unable to flush temp config file.")
            .with_detail(detail(json!({"error": error.to_string()})))
    })?;
    temp.persist(path).map_err(|error| {
        AppError::new(error_code, "Unable to finalize config file.")
            .with_detail(detail(json!({"error": error.error.to_string()})))
    })?;
    // Windows has no unix mode; the unix path already created the temp 0600.
    #[cfg(not(unix))]
    set_private_file_permissions(path)?;
    if let Some(parent) = parent
        && let Ok(dir) = fs::File::open(parent)
    {
        let _ = dir.sync_all();
    }
    Ok(())
}

// Unix temp files are created 0600 by the tempfile builder above, so a
// post-write chmod is only needed on platforms without unix permissions
// (where it's a no-op today, but keeps the call site honest).
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
                    "edit_region_mode": provider.edit_region_mode,
                    "preset": provider.preset,
                    "image_transport": provider.image_transport,
                    "poll_interval_seconds": provider.poll_interval_seconds,
                    "poll_timeout_seconds": provider.poll_timeout_seconds,
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
