#![allow(unused_imports)]

use super::*;

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) enum ProviderKind {
    OpenAi,
    Codex,
}

#[derive(Debug, Clone)]
pub(crate) struct ProviderSelection {
    pub(crate) requested: String,
    pub(crate) resolved: String,
    pub(crate) reason: String,
    pub(crate) kind: ProviderKind,
    pub(crate) api_base: String,
    pub(crate) codex_endpoint: String,
    pub(crate) default_model: String,
    pub(crate) supports_n: bool,
    pub(crate) edit_region_mode: String,
    pub(crate) preset: String,
    pub(crate) image_transport: String,
    pub(crate) poll_interval_seconds: u64,
    pub(crate) poll_timeout_seconds: u64,
}

impl ProviderSelection {
    pub(crate) fn payload(&self) -> Value {
        json!({
            "requested": self.requested,
            "resolved": self.resolved,
            "kind": match self.kind {
                ProviderKind::OpenAi => "openai-compatible",
                ProviderKind::Codex => "codex",
            },
            "reason": self.reason,
            "supports_n": self.supports_n,
            "edit_region_mode": self.edit_region_mode,
            "preset": self.preset,
            "image_transport": self.image_transport,
            "poll_interval_seconds": self.poll_interval_seconds,
            "poll_timeout_seconds": self.poll_timeout_seconds,
        })
    }
}

pub const PROVIDER_PRESET_OPENAI: &str = "openai";
pub const PROVIDER_PRESET_NEW_API: &str = "new-api";
pub const PROVIDER_PRESET_SUB2API: &str = "sub2api";
pub const PROVIDER_PRESET_CUSTOM: &str = "custom";

pub const IMAGE_TRANSPORT_OPENAI_SYNC: &str = "openai-sync";
pub const IMAGE_TRANSPORT_SUB2API_ASYNC: &str = "sub2api-async";

pub const DEFAULT_IMAGE_POLL_INTERVAL_SECONDS: u64 = 3;
pub const DEFAULT_IMAGE_POLL_TIMEOUT_SECONDS: u64 = 1_800;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProviderConfig {
    #[serde(rename = "type")]
    pub provider_type: String,
    #[serde(default)]
    pub api_base: Option<String>,
    #[serde(default)]
    pub endpoint: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub credentials: BTreeMap<String, CredentialRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supports_n: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edit_region_mode: Option<String>,
    /// UI/service preset. This selects defaults and explanatory copy only;
    /// runtime request behavior is controlled by `image_transport`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preset: Option<String>,
    /// Image request protocol. Missing values preserve the historical
    /// OpenAI-compatible synchronous request behavior.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_transport: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub poll_interval_seconds: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub poll_timeout_seconds: Option<u64>,
    /// Per-provider proxy override. `None` inherits the global proxy;
    /// `Some(mode = none)` forces a direct connection for this provider.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proxy: Option<ProxyConfig>,
}
