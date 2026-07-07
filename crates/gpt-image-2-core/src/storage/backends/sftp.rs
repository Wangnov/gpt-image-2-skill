use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde_json::json;
use sha2::{Digest, Sha256};
use ssh2::Session;

use crate::{resolve_credential, validate_remote_tcp_target};

use super::super::types::StorageTargetConfig;
use super::super::util::*;
use crate::{AppError, CredentialRef};

const SFTP_CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
// Matches the 120s cap used by the HTTP-family storage backends.
const SFTP_IO_TIMEOUT_MS: u32 = 120_000;

fn ensure_remote_dir(sftp: &ssh2::Sftp, remote_dir: &Path) {
    let mut current = PathBuf::new();
    for component in remote_dir.components() {
        current.push(component.as_os_str());
        if current.as_os_str().is_empty() {
            continue;
        }
        let _ = sftp.mkdir(&current, 0o755);
    }
}

fn sftp_expected_host_key(expected: Option<&str>) -> Result<&str, AppError> {
    expected
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::new(
                "storage_sftp_host_key_missing",
                "SFTP storage requires a SHA256 host key fingerprint.",
            )
        })
}

fn strip_sha256_prefix(value: &str) -> &str {
    if value.len() >= 7 && value[..7].eq_ignore_ascii_case("SHA256:") {
        &value[7..]
    } else {
        value
    }
}

pub(crate) fn sftp_host_key_matches(expected: &str, actual_hex: &str, actual_base64: &str) -> bool {
    let expected = strip_sha256_prefix(expected.trim());
    let compact_expected = expected.replace(':', "");
    compact_expected.eq_ignore_ascii_case(actual_hex)
        || expected == actual_base64
        || expected.trim_end_matches('=') == actual_base64.trim_end_matches('=')
}

fn verify_sftp_host_key(session: &Session, expected: Option<&str>) -> Result<String, AppError> {
    let expected = sftp_expected_host_key(expected)?;
    let (host_key, _) = session.host_key().ok_or_else(|| {
        AppError::new(
            "storage_sftp_host_key_unavailable",
            "SFTP server did not provide a host key.",
        )
    })?;
    let digest = Sha256::digest(host_key);
    let actual_hex = hex_lower(&digest);
    let actual_base64 = STANDARD.encode(digest);
    if !sftp_host_key_matches(expected, &actual_hex, &actual_base64) {
        return Err(AppError::new(
            "storage_sftp_host_key_mismatch",
            "SFTP host key fingerprint does not match.",
        )
        .with_detail(json!({
            "expected": expected,
            "actual": format!("SHA256:{}", actual_base64.trim_end_matches('=')),
        })));
    }
    Ok(format!("SHA256:{}", actual_base64.trim_end_matches('=')))
}

pub(crate) fn connect_sftp_session(
    host: &str,
    port: u16,
    host_key_sha256: Option<&str>,
) -> Result<(Session, String), AppError> {
    sftp_expected_host_key(host_key_sha256)?;
    let addrs = validate_remote_tcp_target(host, port, "SFTP storage")?;
    // Bounded connect + session timeouts: every HTTP-family backend caps
    // I/O at 120s, while an SFTP server that blackholes TCP would pin an
    // upload worker forever ("uploading" jobs that never settle).
    // connect_timeout takes a single address, so walk the pinned list the
    // way `connect(&[..])` would.
    let mut last_error: Option<std::io::Error> = None;
    let mut connected = None;
    for addr in &addrs {
        match TcpStream::connect_timeout(addr, SFTP_CONNECT_TIMEOUT) {
            Ok(stream) => {
                connected = Some(stream);
                break;
            }
            Err(error) => last_error = Some(error),
        }
    }
    let tcp = connected.ok_or_else(|| {
        AppError::new(
            "storage_sftp_connect_failed",
            "Unable to connect to SFTP server.",
        )
        .with_detail(json!({
            "host": host,
            "port": port,
            "timeout_secs": SFTP_CONNECT_TIMEOUT.as_secs(),
            "error": last_error
                .map(|error| error.to_string())
                .unwrap_or_else(|| "no resolved address".to_string()),
        }))
    })?;
    let mut session = Session::new().map_err(|error| {
        AppError::new(
            "storage_sftp_session_failed",
            "Unable to create SFTP session.",
        )
        .with_detail(json!({"error": error.to_string()}))
    })?;
    session.set_tcp_stream(tcp);
    session.set_timeout(SFTP_IO_TIMEOUT_MS);
    session.handshake().map_err(|error| {
        AppError::new("storage_sftp_handshake_failed", "SFTP handshake failed.")
            .with_detail(json!({"host": host, "error": error.to_string()}))
    })?;
    let host_key_fingerprint = verify_sftp_host_key(&session, host_key_sha256)?;
    Ok((session, host_key_fingerprint))
}

