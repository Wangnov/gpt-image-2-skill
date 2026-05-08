#![allow(unused_imports)]

use super::*;

#[derive(Debug, Clone)]
pub struct CodexAuthState {
    pub auth_path: PathBuf,
    pub auth_json: Value,
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub account_id: String,
    pub persistence: CodexAuthPersistence,
}

#[derive(Debug, Clone)]
pub enum CodexAuthPersistence {
    AuthFile,
    ConfigProvider {
        config_path: PathBuf,
        provider_name: String,
        credential_sources: BTreeMap<String, CredentialRef>,
    },
    SessionOnly,
}

#[derive(Debug, Clone)]
pub struct OpenAiAuthState {
    pub api_key: String,
    pub source: String,
}
