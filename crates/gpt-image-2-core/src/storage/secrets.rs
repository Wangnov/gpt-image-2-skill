use crate::CredentialRef;
use std::collections::BTreeSet;

use super::{
    BaiduNetdiskAuthMode, Pan123OpenAuthMode, StorageConfig, StorageTargetConfig,
    effective_baidu_netdisk_auth_mode, effective_pan123_open_auth_mode,
};

fn preserve_empty_file_credential(next: &mut CredentialRef, existing: Option<&CredentialRef>) {
    if let CredentialRef::File { value: next_value } = next
        && next_value.is_empty()
        && let Some(CredentialRef::File {
            value: existing_value,
        }) = existing
    {
        *next_value = existing_value.clone();
    }
}

fn normalized_option_text(value: &Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

pub(crate) fn storage_secret_identity_matches(
    next: &StorageTargetConfig,
    existing: &StorageTargetConfig,
) -> bool {
    match (next, existing) {
        (
            StorageTargetConfig::S3 {
                bucket,
                region,
                endpoint,
                prefix,
                ..
            },
            StorageTargetConfig::S3 {
                bucket: existing_bucket,
                region: existing_region,
                endpoint: existing_endpoint,
                prefix: existing_prefix,
                ..
            },
        ) => {
            bucket.trim() == existing_bucket.trim()
                && normalized_option_text(region) == normalized_option_text(existing_region)
                && normalized_option_text(endpoint) == normalized_option_text(existing_endpoint)
                && normalized_option_text(prefix) == normalized_option_text(existing_prefix)
        }
        (
            StorageTargetConfig::WebDav { url, username, .. },
            StorageTargetConfig::WebDav {
                url: existing_url,
                username: existing_username,
                ..
            },
        ) => {
            url.trim() == existing_url.trim()
                && normalized_option_text(username) == normalized_option_text(existing_username)
        }
        (
            StorageTargetConfig::Http { url, method, .. },
            StorageTargetConfig::Http {
                url: existing_url,
                method: existing_method,
                ..
            },
        ) => {
            url.trim() == existing_url.trim()
                && method.trim().eq_ignore_ascii_case(existing_method.trim())
        }
        (
            StorageTargetConfig::Sftp {
                host,
                port,
                username,
                remote_dir,
                host_key_sha256,
                ..
            },
            StorageTargetConfig::Sftp {
                host: existing_host,
                port: existing_port,
                username: existing_username,
                remote_dir: existing_remote_dir,
                host_key_sha256: existing_host_key_sha256,
                ..
            },
        ) => {
            host.trim() == existing_host.trim()
                && port == existing_port
                && username.trim() == existing_username.trim()
                && remote_dir.trim() == existing_remote_dir.trim()
                && normalized_option_text(host_key_sha256)
                    == normalized_option_text(existing_host_key_sha256)
        }
        (
            StorageTargetConfig::BaiduNetdisk {
                auth_mode,
                app_key,
                access_token,
                ..
            },
            StorageTargetConfig::BaiduNetdisk {
                auth_mode: existing_auth_mode,
                app_key: existing_app_key,
                access_token: existing_access_token,
                ..
            },
        ) => {
            let mode = effective_baidu_netdisk_auth_mode(*auth_mode, access_token.as_ref());
            let existing_mode = effective_baidu_netdisk_auth_mode(
                *existing_auth_mode,
                existing_access_token.as_ref(),
            );
            mode == existing_mode
                && match mode {
                    BaiduNetdiskAuthMode::Personal => true,
                    BaiduNetdiskAuthMode::Oauth => app_key.trim() == existing_app_key.trim(),
                }
        }
        (
            StorageTargetConfig::Pan123Open {
                auth_mode,
                client_id,
                access_token,
                ..
            },
            StorageTargetConfig::Pan123Open {
                auth_mode: existing_auth_mode,
                client_id: existing_client_id,
                access_token: existing_access_token,
                ..
            },
        ) => {
            let mode = effective_pan123_open_auth_mode(*auth_mode, access_token.as_ref());
            let existing_mode = effective_pan123_open_auth_mode(
                *existing_auth_mode,
                existing_access_token.as_ref(),
            );
            mode == existing_mode
                && match mode {
                    Pan123OpenAuthMode::AccessToken => true,
                    Pan123OpenAuthMode::Client => client_id.trim() == existing_client_id.trim(),
                }
        }
        _ => false,
    }
}

fn storage_secret_rename_identity_matches(
    next: &StorageTargetConfig,
    existing: &StorageTargetConfig,
) -> bool {
    storage_secret_identity_matches(next, existing)
}

fn storage_secret_source<'a>(
    name: &str,
    target: &StorageTargetConfig,
    next_names: &BTreeSet<String>,
    existing: &'a StorageConfig,
) -> Option<&'a StorageTargetConfig> {
    if let Some(existing_target) = existing.targets.get(name)
        && storage_secret_identity_matches(target, existing_target)
    {
        return Some(existing_target);
    }

    let mut matches = existing
        .targets
        .iter()
        .filter(|(existing_name, _)| {
            existing_name.as_str() != name && !next_names.contains(existing_name.as_str())
        })
        .map(|(_, existing_target)| existing_target)
        .filter(|existing_target| storage_secret_rename_identity_matches(target, existing_target));
    let first = matches.next()?;
    if matches.next().is_none() {
        Some(first)
    } else {
        None
    }
}

