#![allow(unused_imports)]

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::logging::LoggingConfig;
use crate::notifications::NotificationConfig;
use crate::provider_types::ProviderConfig;
use crate::storage::StorageConfig;
use crate::storage_config::PathConfig;

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
#[serde(tag = "source", rename_all = "lowercase")]
pub enum CredentialRef {
    File {
        value: String,
    },
    Env {
        env: String,
    },
    Keychain {
        service: Option<String>,
        account: String,
    },
}

/// How outbound HTTP requests pick a proxy.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProxyMode {
    /// Inherit from the environment (`HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`NO_PROXY`).
    /// This is the default and preserves reqwest's built-in behavior.
    #[default]
    System,
    /// Force a direct connection, ignoring any environment proxy.
    None,
    /// Use the explicit `url` (and `no_proxy`) below.
    Custom,
}

/// Proxy settings for outbound provider/API traffic. `no_proxy` only applies in
/// `Custom` mode (in `System` mode the environment's `NO_PROXY` governs).
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct ProxyConfig {
    #[serde(default)]
    pub mode: ProxyMode,
    /// `scheme://[user:pass@]host:port` where scheme is http/https/socks5/socks5h.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Hostnames/domains to bypass the proxy for (Custom mode only).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub no_proxy: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub version: u32,
    #[serde(default)]
    pub default_provider: Option<String>,
    #[serde(default)]
    pub providers: BTreeMap<String, ProviderConfig>,
    #[serde(default)]
    pub notifications: NotificationConfig,
    #[serde(default)]
    pub storage: StorageConfig,
    #[serde(default)]
    pub paths: PathConfig,
    #[serde(default)]
    pub proxy: ProxyConfig,
    #[serde(default)]
    pub logging: LoggingConfig,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            version: 1,
            default_provider: None,
            providers: BTreeMap::new(),
            notifications: NotificationConfig::default(),
            storage: StorageConfig::default(),
            paths: PathConfig::default(),
            proxy: ProxyConfig::default(),
            logging: LoggingConfig::default(),
        }
    }
}