pub(crate) fn authenticate_sftp_session(
    session: &Session,
    host: &str,
    username: &str,
    password: Option<&CredentialRef>,
    private_key: Option<&CredentialRef>,
) -> Result<(), AppError> {
    if let Some(private_key) = private_key {
        let (private_key, _) = resolve_credential(private_key)?;
        let passphrase = password
            .map(resolve_credential)
            .transpose()?
            .map(|(value, _)| value);
        authenticate_sftp_private_key(session, username, &private_key, passphrase.as_deref())
            .map_err(|error| {
                AppError::new("storage_sftp_auth_failed", "SFTP private-key auth failed.")
                    .with_detail(json!({"host": host, "username": username, "error": error}))
            })?;
    } else if let Some(password) = password {
        let (password, _) = resolve_credential(password)?;
        session
            .userauth_password(username, &password)
            .map_err(|error| {
                AppError::new("storage_sftp_auth_failed", "SFTP password auth failed.").with_detail(
                    json!({"host": host, "username": username, "error": error.to_string()}),
                )
            })?;
    } else {
        return Err(AppError::new(
            "storage_sftp_auth_missing",
            "SFTP storage requires a password or private key.",
        ));
    }
    if !session.authenticated() {
        return Err(AppError::new(
            "storage_sftp_auth_failed",
            "SFTP authentication failed.",
        ));
    }
    Ok(())
}

#[cfg(unix)]
fn authenticate_sftp_private_key(
    session: &Session,
    username: &str,
    private_key: &str,
    passphrase: Option<&str>,
) -> Result<(), String> {
    session
        .userauth_pubkey_memory(username, None, private_key, passphrase)
        .map_err(|error| error.to_string())
}

#[cfg(not(unix))]
fn authenticate_sftp_private_key(
    session: &Session,
    username: &str,
    private_key: &str,
    passphrase: Option<&str>,
) -> Result<(), String> {
    let path = temporary_sftp_private_key_path();
    let auth_result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|error| format!("Unable to create temporary private-key file: {error}"))?;
        file.write_all(private_key.as_bytes())
            .map_err(|error| format!("Unable to write temporary private-key file: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("Unable to flush temporary private-key file: {error}"))?;
        drop(file);
        session
            .userauth_pubkey_file(username, None, &path, passphrase)
            .map_err(|error| error.to_string())
    })();
    let _ = fs::remove_file(&path);
    auth_result
}

#[cfg(not(unix))]
fn temporary_sftp_private_key_path() -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!(
        "gpt-image-2-sftp-key-{}-{nanos}.pem",
        std::process::id()
    ))
}

