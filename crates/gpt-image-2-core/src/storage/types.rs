use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::{CredentialRef, default_storage_fallback_dir};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum BaiduNetdiskAuthMode {
    Personal,
    Oauth,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Pan123OpenAuthMode {
    Client,
    AccessToken,
}

pub fn effective_baidu_netdisk_auth_mode(
    auth_mode: Option<BaiduNetdiskAuthMode>,
    access_token: Option<&CredentialRef>,
) -> BaiduNetdiskAuthMode {
    auth_mode.unwrap_or_else(|| {
        if access_token.is_some() {
            BaiduNetdiskAuthMode::Personal
        } else {
            BaiduNetdiskAuthMode::Oauth
        }
    })
}

pub fn effective_pan123_open_auth_mode(
    auth_mode: Option<Pan123OpenAuthMode>,
    access_token: Option<&CredentialRef>,
) -> Pan123OpenAuthMode {
    auth_mode.unwrap_or_else(|| {
        if access_token.is_some() {
            Pan123OpenAuthMode::AccessToken
        } else {
            Pan123OpenAuthMode::Client
        }
    })
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
    #[serde(rename = "baidu_netdisk")]
    BaiduNetdisk {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        auth_mode: Option<BaiduNetdiskAuthMode>,
        app_key: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        secret_key: Option<CredentialRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        access_token: Option<CredentialRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        refresh_token: Option<CredentialRef>,
        app_name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        remote_dir: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        public_base_url: Option<String>,
    },
    #[serde(rename = "pan123_open")]
    Pan123Open {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        auth_mode: Option<Pan123OpenAuthMode>,
        client_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        client_secret: Option<CredentialRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        access_token: Option<CredentialRef>,
        #[serde(default)]
        parent_id: u64,
        #[serde(default)]
        use_direct_link: bool,
    },
}

fn default_http_storage_method() -> String {
    "POST".to_string()
}

fn default_sftp_port() -> u16 {
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

fn default_storage_fallback_targets() -> Vec<String> {
    vec!["local-default".to_string()]
}

fn default_storage_upload_concurrency() -> usize {
    4
}

fn default_storage_target_concurrency() -> usize {
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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn netdisk_auth_mode_is_serialized_for_explicit_configs() {
        let baidu = StorageTargetConfig::BaiduNetdisk {
            auth_mode: Some(BaiduNetdiskAuthMode::Personal),
            app_key: String::new(),
            secret_key: None,
            access_token: Some(CredentialRef::File {
                value: "token".to_string(),
            }),
            refresh_token: None,
            app_name: "gpt-image-2".to_string(),
            remote_dir: None,
            public_base_url: None,
        };
        let pan123 = StorageTargetConfig::Pan123Open {
            auth_mode: Some(Pan123OpenAuthMode::AccessToken),
            client_id: String::new(),
            client_secret: None,
            access_token: Some(CredentialRef::File {
                value: "token".to_string(),
            }),
            parent_id: 0,
            use_direct_link: false,
        };

        assert_eq!(
            serde_json::to_value(baidu).unwrap()["auth_mode"],
            json!("personal")
        );
        assert_eq!(
            serde_json::to_value(pan123).unwrap()["auth_mode"],
            json!("access_token")
        );
    }

    #[test]
    fn netdisk_auth_mode_can_be_inferred_for_legacy_configs() {
        let baidu: StorageTargetConfig = serde_json::from_value(json!({
            "type": "baidu_netdisk",
            "app_key": "app-key",
            "secret_key": {"source": "file", "value": "secret"},
            "refresh_token": {"source": "file", "value": "refresh"},
            "app_name": "gpt-image-2"
        }))
        .unwrap();
        let pan123: StorageTargetConfig = serde_json::from_value(json!({
            "type": "pan123_open",
            "client_id": "",
            "access_token": {"source": "file", "value": "access"}
        }))
        .unwrap();

        let StorageTargetConfig::BaiduNetdisk {
            auth_mode,
            access_token,
            ..
        } = &baidu
        else {
            panic!("expected baidu target");
        };
        let StorageTargetConfig::Pan123Open {
            auth_mode: pan123_auth_mode,
            access_token: pan123_access_token,
            ..
        } = &pan123
        else {
            panic!("expected 123 target");
        };

        assert_eq!(
            effective_baidu_netdisk_auth_mode(*auth_mode, access_token.as_ref()),
            BaiduNetdiskAuthMode::Oauth
        );
        assert_eq!(
            effective_pan123_open_auth_mode(*pan123_auth_mode, pan123_access_token.as_ref()),
            Pan123OpenAuthMode::AccessToken
        );
    }
}
