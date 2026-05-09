#![allow(unused_imports)]

use super::*;

#[derive(Debug, Deserialize)]
pub(crate) struct ProviderInput {
    #[serde(rename = "type")]
    pub(crate) provider_type: String,
    #[serde(default)]
    pub(crate) api_base: Option<String>,
    #[serde(default)]
    pub(crate) endpoint: Option<String>,
    #[serde(default)]
    pub(crate) model: Option<String>,
    #[serde(default)]
    pub(crate) credentials: BTreeMap<String, CredentialInput>,
    #[serde(default)]
    pub(crate) supports_n: Option<bool>,
    #[serde(default)]
    pub(crate) edit_region_mode: Option<String>,
    #[serde(default)]
    pub(crate) set_default: bool,
    #[serde(default)]
    pub(crate) allow_overwrite: bool,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "source", rename_all = "lowercase")]
pub(crate) enum CredentialInput {
    File {
        #[serde(default)]
        value: Option<String>,
    },
    Env {
        env: String,
    },
    Keychain {
        #[serde(default)]
        service: Option<String>,
        #[serde(default)]
        account: Option<String>,
        #[serde(default)]
        value: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct DroppedImageFile {
    pub(crate) name: String,
    pub(crate) mime: String,
    pub(crate) bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct DroppedImageFiles {
    pub(crate) files: Vec<DroppedImageFile>,
    pub(crate) ignored: usize,
}