pub fn preserve_storage_secrets(next: &mut StorageConfig, existing: &StorageConfig) {
    let next_names = next.targets.keys().cloned().collect::<BTreeSet<_>>();
    for (name, target) in &mut next.targets {
        let existing_target = storage_secret_source(name, target, &next_names, existing);
        match target {
            StorageTargetConfig::S3 {
                access_key_id,
                secret_access_key,
                session_token,
                ..
            } => {
                let (existing_access_key_id, existing_secret_access_key, existing_session_token) =
                    match existing_target {
                        Some(StorageTargetConfig::S3 {
                            access_key_id,
                            secret_access_key,
                            session_token,
                            ..
                        }) => (
                            access_key_id.as_ref(),
                            secret_access_key.as_ref(),
                            session_token.as_ref(),
                        ),
                        _ => (None, None, None),
                    };
                if let Some(credential) = access_key_id.as_mut() {
                    preserve_empty_file_credential(credential, existing_access_key_id);
                }
                if let Some(credential) = secret_access_key.as_mut() {
                    preserve_empty_file_credential(credential, existing_secret_access_key);
                }
                if let Some(credential) = session_token.as_mut() {
                    preserve_empty_file_credential(credential, existing_session_token);
                }
            }
            StorageTargetConfig::WebDav { password, .. } => {
                let existing_password = match existing_target {
                    Some(StorageTargetConfig::WebDav { password, .. }) => password.as_ref(),
                    _ => None,
                };
                if let Some(credential) = password.as_mut() {
                    preserve_empty_file_credential(credential, existing_password);
                }
            }
            StorageTargetConfig::Http { headers, .. } => {
                let existing_headers = match existing_target {
                    Some(StorageTargetConfig::Http { headers, .. }) => Some(headers),
                    _ => None,
                };
                for (header, credential) in headers {
                    let existing_credential =
                        existing_headers.and_then(|headers| headers.get(header));
                    preserve_empty_file_credential(credential, existing_credential);
                }
            }
            StorageTargetConfig::Sftp {
                password,
                private_key,
                ..
            } => {
                let (existing_password, existing_private_key) = match existing_target {
                    Some(StorageTargetConfig::Sftp {
                        password,
                        private_key,
                        ..
                    }) => (password.as_ref(), private_key.as_ref()),
                    _ => (None, None),
                };
                if let Some(credential) = password.as_mut() {
                    preserve_empty_file_credential(credential, existing_password);
                }
                if let Some(credential) = private_key.as_mut() {
                    preserve_empty_file_credential(credential, existing_private_key);
                }
            }
            StorageTargetConfig::BaiduNetdisk {
                secret_key,
                access_token,
                refresh_token,
                ..
            } => {
                let (existing_secret_key, existing_access_token, existing_refresh_token) =
                    match existing_target {
                        Some(StorageTargetConfig::BaiduNetdisk {
                            secret_key,
                            access_token,
                            refresh_token,
                            ..
                        }) => (
                            secret_key.as_ref(),
                            access_token.as_ref(),
                            refresh_token.as_ref(),
                        ),
                        _ => (None, None, None),
                    };
                if let Some(credential) = secret_key.as_mut() {
                    preserve_empty_file_credential(credential, existing_secret_key);
                }
                if let Some(credential) = access_token.as_mut() {
                    preserve_empty_file_credential(credential, existing_access_token);
                }
                if let Some(credential) = refresh_token.as_mut() {
                    preserve_empty_file_credential(credential, existing_refresh_token);
                }
            }
            StorageTargetConfig::Pan123Open {
                client_secret,
                access_token,
                ..
            } => {
                let (existing_client_secret, existing_access_token) = match existing_target {
                    Some(StorageTargetConfig::Pan123Open {
                        client_secret,
                        access_token,
                        ..
                    }) => (client_secret.as_ref(), access_token.as_ref()),
                    _ => (None, None),
                };
                if let Some(credential) = client_secret.as_mut() {
                    preserve_empty_file_credential(credential, existing_client_secret);
                }
                if let Some(credential) = access_token.as_mut() {
                    preserve_empty_file_credential(credential, existing_access_token);
                }
            }
            StorageTargetConfig::Local { .. } => {}
        }
    }
}
