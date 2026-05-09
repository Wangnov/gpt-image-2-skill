#![allow(unused_imports)]

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

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
        }
    }
}
