use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::config_types::{CredentialRef, default_true, preserve_empty_file_credential};
use crate::paths::{default_legacy_shared_codex_path, default_storage_fallback_dir};

pub(crate) fn normalized_option_text(value: &Option<String>) -> Option<String> {
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
        _ => false,
    }
}

pub(crate) fn storage_secret_source<'a>(
    name: &str,
    target: &StorageTargetConfig,
    existing: &'a StorageConfig,
) -> Option<&'a StorageTargetConfig> {
    if let Some(existing_target) = existing.targets.get(name) {
        return storage_secret_identity_matches(target, existing_target).then_some(existing_target);
    }

    let mut matches = existing
        .targets
        .values()
        .filter(|existing_target| storage_secret_identity_matches(target, existing_target));
    let first = matches.next()?;
    if matches.next().is_none() {
        Some(first)
    } else {
        None
    }
}

pub fn preserve_storage_secrets(next: &mut StorageConfig, existing: &StorageConfig) {
    for (name, target) in &mut next.targets {
        let existing_target = storage_secret_source(name, target, existing);
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
            StorageTargetConfig::Local { .. } => {}
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum StorageTargetConfig {
    Local {
        directory: PathBuf,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        public_base_url: Option<String>,
    },
    S3 {
        bucket: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        region: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        endpoint: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        prefix: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        access_key_id: Option<CredentialRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        secret_access_key: Option<CredentialRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        session_token: Option<CredentialRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        public_base_url: Option<String>,
    },
    #[serde(rename = "webdav")]
    WebDav {
        url: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        username: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        password: Option<CredentialRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        public_base_url: Option<String>,
    },
    Http {
        url: String,
        #[serde(default = "default_http_storage_method")]
        method: String,
        #[serde(default)]
        headers: BTreeMap<String, CredentialRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        public_url_json_pointer: Option<String>,
    },
    Sftp {
        host: String,
        #[serde(default = "default_sftp_port")]
        port: u16,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        host_key_sha256: Option<String>,
        username: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        password: Option<CredentialRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        private_key: Option<CredentialRef>,
        remote_dir: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        public_base_url: Option<String>,
    },
}

pub(crate) fn default_http_storage_method() -> String {
    "POST".to_string()
}

pub(crate) fn default_sftp_port() -> u16 {
    22
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum StorageFallbackPolicy {
    Never,
    OnFailure,
    Always,
}

impl Default for StorageFallbackPolicy {
    fn default() -> Self {
        Self::OnFailure
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageConfig {
    #[serde(default)]
    pub targets: BTreeMap<String, StorageTargetConfig>,
    #[serde(default)]
    pub default_targets: Vec<String>,
    #[serde(default = "default_storage_fallback_targets")]
    pub fallback_targets: Vec<String>,
    #[serde(default)]
    pub fallback_policy: StorageFallbackPolicy,
    #[serde(default = "default_storage_upload_concurrency")]
    pub upload_concurrency: usize,
    #[serde(default = "default_storage_target_concurrency")]
    pub target_concurrency: usize,
}

pub(crate) fn default_storage_fallback_targets() -> Vec<String> {
    vec!["local-default".to_string()]
}

pub(crate) fn default_storage_upload_concurrency() -> usize {
    4
}

pub(crate) fn default_storage_target_concurrency() -> usize {
    2
}

impl Default for StorageConfig {
    fn default() -> Self {
        Self {
            targets: BTreeMap::from([(
                "local-default".to_string(),
                StorageTargetConfig::Local {
                    directory: default_storage_fallback_dir(),
                    public_base_url: None,
                },
            )]),
            default_targets: Vec::new(),
            fallback_targets: default_storage_fallback_targets(),
            fallback_policy: StorageFallbackPolicy::default(),
            upload_concurrency: default_storage_upload_concurrency(),
            target_concurrency: default_storage_target_concurrency(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PathMode {
    Default,
    Custom,
}

impl Default for PathMode {
    fn default() -> Self {
        Self::Default
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
pub struct PathRef {
    #[serde(default)]
    pub mode: PathMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<PathBuf>,
}

impl Default for PathRef {
    fn default() -> Self {
        Self {
            mode: PathMode::Default,
            path: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, Ord, PartialEq, PartialOrd)]
#[serde(rename_all = "snake_case")]
pub enum ExportDirMode {
    Downloads,
    Documents,
    Pictures,
    ResultLibrary,
    Custom,
    BrowserDefault,
}

impl Default for ExportDirMode {
    fn default() -> Self {
        Self::Downloads
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
pub struct ExportDirConfig {
    #[serde(default)]
    pub mode: ExportDirMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<PathBuf>,
}

impl Default for ExportDirConfig {
    fn default() -> Self {
        Self {
            mode: ExportDirMode::Downloads,
            path: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
pub struct LegacyPathConfig {
    #[serde(default = "default_legacy_shared_codex_path")]
    pub path: PathBuf,
    #[serde(default = "default_true")]
    pub enabled_for_read: bool,
}

impl Default for LegacyPathConfig {
    fn default() -> Self {
        Self {
            path: default_legacy_shared_codex_path(),
            enabled_for_read: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq, Default)]
pub struct PathConfig {
    #[serde(default)]
    pub app_data_dir: PathRef,
    #[serde(default)]
    pub result_library_dir: PathRef,
    #[serde(default)]
    pub default_export_dir: ExportDirConfig,
    #[serde(default)]
    pub legacy_shared_codex_dir: LegacyPathConfig,
}