pub(super) fn upload_to_sftp(
    target: &StorageTargetConfig,
    job_id: &str,
    output: &UploadOutput,
) -> Result<StorageUploadOutcome, AppError> {
    let StorageTargetConfig::Sftp {
        host,
        port,
        host_key_sha256,
        username,
        password,
        private_key,
        remote_dir,
        public_base_url,
    } = target
    else {
        return Err(AppError::new(
            "storage_target_type_mismatch",
            "Expected SFTP storage target.",
        ));
    };
    if !output.path.is_file() {
        return Err(AppError::new(
            "storage_source_missing",
            "Generated output file is missing.",
        )
        .with_detail(json!({"path": output.path.display().to_string()})));
    }
    let (session, host_key_fingerprint) =
        connect_sftp_session(host, *port, host_key_sha256.as_deref())?;
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
    let key = storage_object_key(job_id, output);
    let remote_base = PathBuf::from(remote_dir);
    let destination = remote_base.join(&key);
    if let Some(parent) = destination.parent() {
        ensure_remote_dir(&sftp, parent);
    }
    let bytes = fs::read(&output.path).map_err(|error| {
        AppError::new("storage_read_failed", "Unable to read generated output.").with_detail(
            json!({"path": output.path.display().to_string(), "error": error.to_string()}),
        )
    })?;
    let mut remote = sftp.create(&destination).map_err(|error| {
        AppError::new(
            "storage_sftp_create_failed",
            "Unable to create remote SFTP file.",
        )
        .with_detail(json!({"path": destination.display().to_string(), "error": error.to_string()}))
    })?;
    remote.write_all(&bytes).map_err(|error| {
        AppError::new(
            "storage_sftp_write_failed",
            "Unable to write remote SFTP file.",
        )
        .with_detail(json!({"path": destination.display().to_string(), "error": error.to_string()}))
    })?;
    Ok(StorageUploadOutcome {
        url: http_url_if_safe(
            public_base_url
                .as_deref()
                .map(|base| join_storage_url(base, &key)),
        ),
        bytes: Some(bytes.len() as u64),
        metadata: json!({
            "key": key,
            "remote_path": destination.display().to_string(),
            "host_key_sha256": host_key_fingerprint,
        }),
    })
}

pub(super) fn download_from_sftp(
    target: &StorageTargetConfig,
    detail: &serde_json::Value,
) -> Result<StorageDownloadOutcome, AppError> {
    let StorageTargetConfig::Sftp {
        host,
        port,
        host_key_sha256,
        username,
        password,
        private_key,
        remote_dir,
        ..
    } = target
    else {
        return Err(AppError::new(
            "storage_target_type_mismatch",
            "Expected SFTP storage target.",
        ));
    };
    let key = sftp_key(detail);
    let remote_path = sftp_readback_path(remote_dir, detail)?;
    let (session, host_key_fingerprint) =
        connect_sftp_session(host, *port, host_key_sha256.as_deref())?;
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
    let mut remote = sftp.open(&remote_path).map_err(|error| {
        AppError::new(
            "storage_sftp_read_failed",
            "Unable to open remote SFTP file.",
        )
        .with_detail(json!({"path": remote_path.display().to_string(), "error": error.to_string()}))
    })?;
    let mut bytes = Vec::new();
    remote.read_to_end(&mut bytes).map_err(|error| {
        AppError::new(
            "storage_sftp_read_failed",
            "Unable to read remote SFTP file.",
        )
        .with_detail(json!({"path": remote_path.display().to_string(), "error": error.to_string()}))
    })?;
    Ok(StorageDownloadOutcome {
        bytes,
        metadata: json!({
            "key": key,
            "remote_path": remote_path.display().to_string(),
            "host_key_sha256": host_key_fingerprint,
        }),
    })
}

#[allow(dead_code)]
pub(super) fn head_sftp(
    target: &StorageTargetConfig,
    detail: &serde_json::Value,
) -> Result<StorageHeadOutcome, AppError> {
    let StorageTargetConfig::Sftp {
        host,
        port,
        host_key_sha256,
        username,
        password,
        private_key,
        remote_dir,
        ..
    } = target
    else {
        return Err(AppError::new(
            "storage_target_type_mismatch",
            "Expected SFTP storage target.",
        ));
    };
    let key = sftp_key(detail);
    let remote_path = sftp_readback_path(remote_dir, detail)?;
    let (session, host_key_fingerprint) =
        connect_sftp_session(host, *port, host_key_sha256.as_deref())?;
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
    let stat = sftp.stat(&remote_path).map_err(|error| {
        AppError::new(
            "storage_sftp_head_failed",
            "Unable to inspect remote SFTP file.",
        )
        .with_detail(json!({"path": remote_path.display().to_string(), "error": error.to_string()}))
    })?;
    Ok(StorageHeadOutcome {
        bytes: stat.size,
        metadata: json!({
            "key": key,
            "remote_path": remote_path.display().to_string(),
            "host_key_sha256": host_key_fingerprint,
        }),
    })
}

