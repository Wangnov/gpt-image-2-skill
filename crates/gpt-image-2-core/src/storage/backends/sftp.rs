use std::fs;
use std::io::Write;
use std::net::TcpStream;
use std::path::{Path, PathBuf};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde_json::json;
use sha2::{Digest, Sha256};
use ssh2::Session;

use crate::{resolve_credential, validate_remote_tcp_target};

use super::super::types::StorageTargetConfig;
use super::super::util::*;
use crate::{AppError, CredentialRef};

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
    let tcp = TcpStream::connect(addrs.as_slice()).map_err(|error| {
        AppError::new(
            "storage_sftp_connect_failed",
            "Unable to connect to SFTP server.",
        )
        .with_detail(json!({"host": host, "port": port, "error": error.to_string()}))
    })?;
    let mut session = Session::new().map_err(|error| {
        AppError::new(
            "storage_sftp_session_failed",
            "Unable to create SFTP session.",
        )
        .with_detail(json!({"error": error.to_string()}))
    })?;
    session.set_tcp_stream(tcp);
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
        session
            .userauth_pubkey_memory(username, None, &private_key, passphrase.as_deref())
            .map_err(|error| {
                AppError::new("storage_sftp_auth_failed", "SFTP private-key auth failed.")
                    .with_detail(
                        json!({"host": host, "username": username, "error": error.to_string()}),
                    )
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
