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
        })
    }
}

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
}
