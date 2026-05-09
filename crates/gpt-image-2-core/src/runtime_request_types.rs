#![allow(unused_imports)]

use super::*;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct GenerateRequest {
    pub prompt: String,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub size: Option<String>,
    #[serde(default)]
    pub format: Option<String>,
    #[serde(default)]
    pub quality: Option<String>,
    #[serde(default)]
    pub background: Option<String>,
    #[serde(default)]
    pub n: Option<u8>,
    #[serde(default)]
    pub compression: Option<u8>,
    #[serde(default)]
    pub moderation: Option<String>,
    #[serde(default)]
    pub storage_targets: Option<Vec<String>>,
    #[serde(default)]
    pub fallback_targets: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UploadFile {
    pub name: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EditRequest {
    pub prompt: String,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub size: Option<String>,
    #[serde(default)]
    pub format: Option<String>,
    #[serde(default)]
    pub quality: Option<String>,
    #[serde(default)]
    pub background: Option<String>,
    #[serde(default)]
    pub n: Option<u8>,
    #[serde(default)]
    pub compression: Option<u8>,
    #[serde(default)]
    pub input_fidelity: Option<String>,
    #[serde(default)]
    pub moderation: Option<String>,
    #[serde(default)]
    pub storage_targets: Option<Vec<String>>,
    #[serde(default)]
    pub fallback_targets: Option<Vec<String>>,
    pub refs: Vec<UploadFile>,
    #[serde(default)]
    pub mask: Option<UploadFile>,
    #[serde(default)]
    pub selection_hint: Option<UploadFile>,
}