fn sftp_key(detail: &serde_json::Value) -> Option<&str> {
    detail
        .get("key")
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.trim().is_empty())
}

fn sftp_readback_path(remote_dir: &str, detail: &serde_json::Value) -> Result<PathBuf, AppError> {
    let root = stable_remote_dir(remote_dir)?;
    let candidate = if let Some(key) = sftp_key(detail) {
        root.join(safe_relative_remote_key(key)?)
    } else {
        detail
            .get("remote_path")
            .and_then(serde_json::Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(PathBuf::from)
            .ok_or_else(|| {
                AppError::new(
                    "storage_readback_missing_key",
                    "SFTP storage upload record is missing a readable remote path.",
                )
            })?
    };
    let resolved = normalize_remote_path(candidate);
    if !resolved.starts_with(&root) {
        return Err(AppError::new(
            "storage_readback_path_outside_root",
            "SFTP storage readback path is outside the configured remote directory.",
        )
        .with_detail(json!({
            "remote_dir": root.display().to_string(),
            "remote_path": resolved.display().to_string(),
        })));
    }
    Ok(resolved)
}

fn stable_remote_dir(remote_dir: &str) -> Result<PathBuf, AppError> {
    let value = remote_dir.trim();
    let path = PathBuf::from(value);
    if value.is_empty()
        || value == "."
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::Prefix(_) | Component::CurDir
            )
        })
    {
        return Err(AppError::new(
            "storage_readback_remote_dir_invalid",
            "SFTP storage remote directory is not stable enough for readback.",
        )
        .with_detail(json!({"remote_dir": remote_dir})));
    }
    Ok(normalize_remote_path(path))
}

fn safe_relative_remote_key(key: &str) -> Result<PathBuf, AppError> {
    let path = PathBuf::from(key);
    if path.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::Prefix(_) | Component::RootDir | Component::CurDir
        )
    }) {
        return Err(AppError::new(
            "storage_readback_key_invalid",
            "SFTP storage readback key must be a relative path under remote_dir.",
        )
        .with_detail(json!({"key": key})));
    }
    Ok(path)
}

fn normalize_remote_path(path: PathBuf) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            std::path::Component::RootDir => normalized.push(component.as_os_str()),
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            std::path::Component::Normal(value) => normalized.push(value),
        }
    }
    normalized
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sftp_readback_prefers_key_under_remote_dir() {
        let path = sftp_readback_path(
            "/uploads",
            &json!({
                "key": "job-1/out.png",
                "remote_path": "/elsewhere/out.png",
            }),
        )
        .unwrap();

        assert_eq!(path, PathBuf::from("/uploads/job-1/out.png"));
    }

    #[test]
    fn sftp_readback_rejects_remote_path_outside_remote_dir() {
        let error = sftp_readback_path(
            "/uploads",
            &json!({
                "remote_path": "/elsewhere/out.png",
            }),
        )
        .unwrap_err();

        assert_eq!(error.code, "storage_readback_path_outside_root");
    }

    #[test]
    fn sftp_readback_rejects_unstable_remote_dir() {
        for remote_dir in ["", ".", "../uploads", "/uploads/../elsewhere"] {
            let error = sftp_readback_path(
                remote_dir,
                &json!({
                    "key": "job-1/out.png",
                }),
            )
            .unwrap_err();

            assert_eq!(error.code, "storage_readback_remote_dir_invalid");
        }
    }

    #[test]
    fn sftp_readback_rejects_traversing_keys() {
        let error = sftp_readback_path(
            "/uploads",
            &json!({
                "key": "../elsewhere/out.png",
            }),
        )
        .unwrap_err();

        assert_eq!(error.code, "storage_readback_key_invalid");
    }

    #[test]
    fn sftp_readback_allows_legacy_remote_path_under_remote_dir() {
        let path = sftp_readback_path(
            "/uploads",
            &json!({
                "remote_path": "/uploads/job-1/out.png",
            }),
        )
        .unwrap();

        assert_eq!(path, PathBuf::from("/uploads/job-1/out.png"));
    }
}
