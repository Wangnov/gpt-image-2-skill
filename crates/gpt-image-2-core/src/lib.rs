use std::fs;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use std::{collections::BTreeMap, process::Command, sync::mpsc, thread};

use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use chrono::Utc;
use clap::{ArgAction, Args, Parser, Subcommand, ValueEnum};
use hmac::{Hmac, Mac};
use lettre::message::{Mailbox, header::ContentType};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{Message, SmtpTransport, Transport};
use reqwest::StatusCode;
use reqwest::blocking::multipart::{Form, Part};
use reqwest::blocking::{Client, Response};
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderName, HeaderValue};
use rusqlite::types::Value as SqlValue;
use rusqlite::{Connection, Row, params, params_from_iter};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use ssh2::Session;
use url::Url;

mod transparent;

pub const CLI_NAME: &str = "gpt-image-2-skill";
pub const OPENAI_API_KEY_ENV: &str = "OPENAI_API_KEY";
pub const DEFAULT_CODEX_ENDPOINT: &str = "https://chatgpt.com/backend-api/codex/responses";
pub const DEFAULT_OPENAI_API_BASE: &str = "https://api.openai.com/v1";
pub const OPENAI_GENERATIONS_PATH: &str = "/images/generations";
pub const OPENAI_EDITS_PATH: &str = "/images/edits";
pub const DEFAULT_CODEX_MODEL: &str = "gpt-5.4";
pub const DEFAULT_OPENAI_MODEL: &str = "gpt-image-2";
pub const DEFAULT_INSTRUCTIONS: &str = "You are a concise assistant.";
pub const DEFAULT_BACKGROUND: &str = "auto";
pub const DEFAULT_RETRY_COUNT: usize = 3;
pub const DEFAULT_RETRY_DELAY_SECONDS: u64 = 1;
pub const DEFAULT_REQUEST_TIMEOUT: u64 = 300;
pub const DEFAULT_REFRESH_TIMEOUT: u64 = 60;
pub const ENDPOINT_CHECK_TIMEOUT: u64 = 5;
pub const IMAGE_SIZE_MAX_EDGE: u32 = 3840;
pub const IMAGE_SIZE_MIN_TOTAL_PIXELS: u32 = 655_360;
pub const IMAGE_SIZE_MAX_TOTAL_PIXELS: u32 = 8_294_400;
pub const IMAGE_SIZE_MAX_ASPECT_RATIO: f64 = 3.0;
pub const MAX_REFERENCE_IMAGES: usize = 16;
pub const REFRESH_ENDPOINT: &str = "https://auth.openai.com/oauth/token";
pub const REFRESH_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
pub const DELEGATED_IMAGE_MODEL: &str = "gpt-image-2";
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
pub const CONFIG_DIR_NAME: &str = "gpt-image-2-skill";
pub const CONFIG_FILE_NAME: &str = "config.json";
pub const HISTORY_FILE_NAME: &str = "history.sqlite";
pub const JOBS_DIR_NAME: &str = "jobs";
pub const PRODUCT_DIR_NAME: &str = "gpt-image-2";
pub const RESULTS_DIR_NAME: &str = "results";
pub const EXPORTS_DIR_NAME: &str = "exports";
pub const KEYCHAIN_SERVICE: &str = "gpt-image-2-skill";
pub const DEFAULT_HISTORY_PAGE_LIMIT: usize = 100;
pub const MAX_HISTORY_PAGE_LIMIT: usize = 200;

#[derive(Debug, Clone)]
pub struct AppError {
    pub code: String,
    pub message: String,
    pub detail: Option<Value>,
    pub exit_status: i32,
    pub status_code: Option<u16>,
}

impl AppError {
    fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            detail: None,
            exit_status: 1,
            status_code: None,
        }
    }

    fn with_detail(mut self, detail: Value) -> Self {
        self.detail = Some(detail);
        self
    }

    fn with_exit_status(mut self, exit_status: i32) -> Self {
        self.exit_status = exit_status;
        self
    }

    fn with_status_code(mut self, status_code: u16) -> Self {
        self.status_code = Some(status_code);
        self
    }
}

#[derive(Debug, Serialize)]
pub struct CommandOutcome {
    pub payload: Value,
    pub exit_status: i32,
}

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

#[derive(Debug, Clone, Eq, PartialEq)]
enum ProviderKind {
    OpenAi,
    Codex,
}

#[derive(Debug, Clone)]
struct ProviderSelection {
    requested: String,
    resolved: String,
    reason: String,
    kind: ProviderKind,
    api_base: String,
    codex_endpoint: String,
    default_model: String,
    supports_n: bool,
    edit_region_mode: String,
}

impl ProviderSelection {
    fn payload(&self) -> Value {
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

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum EmailTlsMode {
    StartTls,
    Smtps,
    None,
}

impl Default for EmailTlsMode {
    fn default() -> Self {
        Self::StartTls
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
pub struct ToastNotificationConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
}

impl Default for ToastNotificationConfig {
    fn default() -> Self {
        Self { enabled: true }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
pub struct SystemNotificationConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_system_notification_mode")]
    pub mode: String,
}

fn default_system_notification_mode() -> String {
    "auto".to_string()
}

impl Default for SystemNotificationConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            mode: default_system_notification_mode(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
pub struct EmailNotificationConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub smtp_host: String,
    #[serde(default = "default_smtp_port")]
    pub smtp_port: u16,
    #[serde(default)]
    pub tls: EmailTlsMode,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<CredentialRef>,
    #[serde(default)]
    pub from: String,
    #[serde(default)]
    pub to: Vec<String>,
    #[serde(default = "default_notification_timeout_seconds")]
    pub timeout_seconds: u64,
}

fn default_smtp_port() -> u16 {
    587
}

impl Default for EmailNotificationConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            smtp_host: String::new(),
            smtp_port: default_smtp_port(),
            tls: EmailTlsMode::StartTls,
            username: None,
            password: None,
            from: String::new(),
            to: Vec::new(),
            timeout_seconds: default_notification_timeout_seconds(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
pub struct WebhookNotificationConfig {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub url: String,
    #[serde(default = "default_webhook_method")]
    pub method: String,
    #[serde(default)]
    pub headers: BTreeMap<String, CredentialRef>,
    #[serde(default = "default_notification_timeout_seconds")]
    pub timeout_seconds: u64,
}

fn default_webhook_method() -> String {
    "POST".to_string()
}

fn default_notification_timeout_seconds() -> u64 {
    10
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
pub struct NotificationConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_true")]
    pub on_completed: bool,
    #[serde(default = "default_true")]
    pub on_failed: bool,
    #[serde(default = "default_true")]
    pub on_cancelled: bool,
    #[serde(default)]
    pub toast: ToastNotificationConfig,
    #[serde(default)]
    pub system: SystemNotificationConfig,
    #[serde(default)]
    pub email: EmailNotificationConfig,
    #[serde(default)]
    pub webhooks: Vec<WebhookNotificationConfig>,
}

impl Default for NotificationConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            on_completed: true,
            on_failed: true,
            on_cancelled: true,
            toast: ToastNotificationConfig::default(),
            system: SystemNotificationConfig::default(),
            email: EmailNotificationConfig::default(),
            webhooks: Vec::new(),
        }
    }
}

fn preserve_empty_file_credential(next: &mut CredentialRef, existing: Option<&CredentialRef>) {
    if let CredentialRef::File { value: next_value } = next {
        if next_value.is_empty()
            && let Some(CredentialRef::File {
                value: existing_value,
            }) = existing
        {
            *next_value = existing_value.clone();
        }
    }
}

fn normalized_option_text(value: &Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn storage_secret_identity_matches(
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

fn storage_secret_source<'a>(
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

pub fn preserve_notification_secrets(next: &mut NotificationConfig, existing: &NotificationConfig) {
    if let Some(next_password) = next.email.password.as_mut() {
        preserve_empty_file_credential(next_password, existing.email.password.as_ref());
    }

    let existing_webhooks = existing
        .webhooks
        .iter()
        .map(|webhook| (webhook.id.as_str(), webhook))
        .collect::<BTreeMap<_, _>>();
    for webhook in &mut next.webhooks {
        let existing_webhook = existing_webhooks.get(webhook.id.as_str()).copied();
        for (header, credential) in &mut webhook.headers {
            let existing_credential =
                existing_webhook.and_then(|webhook| webhook.headers.get(header));
            preserve_empty_file_credential(credential, existing_credential);
        }
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

#[derive(Debug, Clone, Copy, Eq, PartialEq, ValueEnum)]
pub enum Background {
    Auto,
    Transparent,
    Opaque,
}

impl Background {
    fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Transparent => "transparent",
            Self::Opaque => "opaque",
        }
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, ValueEnum)]
pub enum Quality {
    Auto,
    Low,
    Medium,
    High,
}

impl Quality {
    fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
        }
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, ValueEnum)]
pub enum OutputFormat {
    Png,
    Jpeg,
    Webp,
}

impl OutputFormat {
    fn as_str(self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Jpeg => "jpeg",
            Self::Webp => "webp",
        }
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, ValueEnum)]
pub enum Moderation {
    Auto,
    Low,
}

impl Moderation {
    fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Low => "low",
        }
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, ValueEnum)]
pub enum InputFidelity {
    High,
    Low,
}

impl InputFidelity {
    fn as_str(self) -> &'static str {
        match self {
            Self::High => "high",
            Self::Low => "low",
        }
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, ValueEnum)]
pub enum RequestOperation {
    Responses,
    Generate,
    Edit,
}

impl RequestOperation {
    fn as_str(self) -> &'static str {
        match self {
            Self::Responses => "responses",
            Self::Generate => "generate",
            Self::Edit => "edit",
        }
    }
}

#[derive(Parser, Debug)]
#[command(name = CLI_NAME, version = VERSION, about = "Agent-first GPT Image 2 CLI through OpenAI or Codex auth.")]
pub struct Cli {
    #[arg(long, action = ArgAction::SetTrue, default_value_t = true)]
    pub json: bool,
    #[arg(long, default_value = "auto")]
    pub provider: String,
    #[arg(long)]
    pub api_key: Option<String>,
    #[arg(long)]
    pub config: Option<String>,
    #[arg(long, default_value_t = default_auth_path().display().to_string())]
    pub auth_file: String,
    #[arg(long, default_value = DEFAULT_CODEX_ENDPOINT)]
    pub endpoint: String,
    #[arg(long, default_value = DEFAULT_OPENAI_API_BASE)]
    pub openai_api_base: String,
    #[arg(long, action = ArgAction::SetTrue)]
    pub json_events: bool,
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand, Debug)]
pub enum Commands {
    Doctor,
    Auth(AuthCommand),
    Config(ConfigCommand),
    Secret(SecretCommand),
    History(HistoryCommand),
    Models(ModelsCommand),
    Images(ImagesCommand),
    Transparent(transparent::TransparentCommand),
    Request(RequestCommand),
}

#[derive(Args, Debug)]
pub struct AuthCommand {
    #[command(subcommand)]
    pub auth_command: AuthSubcommand,
}

#[derive(Subcommand, Debug)]
pub enum AuthSubcommand {
    Inspect,
}

#[derive(Args, Debug)]
pub struct ConfigCommand {
    #[command(subcommand)]
    pub config_command: ConfigSubcommand,
}

#[derive(Subcommand, Debug)]
pub enum ConfigSubcommand {
    Path,
    Inspect,
    ListProviders,
    SetDefault(SetDefaultArgs),
    AddProvider(Box<AddProviderArgs>),
    RemoveProvider(RemoveProviderArgs),
    TestProvider(TestProviderArgs),
}

#[derive(Args, Debug)]
pub struct SetDefaultArgs {
    pub name: String,
}

#[derive(Args, Debug)]
pub struct AddProviderArgs {
    #[arg(long)]
    pub name: String,
    #[arg(long = "type", default_value = "openai-compatible")]
    pub provider_type: String,
    #[arg(long)]
    pub api_base: Option<String>,
    #[arg(long)]
    pub endpoint: Option<String>,
    #[arg(long)]
    pub model: Option<String>,
    #[arg(long)]
    pub api_key: Option<String>,
    #[arg(long)]
    pub api_key_env: Option<String>,
    #[arg(long)]
    pub account_id: Option<String>,
    #[arg(long)]
    pub access_token: Option<String>,
    #[arg(long)]
    pub refresh_token: Option<String>,
    #[arg(long, action = ArgAction::SetTrue)]
    pub supports_n: bool,
    #[arg(long, action = ArgAction::SetTrue)]
    pub no_supports_n: bool,
    #[arg(long)]
    pub edit_region_mode: Option<String>,
    #[arg(long, action = ArgAction::SetTrue)]
    pub set_default: bool,
}

#[derive(Args, Debug)]
pub struct RemoveProviderArgs {
    pub name: String,
}

#[derive(Args, Debug)]
pub struct TestProviderArgs {
    pub name: String,
}

#[derive(Args, Debug)]
pub struct SecretCommand {
    #[command(subcommand)]
    pub secret_command: SecretSubcommand,
}

#[derive(Subcommand, Debug)]
pub enum SecretSubcommand {
    Set(SecretSetArgs),
    Get(SecretGetArgs),
    Delete(SecretDeleteArgs),
}

#[derive(Args, Debug)]
pub struct SecretSetArgs {
    pub provider: String,
    pub name: String,
    #[arg(long, default_value = "file")]
    pub source: String,
    #[arg(long)]
    pub value: Option<String>,
    #[arg(long)]
    pub env: Option<String>,
    #[arg(long)]
    pub account: Option<String>,
}

#[derive(Args, Debug)]
pub struct SecretGetArgs {
    pub provider: String,
    pub name: String,
    #[arg(long, action = ArgAction::SetTrue)]
    pub status: bool,
}

#[derive(Args, Debug)]
pub struct SecretDeleteArgs {
    pub provider: String,
    pub name: String,
}

#[derive(Args, Debug)]
pub struct HistoryCommand {
    #[command(subcommand)]
    pub history_command: HistorySubcommand,
}

#[derive(Subcommand, Debug)]
pub enum HistorySubcommand {
    List,
    Show(HistoryShowArgs),
    OpenOutput(HistoryShowArgs),
    Delete(HistoryShowArgs),
}

#[derive(Args, Debug)]
pub struct HistoryShowArgs {
    pub job_id: String,
}

#[derive(Args, Debug)]
pub struct ModelsCommand {
    #[command(subcommand)]
    pub models_command: ModelsSubcommand,
}

#[derive(Subcommand, Debug)]
pub enum ModelsSubcommand {
    List,
}

#[derive(Args, Debug, Clone)]
pub struct SharedImageArgs {
    #[arg(long)]
    pub prompt: String,
    #[arg(long)]
    pub out: String,
    #[arg(short = 'm', long)]
    pub model: Option<String>,
    #[arg(long, default_value = DEFAULT_INSTRUCTIONS)]
    pub instructions: String,
    #[arg(long, value_enum, default_value = DEFAULT_BACKGROUND)]
    pub background: Background,
    #[arg(long, value_parser = parse_image_size)]
    pub size: Option<String>,
    #[arg(long, value_enum)]
    pub quality: Option<Quality>,
    #[arg(long = "format", value_enum)]
    pub output_format: Option<OutputFormat>,
    #[arg(long = "compression", value_parser = clap::value_parser!(u8).range(0..=100))]
    pub output_compression: Option<u8>,
    #[arg(long, value_parser = clap::value_parser!(u8).range(1..=10))]
    pub n: Option<u8>,
    #[arg(long, value_enum)]
    pub moderation: Option<Moderation>,
}

#[derive(Args, Debug)]
pub struct ImagesCommand {
    #[command(subcommand)]
    pub images_command: ImagesSubcommand,
}

#[derive(Subcommand, Debug)]
pub enum ImagesSubcommand {
    Generate(GenerateImageArgs),
    Edit(EditImageArgs),
}

#[derive(Args, Debug, Clone)]
pub struct GenerateImageArgs {
    #[command(flatten)]
    pub shared: SharedImageArgs,
}

#[derive(Args, Debug, Clone)]
pub struct EditImageArgs {
    #[command(flatten)]
    pub shared: SharedImageArgs,
    #[arg(long = "ref-image", required = true)]
    pub ref_image: Vec<String>,
    #[arg(long)]
    pub mask: Option<String>,
    #[arg(long, value_enum)]
    pub input_fidelity: Option<InputFidelity>,
}

#[derive(Args, Debug)]
pub struct RequestCommand {
    #[command(subcommand)]
    pub request_command: RequestSubcommand,
}

#[derive(Subcommand, Debug)]
pub enum RequestSubcommand {
    Create(RequestCreateArgs),
}

#[derive(Args, Debug)]
pub struct RequestCreateArgs {
    #[arg(long)]
    pub body_file: String,
    #[arg(long, value_enum, default_value = "responses")]
    pub request_operation: RequestOperation,
    #[arg(long)]
    pub out_image: Option<String>,
    #[arg(long, action = ArgAction::SetTrue)]
    pub expect_image: bool,
}

pub struct JsonEventLogger {
    enabled: bool,
    seq: u64,
}

impl JsonEventLogger {
    pub fn new(enabled: bool) -> Self {
        Self { enabled, seq: 0 }
    }

    fn emit(&mut self, kind: &str, type_name: &str, data: Value) {
        if !self.enabled {
            return;
        }
        self.seq += 1;
        let record = json!({
            "seq": self.seq,
            "kind": kind,
            "type": type_name,
            "data": data,
        });
        eprintln!(
            "{}",
            serde_json::to_string(&record).unwrap_or_else(|_| {
                "{\"kind\":\"local\",\"type\":\"event_logger_failed\"}".to_string()
            })
        );
    }
}

pub fn parse_image_size(value: &str) -> Result<String, String> {
    let normalized = value.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return Err("Image size must be auto, 2K, 4K, or WIDTHxHEIGHT.".to_string());
    }
    if normalized == "auto" {
        return Ok("auto".to_string());
    }
    if normalized == "2k" {
        return Ok("2048x2048".to_string());
    }
    if normalized == "4k" {
        return Ok("3840x2160".to_string());
    }
    let Some((width_text, height_text)) = normalized.split_once('x') else {
        return Err("Image size must be auto, 2K, 4K, or WIDTHxHEIGHT.".to_string());
    };
    let width: u32 = width_text
        .parse()
        .map_err(|_| "Image size must be auto, 2K, 4K, or WIDTHxHEIGHT.".to_string())?;
    let height: u32 = height_text
        .parse()
        .map_err(|_| "Image size must be auto, 2K, 4K, or WIDTHxHEIGHT.".to_string())?;
    if width == 0 || height == 0 {
        return Err("Image size must use positive width and height values.".to_string());
    }
    if !width.is_multiple_of(16) || !height.is_multiple_of(16) {
        return Err(
            "Image size must use width and height values that are multiples of 16.".to_string(),
        );
    }
    if width.max(height) > IMAGE_SIZE_MAX_EDGE {
        return Err(format!(
            "Image size supports a maximum edge of {}px.",
            IMAGE_SIZE_MAX_EDGE
        ));
    }
    let total_pixels = width.saturating_mul(height);
    if total_pixels < IMAGE_SIZE_MIN_TOTAL_PIXELS {
        return Err(format!(
            "Image size supports at least {} total pixels.",
            IMAGE_SIZE_MIN_TOTAL_PIXELS
        ));
    }
    if total_pixels > IMAGE_SIZE_MAX_TOTAL_PIXELS {
        return Err(format!(
            "Image size supports up to {} total pixels.",
            IMAGE_SIZE_MAX_TOTAL_PIXELS
        ));
    }
    let aspect_ratio = width.max(height) as f64 / width.min(height) as f64;
    if aspect_ratio > IMAGE_SIZE_MAX_ASPECT_RATIO {
        return Err(format!(
            "Image size supports a maximum aspect ratio of {}:1.",
            IMAGE_SIZE_MAX_ASPECT_RATIO
        ));
    }
    Ok(format!("{width}x{height}"))
}

pub fn default_auth_path() -> PathBuf {
    resolve_codex_home().join("auth.json")
}

pub fn shared_config_dir() -> PathBuf {
    resolve_codex_home().join(CONFIG_DIR_NAME)
}

pub fn default_config_path() -> PathBuf {
    shared_config_dir().join(CONFIG_FILE_NAME)
}

pub fn history_db_path() -> PathBuf {
    shared_config_dir().join(HISTORY_FILE_NAME)
}

pub fn jobs_dir() -> PathBuf {
    shared_config_dir().join(JOBS_DIR_NAME)
}

fn default_storage_fallback_dir() -> PathBuf {
    shared_config_dir().join("storage").join("fallback")
}

fn default_legacy_shared_codex_path() -> PathBuf {
    shared_config_dir()
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum ProductRuntime {
    Tauri,
    DockerWeb,
}

pub fn product_default_export_dirs(
    config: &AppConfig,
    runtime: ProductRuntime,
) -> BTreeMap<ExportDirMode, PathBuf> {
    [
        ExportDirMode::Downloads,
        ExportDirMode::Documents,
        ExportDirMode::Pictures,
        ExportDirMode::ResultLibrary,
        ExportDirMode::BrowserDefault,
    ]
    .into_iter()
    .map(|mode| {
        let mut preview_config = config.clone();
        preview_config.paths.default_export_dir.mode = mode.clone();
        preview_config.paths.default_export_dir.path = None;
        (
            mode,
            product_default_export_dir(Some(&preview_config), runtime),
        )
    })
    .collect()
}

fn default_product_app_data_dir(runtime: ProductRuntime) -> PathBuf {
    match runtime {
        ProductRuntime::Tauri => dirs::data_dir()
            .or_else(dirs::home_dir)
            .unwrap_or_else(|| PathBuf::from("."))
            .join("com.wangnov.gpt-image-2"),
        ProductRuntime::DockerWeb => std::env::var_os("GPT_IMAGE_2_DATA_DIR")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("/data").join(PRODUCT_DIR_NAME)),
    }
}

fn default_product_export_dir(runtime: ProductRuntime, app_data_dir: &Path) -> PathBuf {
    match runtime {
        ProductRuntime::Tauri => dirs::download_dir()
            .or_else(dirs::document_dir)
            .unwrap_or_else(|| app_data_dir.join(EXPORTS_DIR_NAME))
            .join("GPT Image 2"),
        ProductRuntime::DockerWeb => app_data_dir.join(EXPORTS_DIR_NAME),
    }
}

fn resolve_path_ref(default: PathBuf, path_ref: &PathRef) -> PathBuf {
    match path_ref.mode {
        PathMode::Custom => path_ref
            .path
            .as_ref()
            .filter(|path| !path.as_os_str().is_empty())
            .cloned()
            .unwrap_or(default),
        PathMode::Default => default,
    }
}

pub fn product_app_data_dir(config: Option<&AppConfig>, runtime: ProductRuntime) -> PathBuf {
    let default = default_product_app_data_dir(runtime);
    config
        .map(|config| resolve_path_ref(default.clone(), &config.paths.app_data_dir))
        .unwrap_or(default)
}

pub fn product_result_library_dir(config: Option<&AppConfig>, runtime: ProductRuntime) -> PathBuf {
    let app_data_dir = product_app_data_dir(config, runtime);
    let default = app_data_dir.join(JOBS_DIR_NAME);
    config
        .map(|config| resolve_path_ref(default.clone(), &config.paths.result_library_dir))
        .unwrap_or(default)
}

pub fn product_default_export_dir(config: Option<&AppConfig>, runtime: ProductRuntime) -> PathBuf {
    let app_data_dir = product_app_data_dir(config, runtime);
    let result_library_dir = product_result_library_dir(config, runtime);
    let Some(export_dir) = config.map(|config| &config.paths.default_export_dir) else {
        return default_product_export_dir(runtime, &app_data_dir);
    };
    match export_dir.mode {
        ExportDirMode::Custom => export_dir
            .path
            .as_ref()
            .filter(|path| !path.as_os_str().is_empty())
            .cloned()
            .unwrap_or_else(|| default_product_export_dir(runtime, &app_data_dir)),
        ExportDirMode::Documents => dirs::document_dir()
            .unwrap_or_else(|| app_data_dir.join(EXPORTS_DIR_NAME))
            .join("GPT Image 2"),
        ExportDirMode::Pictures => dirs::picture_dir()
            .unwrap_or_else(|| app_data_dir.join(EXPORTS_DIR_NAME))
            .join("GPT Image 2"),
        ExportDirMode::ResultLibrary => result_library_dir,
        ExportDirMode::BrowserDefault | ExportDirMode::Downloads => {
            default_product_export_dir(runtime, &app_data_dir)
        }
    }
}

pub fn product_storage_fallback_dir(
    config: Option<&AppConfig>,
    runtime: ProductRuntime,
) -> PathBuf {
    product_app_data_dir(config, runtime)
        .join("storage")
        .join("fallback")
}

pub fn legacy_shared_codex_dir(config: Option<&AppConfig>) -> PathBuf {
    config
        .map(|config| config.paths.legacy_shared_codex_dir.path.clone())
        .unwrap_or_else(default_legacy_shared_codex_path)
}

pub fn legacy_jobs_dir(config: Option<&AppConfig>) -> PathBuf {
    legacy_shared_codex_dir(config).join(JOBS_DIR_NAME)
}

fn cli_config_path(cli: &Cli) -> PathBuf {
    cli.config
        .as_deref()
        .map(expand_tilde)
        .unwrap_or_else(default_config_path)
}

fn resolve_codex_home() -> PathBuf {
    if let Some(value) = std::env::var_os("CODEX_HOME")
        && !value.is_empty()
    {
        return PathBuf::from(value);
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".codex")
}

fn expand_tilde(value: &str) -> PathBuf {
    if value == "~" {
        return dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    }
    if let Some(rest) = value.strip_prefix("~/") {
        return dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(rest);
    }
    PathBuf::from(value)
}

pub fn load_app_config(path: &Path) -> Result<AppConfig, AppError> {
    if !path.is_file() {
        return Ok(AppConfig::default());
    }
    let raw = fs::read_to_string(path).map_err(|error| {
        AppError::new("config_read_failed", "Unable to read config file.").with_detail(
            json!({"config_file": path.display().to_string(), "error": error.to_string()}),
        )
    })?;
    serde_json::from_str(&raw).map_err(|error| {
        AppError::new("config_invalid_json", "Config file must be valid JSON.").with_detail(
            json!({"config_file": path.display().to_string(), "error": error.to_string()}),
        )
    })
}

pub fn save_app_config(path: &Path, config: &AppConfig) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            AppError::new("config_write_failed", "Unable to create config directory.").with_detail(
                json!({"config_file": path.display().to_string(), "error": error.to_string()}),
            )
        })?;
    }
    let mut content = serde_json::to_string_pretty(config).map_err(|error| {
        AppError::new("config_write_failed", "Unable to serialize config.")
            .with_detail(json!({"error": error.to_string()}))
    })?;
    content.push('\n');
    fs::write(path, content).map_err(|error| {
        AppError::new("config_write_failed", "Unable to write config file.").with_detail(
            json!({"config_file": path.display().to_string(), "error": error.to_string()}),
        )
    })?;
    set_private_file_permissions(path)?;
    Ok(())
}

#[cfg(unix)]
fn set_private_file_permissions(path: &Path) -> Result<(), AppError> {
    use std::os::unix::fs::PermissionsExt;
    let mut permissions = fs::metadata(path)
        .map_err(|error| {
            AppError::new(
                "config_write_failed",
                "Unable to inspect config permissions.",
            )
            .with_detail(
                json!({"config_file": path.display().to_string(), "error": error.to_string()}),
            )
        })?
        .permissions();
    permissions.set_mode(0o600);
    fs::set_permissions(path, permissions).map_err(|error| {
        AppError::new("config_write_failed", "Unable to set config permissions.").with_detail(
            json!({"config_file": path.display().to_string(), "error": error.to_string()}),
        )
    })
}

#[cfg(not(unix))]
fn set_private_file_permissions(_path: &Path) -> Result<(), AppError> {
    Ok(())
}

fn redact_credential_ref(value: &CredentialRef) -> Value {
    match value {
        CredentialRef::File { value } => json!({
            "source": "file",
            "present": !value.is_empty(),
            "value": {"_omitted": "secret"},
        }),
        CredentialRef::Env { env } => json!({
            "source": "env",
            "env": env,
            "present": std::env::var(env).map(|value| !value.trim().is_empty()).unwrap_or(false),
        }),
        CredentialRef::Keychain { service, account } => json!({
            "source": "keychain",
            "service": service.as_deref().unwrap_or(KEYCHAIN_SERVICE),
            "account": account,
            "present": read_keychain_secret(service.as_deref().unwrap_or(KEYCHAIN_SERVICE), account).is_ok(),
        }),
    }
}

fn redact_optional_credential(value: &Option<CredentialRef>) -> Value {
    value
        .as_ref()
        .map(redact_credential_ref)
        .unwrap_or(Value::Null)
}

fn redact_notification_config(config: &NotificationConfig) -> Value {
    json!({
        "enabled": config.enabled,
        "on_completed": config.on_completed,
        "on_failed": config.on_failed,
        "on_cancelled": config.on_cancelled,
        "toast": {
            "enabled": config.toast.enabled,
        },
        "system": {
            "enabled": config.system.enabled,
            "mode": config.system.mode,
        },
        "email": {
            "enabled": config.email.enabled,
            "smtp_host": config.email.smtp_host,
            "smtp_port": config.email.smtp_port,
            "tls": config.email.tls,
            "username": config.email.username,
            "password": redact_optional_credential(&config.email.password),
            "from": config.email.from,
            "to": config.email.to,
            "timeout_seconds": config.email.timeout_seconds,
        },
        "webhooks": config.webhooks.iter().map(|webhook| {
            json!({
                "id": webhook.id,
                "name": webhook.name,
                "enabled": webhook.enabled,
                "url": webhook.url,
                "method": webhook.method,
                "headers": webhook.headers.iter().map(|(key, credential)| {
                    (key.clone(), redact_credential_ref(credential))
                }).collect::<Map<String, Value>>(),
                "timeout_seconds": webhook.timeout_seconds,
            })
        }).collect::<Vec<_>>(),
    })
}

fn redact_storage_target_config(target: &StorageTargetConfig) -> Value {
    match target {
        StorageTargetConfig::Local {
            directory,
            public_base_url,
        } => json!({
            "type": "local",
            "directory": directory,
            "public_base_url": public_base_url,
        }),
        StorageTargetConfig::S3 {
            bucket,
            region,
            endpoint,
            prefix,
            access_key_id,
            secret_access_key,
            session_token,
            public_base_url,
        } => json!({
            "type": "s3",
            "bucket": bucket,
            "region": region,
            "endpoint": endpoint,
            "prefix": prefix,
            "access_key_id": redact_optional_credential(access_key_id),
            "secret_access_key": redact_optional_credential(secret_access_key),
            "session_token": redact_optional_credential(session_token),
            "public_base_url": public_base_url,
        }),
        StorageTargetConfig::WebDav {
            url,
            username,
            password,
            public_base_url,
        } => json!({
            "type": "webdav",
            "url": url,
            "username": username,
            "password": redact_optional_credential(password),
            "public_base_url": public_base_url,
        }),
        StorageTargetConfig::Http {
            url,
            method,
            headers,
            public_url_json_pointer,
        } => json!({
            "type": "http",
            "url": url,
            "method": method,
            "headers": headers.iter().map(|(key, credential)| {
                (key.clone(), redact_credential_ref(credential))
            }).collect::<Map<String, Value>>(),
            "public_url_json_pointer": public_url_json_pointer,
        }),
        StorageTargetConfig::Sftp {
            host,
            port,
            host_key_sha256,
            username,
            password,
            private_key,
            remote_dir,
            public_base_url,
        } => json!({
            "type": "sftp",
            "host": host,
            "port": port,
            "host_key_sha256": host_key_sha256,
            "username": username,
            "password": redact_optional_credential(password),
            "private_key": redact_optional_credential(private_key),
            "remote_dir": remote_dir,
            "public_base_url": public_base_url,
        }),
    }
}

fn redact_storage_config(config: &StorageConfig) -> Value {
    json!({
        "targets": config.targets.iter().map(|(name, target)| {
            (name.clone(), redact_storage_target_config(target))
        }).collect::<Map<String, Value>>(),
        "default_targets": config.default_targets,
        "fallback_targets": config.fallback_targets,
        "fallback_policy": config.fallback_policy,
        "upload_concurrency": config.upload_concurrency,
        "target_concurrency": config.target_concurrency,
    })
}

pub fn redact_app_config(config: &AppConfig) -> Value {
    let providers = config
        .providers
        .iter()
        .map(|(name, provider)| {
            let credentials = provider
                .credentials
                .iter()
                .map(|(key, value)| (key.clone(), redact_credential_ref(value)))
                .collect::<Map<String, Value>>();
            (
                name.clone(),
                json!({
                    "type": provider.provider_type,
                    "api_base": provider.api_base,
                    "endpoint": provider.endpoint,
                    "model": provider.model,
                    "supports_n": provider.supports_n,
                    "credentials": credentials,
                }),
            )
        })
        .collect::<Map<String, Value>>();
    json!({
        "version": config.version,
        "default_provider": config.default_provider,
        "providers": providers,
        "notifications": redact_notification_config(&config.notifications),
        "storage": redact_storage_config(&config.storage),
        "paths": config.paths,
    })
}

fn provider_is_builtin(name: &str) -> bool {
    matches!(name, "auto" | "openai" | "codex")
}

fn validate_provider_name(name: &str) -> Result<(), AppError> {
    if name.trim().is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains(char::is_whitespace)
    {
        return Err(AppError::new(
            "provider_invalid_name",
            "Provider name must be a non-empty path-safe token.",
        ));
    }
    Ok(())
}

pub fn default_keychain_account(provider: &str, secret: &str) -> String {
    format!("providers/{provider}/{secret}")
}

pub fn read_keychain_secret(service: &str, account: &str) -> Result<String, AppError> {
    let entry = keyring::Entry::new(service, account).map_err(|error| {
        AppError::new("keychain_error", "Unable to open keychain entry.").with_detail(
            json!({"service": service, "account": account, "error": error.to_string()}),
        )
    })?;
    entry.get_password().map_err(|error| {
        AppError::new("keychain_missing", "Unable to read keychain secret.").with_detail(
            json!({"service": service, "account": account, "error": error.to_string()}),
        )
    })
}

pub fn write_keychain_secret(service: &str, account: &str, value: &str) -> Result<(), AppError> {
    let entry = keyring::Entry::new(service, account).map_err(|error| {
        AppError::new("keychain_error", "Unable to open keychain entry.").with_detail(
            json!({"service": service, "account": account, "error": error.to_string()}),
        )
    })?;
    entry.set_password(value).map_err(|error| {
        AppError::new("keychain_write_failed", "Unable to write keychain secret.").with_detail(
            json!({"service": service, "account": account, "error": error.to_string()}),
        )
    })
}

fn delete_keychain_secret(service: &str, account: &str) -> Result<(), AppError> {
    let entry = keyring::Entry::new(service, account).map_err(|error| {
        AppError::new("keychain_error", "Unable to open keychain entry.").with_detail(
            json!({"service": service, "account": account, "error": error.to_string()}),
        )
    })?;
    entry.delete_credential().map_err(|error| {
        AppError::new(
            "keychain_delete_failed",
            "Unable to delete keychain secret.",
        )
        .with_detail(json!({"service": service, "account": account, "error": error.to_string()}))
    })
}

fn resolve_credential(credential: &CredentialRef) -> Result<(String, String), AppError> {
    match credential {
        CredentialRef::File { value } => {
            if value.trim().is_empty() {
                Err(AppError::new(
                    "credential_missing",
                    "File credential is empty.",
                ))
            } else {
                Ok((value.clone(), "file".to_string()))
            }
        }
        CredentialRef::Env { env } => match std::env::var(env) {
            Ok(value) if !value.trim().is_empty() => Ok((value, format!("env:{env}"))),
            _ => Err(AppError::new(
                "credential_missing",
                format!("Missing environment credential: {env}"),
            )),
        },
        CredentialRef::Keychain { service, account } => {
            let service = service.as_deref().unwrap_or(KEYCHAIN_SERVICE);
            read_keychain_secret(service, account)
                .map(|value| (value, format!("keychain:{account}")))
        }
    }
}

fn get_provider_credential(
    provider_name: &str,
    provider: &ProviderConfig,
    key: &str,
) -> Result<(String, String), AppError> {
    provider
        .credentials
        .get(key)
        .ok_or_else(|| {
            AppError::new("credential_missing", format!("Missing credential: {key}"))
                .with_detail(json!({"provider": provider_name, "credential": key}))
        })
        .and_then(resolve_credential)
}

#[derive(Debug, Clone)]
pub struct NotificationJob {
    pub id: String,
    pub command: String,
    pub provider: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    pub output_path: Option<String>,
    pub outputs: Vec<Value>,
    pub metadata: Value,
    pub error_message: Option<String>,
}

impl NotificationJob {
    pub fn from_job_value(job: &Value) -> Self {
        let metadata = job.get("metadata").cloned().unwrap_or_else(|| json!({}));
        let outputs = job
            .get("outputs")
            .and_then(Value::as_array)
            .cloned()
            .or_else(|| {
                metadata
                    .get("output")
                    .and_then(|output| output.get("files"))
                    .and_then(Value::as_array)
                    .cloned()
            })
            .unwrap_or_default();
        let output_path = job
            .get("output_path")
            .and_then(Value::as_str)
            .or_else(|| {
                metadata
                    .get("output")
                    .and_then(|output| output.get("path"))
                    .and_then(Value::as_str)
            })
            .map(ToString::to_string);
        let error_message = job
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
            .map(ToString::to_string);
        Self {
            id: string_json_field(job, "id").unwrap_or_default(),
            command: string_json_field(job, "command")
                .unwrap_or_else(|| "images generate".to_string()),
            provider: string_json_field(job, "provider").unwrap_or_else(|| "auto".to_string()),
            status: normalize_notification_status(
                &string_json_field(job, "status").unwrap_or_else(|| "completed".to_string()),
            ),
            created_at: string_json_field(job, "created_at").unwrap_or_default(),
            updated_at: string_json_field(job, "updated_at")
                .unwrap_or_else(|| string_json_field(job, "created_at").unwrap_or_default()),
            output_path,
            outputs,
            metadata,
            error_message,
        }
    }

    pub fn event_name(&self) -> String {
        format!("job.{}", self.status)
    }

    pub fn title(&self) -> String {
        let action = if self.command == "images edit" {
            "编辑"
        } else {
            "生成"
        };
        match self.status.as_str() {
            "completed" => format!("{action}完成"),
            "failed" => format!("{action}失败"),
            "cancelled" => "任务已取消".to_string(),
            _ => format!("任务{}", self.status),
        }
    }

    pub fn summary(&self) -> String {
        let mut parts = vec![self.provider.clone()];
        if let Some(size) = self.metadata.get("size").and_then(Value::as_str)
            && !size.trim().is_empty()
        {
            parts.push(size.to_string());
        }
        if self.status == "completed" {
            let count = if self.outputs.is_empty() {
                usize::from(self.output_path.is_some())
            } else {
                self.outputs.len()
            };
            if count > 0 {
                parts.push(if count > 1 {
                    format!("{count} 张图片")
                } else {
                    "1 张图片".to_string()
                });
            }
        } else if let Some(message) = &self.error_message {
            parts.push(message.clone());
        }
        parts.join(" · ")
    }
}

fn string_json_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(ToString::to_string)
}

fn normalize_notification_status(status: &str) -> String {
    if status == "canceled" {
        "cancelled".to_string()
    } else {
        status.to_string()
    }
}

#[derive(Debug, Clone)]
pub struct NotificationDelivery {
    pub channel: String,
    pub name: String,
    pub ok: bool,
    pub message: String,
}

#[derive(Debug, Clone)]
pub struct WebhookRequest {
    pub method: String,
    pub url: String,
    pub headers: BTreeMap<String, String>,
    pub body: Value,
    pub timeout_seconds: u64,
}

#[derive(Debug, Clone)]
pub struct EmailNotificationMessage {
    pub smtp_host: String,
    pub smtp_port: u16,
    pub tls: EmailTlsMode,
    pub username: Option<String>,
    pub password: Option<String>,
    pub from: String,
    pub to: Vec<String>,
    pub subject: String,
    pub body: String,
    pub timeout_seconds: u64,
}

pub fn build_webhook_request(
    webhook: &WebhookNotificationConfig,
    job: &NotificationJob,
) -> Result<WebhookRequest, AppError> {
    let url = webhook.url.trim();
    if url.is_empty() {
        return Err(AppError::new(
            "notification_webhook_invalid",
            "Webhook URL is required.",
        ));
    }
    let mut headers = BTreeMap::new();
    for (name, credential) in &webhook.headers {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            continue;
        }
        let (value, _) = resolve_credential(credential)?;
        if !value.trim().is_empty() {
            headers.insert(trimmed.to_string(), value);
        }
    }
    Ok(WebhookRequest {
        method: webhook.method.trim().to_ascii_uppercase(),
        url: url.to_string(),
        headers,
        body: notification_payload(job),
        timeout_seconds: webhook.timeout_seconds.max(1),
    })
}

// Webhook URLs are user-supplied and the server can reach internal networks
// (loopback, RFC1918, link-local, cloud metadata at 169.254.169.254). Without
// a check, a misconfigured or hostile webhook would let the server speak to
// services it should not (SSRF). This validates scheme + DNS-resolved IPs.
//
// This is best-effort: a perfect defense would replace reqwest's connector to
// avoid DNS rebinding races. That's larger than this PR — this still blocks
// the realistic configuration mistakes and obvious abuse.
fn validate_webhook_target(url_str: &str) -> Result<(), AppError> {
    let url = reqwest::Url::parse(url_str).map_err(|err| {
        AppError::new("notification_webhook_invalid", "Webhook URL is invalid.")
            .with_detail(json!({"url": url_str, "error": err.to_string()}))
    })?;
    match url.scheme() {
        "http" | "https" => {}
        scheme => {
            return Err(AppError::new(
                "notification_webhook_invalid",
                "Webhook URL must use http or https.",
            )
            .with_detail(json!({"scheme": scheme})));
        }
    }
    let host_label = url
        .host_str()
        .ok_or_else(|| {
            AppError::new(
                "notification_webhook_invalid",
                "Webhook URL is missing a host.",
            )
            .with_detail(json!({"url": url_str}))
        })?
        .to_string();
    // Url::socket_addrs handles IPv6 literals (`[::1]` strips brackets) and
    // resolves DNS names — both of which `(host_str, port).to_socket_addrs()`
    // would mishandle.
    let addrs = url.socket_addrs(|| None).map_err(|err| {
        AppError::new(
            "notification_webhook_failed",
            "Unable to resolve webhook host.",
        )
        .with_detail(json!({"host": host_label, "error": err.to_string()}))
    })?;
    if addrs.is_empty() {
        return Err(AppError::new(
            "notification_webhook_failed",
            "Webhook host did not resolve to any address.",
        )
        .with_detail(json!({"host": host_label})));
    }
    for addr in &addrs {
        let ip = canonicalize_ip(addr.ip());
        if ip_is_internal(ip) {
            return Err(AppError::new(
                "notification_webhook_blocked",
                "Webhook target resolves to a non-routable address (loopback, private, link-local, or unspecified). Refusing to send.",
            )
            .with_detail(json!({
                "host": host_label,
                "address": ip.to_string(),
            })));
        }
    }
    Ok(())
}

fn validate_remote_http_target(
    url_str: &str,
    target_label: &str,
) -> Result<(Url, String, Vec<SocketAddr>), AppError> {
    let url = Url::parse(url_str).map_err(|err| {
        AppError::new(
            "storage_remote_url_invalid",
            format!("{target_label} URL is invalid."),
        )
        .with_detail(json!({"url": redact_url_for_log(url_str), "error": err.to_string()}))
    })?;
    match url.scheme() {
        "http" | "https" => {}
        scheme => {
            return Err(AppError::new(
                "storage_remote_url_invalid",
                format!("{target_label} URL must use http or https."),
            )
            .with_detail(json!({"scheme": scheme})));
        }
    }
    let host_label = url
        .host_str()
        .ok_or_else(|| {
            AppError::new(
                "storage_remote_url_invalid",
                format!("{target_label} URL is missing a host."),
            )
            .with_detail(json!({"url": redact_url_for_log(url_str)}))
        })?
        .to_string();
    let addrs = url.socket_addrs(|| None).map_err(|err| {
        AppError::new(
            "storage_remote_resolve_failed",
            format!("Unable to resolve {target_label} host."),
        )
        .with_detail(json!({"host": host_label, "error": err.to_string()}))
    })?;
    validate_remote_addresses(&host_label, addrs.iter().map(|addr| addr.ip()))?;
    Ok((url, host_label, addrs))
}

fn validate_remote_tcp_target(
    host: &str,
    port: u16,
    target_label: &str,
) -> Result<Vec<SocketAddr>, AppError> {
    let host_label = host.trim();
    if host_label.is_empty() {
        return Err(AppError::new(
            "storage_remote_host_invalid",
            format!("{target_label} host is required."),
        ));
    }
    let addrs = (host_label, port).to_socket_addrs().map_err(|err| {
        AppError::new(
            "storage_remote_resolve_failed",
            format!("Unable to resolve {target_label} host."),
        )
        .with_detail(json!({"host": host_label, "port": port, "error": err.to_string()}))
    })?;
    let addrs = addrs.collect::<Vec<_>>();
    validate_remote_addresses(host_label, addrs.iter().map(|addr| addr.ip()))?;
    Ok(addrs)
}

fn validate_remote_addresses<I>(host_label: &str, addrs: I) -> Result<(), AppError>
where
    I: IntoIterator<Item = IpAddr>,
{
    let addrs = addrs.into_iter().collect::<Vec<_>>();
    if addrs.is_empty() {
        return Err(AppError::new(
            "storage_remote_resolve_failed",
            "Storage target host did not resolve to any address.",
        )
        .with_detail(json!({"host": host_label})));
    }
    for ip in addrs {
        let ip = canonicalize_ip(ip);
        if ip_is_internal(ip) {
            return Err(AppError::new(
                "storage_remote_blocked",
                "Storage target resolves to a non-routable address (loopback, private, link-local, or unspecified). Refusing to upload.",
            )
            .with_detail(json!({
                "host": host_label,
                "address": ip.to_string(),
            })));
        }
    }
    Ok(())
}

fn canonicalize_ip(ip: IpAddr) -> IpAddr {
    if let IpAddr::V6(v6) = ip {
        let segs = v6.segments();
        // Unmap ::ffff:0:0/96 into the underlying IPv4 so private/loopback
        // checks below catch it.
        if segs[0] == 0
            && segs[1] == 0
            && segs[2] == 0
            && segs[3] == 0
            && segs[4] == 0
            && segs[5] == 0xffff
        {
            return IpAddr::V4(Ipv4Addr::new(
                (segs[6] >> 8) as u8,
                (segs[6] & 0xff) as u8,
                (segs[7] >> 8) as u8,
                (segs[7] & 0xff) as u8,
            ));
        }
    }
    ip
}

fn ip_is_internal(ip: IpAddr) -> bool {
    if ip.is_loopback() || ip.is_unspecified() || ip.is_multicast() {
        return true;
    }
    match ip {
        IpAddr::V4(v4) => {
            // Covers 10/8, 172.16/12, 192.168/16, 169.254/16 (incl. AWS/GCP
            // metadata at 169.254.169.254), broadcast 255.255.255.255, and
            // the 0.0.0.0/8 "this network" block.
            v4.is_private() || v4.is_link_local() || v4.is_broadcast() || v4.octets()[0] == 0
        }
        IpAddr::V6(v6) => {
            let segs = v6.segments();
            // ULA fc00::/7
            (segs[0] & 0xfe00) == 0xfc00
                // Link-local fe80::/10
                || (segs[0] & 0xffc0) == 0xfe80
        }
    }
}

fn notification_payload(job: &NotificationJob) -> Value {
    json!({
        "event": job.event_name(),
        "title": job.title(),
        "summary": job.summary(),
        "job": {
            "id": job.id,
            "command": job.command,
            "provider": job.provider,
            "status": job.status,
            "created_at": job.created_at,
            "updated_at": job.updated_at,
            "output_path": job.output_path,
            "outputs": job.outputs,
            "metadata": job.metadata,
            "error": job.error_message.as_ref().map(|message| json!({"message": message})).unwrap_or(Value::Null),
        }
    })
}

pub fn notification_status_allowed(config: &NotificationConfig, status: &str) -> bool {
    match normalize_notification_status(status).as_str() {
        "completed" => config.on_completed,
        "failed" => config.on_failed,
        "cancelled" => config.on_cancelled,
        _ => false,
    }
}

pub fn dispatch_task_notifications(
    config: &AppConfig,
    job_value: &Value,
) -> Vec<NotificationDelivery> {
    let notification_config = &config.notifications;
    let job = NotificationJob::from_job_value(job_value);
    if !notification_config.enabled
        || !notification_status_allowed(notification_config, &job.status)
    {
        return Vec::new();
    }
    let mut deliveries = Vec::new();
    if notification_config.email.enabled {
        deliveries.push(send_email_notification(&notification_config.email, &job));
    }
    for webhook in notification_config
        .webhooks
        .iter()
        .filter(|webhook| webhook.enabled)
    {
        deliveries.push(send_webhook_notification(webhook, &job));
    }
    deliveries
}

fn send_webhook_notification(
    webhook: &WebhookNotificationConfig,
    job: &NotificationJob,
) -> NotificationDelivery {
    let name = if webhook.name.trim().is_empty() {
        webhook.id.clone()
    } else {
        webhook.name.clone()
    };
    let request = match build_webhook_request(webhook, job) {
        Ok(request) => request,
        Err(error) => {
            return NotificationDelivery {
                channel: "webhook".to_string(),
                name,
                ok: false,
                message: error.message,
            };
        }
    };
    match execute_webhook_request(&request) {
        Ok(message) => NotificationDelivery {
            channel: "webhook".to_string(),
            name,
            ok: true,
            message,
        },
        Err(error) => NotificationDelivery {
            channel: "webhook".to_string(),
            name,
            ok: false,
            message: error.message,
        },
    }
}

fn execute_webhook_request(request: &WebhookRequest) -> Result<String, AppError> {
    validate_webhook_target(&request.url)?;
    let client = Client::builder()
        .timeout(Duration::from_secs(request.timeout_seconds.max(1)))
        .build()
        .map_err(|error| {
            AppError::new(
                "notification_webhook_failed",
                "Unable to create webhook client.",
            )
            .with_detail(json!({"error": error.to_string()}))
        })?;
    let method = reqwest::Method::from_bytes(request.method.as_bytes()).map_err(|error| {
        AppError::new("notification_webhook_invalid", "Webhook method is invalid.")
            .with_detail(json!({"method": request.method, "error": error.to_string()}))
    })?;
    let mut headers = HeaderMap::new();
    for (name, value) in &request.headers {
        let header_name = HeaderName::from_bytes(name.as_bytes()).map_err(|error| {
            AppError::new(
                "notification_webhook_invalid",
                "Webhook header name is invalid.",
            )
            .with_detail(json!({"header": name, "error": error.to_string()}))
        })?;
        let header_value = HeaderValue::from_str(value).map_err(|error| {
            AppError::new(
                "notification_webhook_invalid",
                "Webhook header value is invalid.",
            )
            .with_detail(json!({"header": name, "error": error.to_string()}))
        })?;
        headers.insert(header_name, header_value);
    }
    let response = client
        .request(method, &request.url)
        .headers(headers)
        .json(&request.body)
        .send()
        .map_err(|error| {
            AppError::new("notification_webhook_failed", "Webhook request failed.")
                .with_detail(json!({"error": error.to_string()}))
        })?;
    let status = response.status();
    if status.is_success() {
        Ok(format!("Webhook delivered with HTTP {status}."))
    } else {
        Err(AppError::new(
            "notification_webhook_failed",
            format!("Webhook returned HTTP {status}."),
        ))
    }
}

fn send_email_notification(
    email: &EmailNotificationConfig,
    job: &NotificationJob,
) -> NotificationDelivery {
    match build_email_notification_message(email, job)
        .and_then(|message| send_email_message(&message))
    {
        Ok(message) => NotificationDelivery {
            channel: "email".to_string(),
            name: "smtp".to_string(),
            ok: true,
            message,
        },
        Err(error) => NotificationDelivery {
            channel: "email".to_string(),
            name: "smtp".to_string(),
            ok: false,
            message: error.message,
        },
    }
}

pub fn build_email_notification_message(
    email: &EmailNotificationConfig,
    job: &NotificationJob,
) -> Result<EmailNotificationMessage, AppError> {
    if email.smtp_host.trim().is_empty() {
        return Err(AppError::new(
            "notification_email_invalid",
            "SMTP host is required.",
        ));
    }
    if email.from.trim().is_empty() {
        return Err(AppError::new(
            "notification_email_invalid",
            "Email sender is required.",
        ));
    }
    let to = email
        .to
        .iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    if to.is_empty() {
        return Err(AppError::new(
            "notification_email_invalid",
            "At least one email recipient is required.",
        ));
    }
    let password = email
        .password
        .as_ref()
        .map(resolve_credential)
        .transpose()?
        .map(|(value, _)| value);
    let subject = format!("GPT Image 2 · {}", job.title());
    let output_path = job.output_path.as_deref().unwrap_or("无");
    let body = format!(
        "任务：{}\n状态：{}\n供应商：{}\n摘要：{}\n输出：{}\n任务 ID：{}\n",
        job.command,
        job.status,
        job.provider,
        job.summary(),
        output_path,
        job.id,
    );
    Ok(EmailNotificationMessage {
        smtp_host: email.smtp_host.trim().to_string(),
        smtp_port: email.smtp_port,
        tls: email.tls.clone(),
        username: email
            .username
            .as_ref()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        password,
        from: email.from.trim().to_string(),
        to,
        subject,
        body,
        timeout_seconds: email.timeout_seconds.max(1),
    })
}

fn send_email_message(message: &EmailNotificationMessage) -> Result<String, AppError> {
    let from = message.from.parse::<Mailbox>().map_err(|error| {
        AppError::new("notification_email_invalid", "Email sender is invalid.")
            .with_detail(json!({"error": error.to_string()}))
    })?;
    let mut builder = Message::builder()
        .from(from)
        .subject(&message.subject)
        .header(ContentType::TEXT_PLAIN);
    for recipient in &message.to {
        builder = builder.to(recipient.parse::<Mailbox>().map_err(|error| {
            AppError::new("notification_email_invalid", "Email recipient is invalid.")
                .with_detail(json!({"recipient": recipient, "error": error.to_string()}))
        })?);
    }
    let email = builder.body(message.body.clone()).map_err(|error| {
        AppError::new("notification_email_invalid", "Email message is invalid.")
            .with_detail(json!({"error": error.to_string()}))
    })?;
    let mut transport_builder = match message.tls {
        EmailTlsMode::Smtps => SmtpTransport::relay(&message.smtp_host),
        EmailTlsMode::StartTls => SmtpTransport::starttls_relay(&message.smtp_host),
        EmailTlsMode::None => Ok(SmtpTransport::builder_dangerous(&message.smtp_host)),
    }
    .map_err(|error| {
        AppError::new(
            "notification_email_invalid",
            "Unable to create SMTP transport.",
        )
        .with_detail(json!({"error": error.to_string()}))
    })?
    .port(message.smtp_port)
    .timeout(Some(Duration::from_secs(message.timeout_seconds)));
    if let (Some(username), Some(password)) = (&message.username, &message.password) {
        transport_builder =
            transport_builder.credentials(Credentials::new(username.clone(), password.clone()));
    }
    transport_builder.build().send(&email).map_err(|error| {
        AppError::new("notification_email_failed", "SMTP email delivery failed.")
            .with_detail(json!({"error": error.to_string()}))
    })?;
    Ok("Email delivered.".to_string())
}

fn build_user_agent() -> String {
    format!("{CLI_NAME}/{VERSION} local-cli")
}

fn now_iso() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    now.to_string()
}

fn emit_json(payload: &Value) {
    println!(
        "{}",
        serde_json::to_string_pretty(payload).unwrap_or_else(|_| "{\"ok\":false}".to_string())
    );
}

fn build_error_payload(error: AppError) -> (Value, i32) {
    let mut error_obj = json!({
        "code": error.code,
        "message": error.message,
    });
    if let Some(detail) = error.detail {
        error_obj["detail"] = redact_event_payload(&detail);
    }
    (
        json!({
            "ok": false,
            "error": error_obj,
        }),
        error.exit_status,
    )
}

fn json_object(value: &Value) -> Result<&Map<String, Value>, AppError> {
    value
        .as_object()
        .ok_or_else(|| AppError::new("invalid_json_shape", "Expected a JSON object."))
}

fn get_token_container(auth_json: &Value) -> &Map<String, Value> {
    auth_json
        .get("tokens")
        .and_then(Value::as_object)
        .unwrap_or_else(|| auth_json.as_object().expect("auth json should stay object"))
}

fn get_token_container_mut(auth_json: &mut Value) -> &mut Map<String, Value> {
    if auth_json.get("tokens").and_then(Value::as_object).is_some() {
        auth_json
            .get_mut("tokens")
            .and_then(Value::as_object_mut)
            .expect("tokens object should stay mutable")
    } else {
        auth_json
            .as_object_mut()
            .expect("auth json should stay object")
    }
}

fn read_auth_json(auth_path: &Path) -> Result<Value, AppError> {
    let raw = fs::read_to_string(auth_path).map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            AppError::new(
                "auth_missing",
                format!("Auth file not found: {}", auth_path.display()),
            )
            .with_detail(json!({ "auth_file": auth_path.display().to_string() }))
        } else {
            AppError::new(
                "auth_read_failed",
                format!("Unable to read auth file: {}", auth_path.display()),
            )
            .with_detail(json!({
                "auth_file": auth_path.display().to_string(),
                "error": error.to_string(),
            }))
        }
    })?;
    let parsed: Value = serde_json::from_str(&raw).map_err(|error| {
        AppError::new(
            "auth_invalid_json",
            format!("Invalid JSON in auth file: {}", auth_path.display()),
        )
        .with_detail(json!({
            "auth_file": auth_path.display().to_string(),
            "error": error.to_string(),
        }))
    })?;
    if !parsed.is_object() {
        return Err(AppError::new(
            "auth_invalid_shape",
            "auth.json must contain a JSON object.",
        )
        .with_detail(json!({ "auth_file": auth_path.display().to_string() })));
    }
    Ok(parsed)
}

fn decode_jwt_payload(token: &str) -> Result<Value, AppError> {
    let mut parts = token.split('.');
    let _header = parts.next();
    let payload = parts
        .next()
        .ok_or_else(|| AppError::new("invalid_jwt", "Invalid JWT format."))?;
    let decoded = URL_SAFE_NO_PAD
        .decode(payload)
        .or_else(|_| STANDARD.decode(payload))
        .map_err(|_| AppError::new("invalid_jwt", "Unable to decode JWT payload."))?;
    let parsed: Value = serde_json::from_slice(&decoded)
        .map_err(|_| AppError::new("invalid_jwt", "Unable to decode JWT payload."))?;
    if !parsed.is_object() {
        return Err(AppError::new(
            "invalid_jwt",
            "Decoded JWT payload is not a JSON object.",
        ));
    }
    Ok(parsed)
}

fn try_decode_jwt_payload(token: Option<&str>) -> Option<Value> {
    token.and_then(|value| decode_jwt_payload(value).ok())
}

fn resolve_account_id(access_token: &str, account_id: Option<&str>) -> Result<String, AppError> {
    if let Some(value) = account_id
        && !value.is_empty()
    {
        return Ok(value.to_string());
    }
    let payload = decode_jwt_payload(access_token)?;
    let auth_claim = payload
        .get("https://api.openai.com/auth")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            AppError::new("account_id_missing", "Missing auth claims in access token.")
        })?;
    let claim_account_id = auth_claim
        .get("chatgpt_account_id")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            AppError::new(
                "account_id_missing",
                "Missing chatgpt_account_id in token claims.",
            )
        })?;
    Ok(claim_account_id.to_string())
}

fn compute_expiry_details(exp_seconds: Option<i64>) -> Value {
    match exp_seconds {
        Some(exp) => {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64;
            json!({
                "expires_at": exp,
                "expired": exp <= now,
                "seconds_until_expiry": exp - now,
            })
        }
        None => json!({
            "expires_at": Value::Null,
            "expired": Value::Null,
            "seconds_until_expiry": Value::Null,
        }),
    }
}

fn resolve_auth_identity(payload: Option<&Value>) -> Value {
    let mut result = Map::new();
    if let Some(payload) = payload {
        if let Some(email) = payload
            .get("https://api.openai.com/profile")
            .and_then(Value::as_object)
            .and_then(|profile| profile.get("email"))
            .and_then(Value::as_str)
        {
            result.insert("email".to_string(), json!(email));
        }
        if let Some(auth_claim) = payload
            .get("https://api.openai.com/auth")
            .and_then(Value::as_object)
        {
            if let Some(plan_type) = auth_claim.get("chatgpt_plan_type").and_then(Value::as_str) {
                result.insert("plan_type".to_string(), json!(plan_type));
            }
            if let Some(chatgpt_user_id) = auth_claim.get("chatgpt_user_id").and_then(Value::as_str)
            {
                result.insert("chatgpt_user_id".to_string(), json!(chatgpt_user_id));
            }
        }
    }
    Value::Object(result)
}

pub fn inspect_codex_auth_file(auth_path: &Path) -> Value {
    let mut result = json!({
        "auth_file": auth_path.display().to_string(),
        "auth_source": "config",
        "exists": auth_path.is_file(),
        "provider": "codex",
    });

    if !auth_path.is_file() {
        result["ready"] = json!(false);
        result["parse_ok"] = json!(false);
        result["auth_source"] = json!("missing");
        result["message"] = json!("auth.json was not found.");
        return result;
    }

    let auth_json = match read_auth_json(auth_path) {
        Ok(auth_json) => auth_json,
        Err(error) => {
            result["ready"] = json!(false);
            result["parse_ok"] = json!(false);
            result["message"] = json!(error.message);
            result["error"] = json!({
                "code": error.code,
                "detail": error.detail,
            });
            return result;
        }
    };

    let tokens = get_token_container(&auth_json);
    let access_token = tokens.get("access_token").and_then(Value::as_str);
    let refresh_token = tokens.get("refresh_token").and_then(Value::as_str);
    let id_token = tokens.get("id_token").and_then(Value::as_str);
    let access_payload = try_decode_jwt_payload(access_token);
    let auth_mode = auth_json
        .get("auth_mode")
        .and_then(Value::as_str)
        .or_else(|| auth_json.get("type").and_then(Value::as_str));
    let exp_seconds = access_payload
        .as_ref()
        .and_then(|payload| payload.get("exp"))
        .and_then(Value::as_i64);
    let identity = resolve_auth_identity(access_payload.as_ref());
    let account_id = access_token.and_then(|token| {
        resolve_account_id(token, tokens.get("account_id").and_then(Value::as_str)).ok()
    });

    result["ready"] = json!(access_token.is_some());
    result["parse_ok"] = json!(true);
    result["auth_mode"] = json!(auth_mode);
    result["access_token_present"] = json!(access_token.is_some());
    result["refresh_token_present"] = json!(refresh_token.is_some());
    result["id_token_present"] = json!(id_token.is_some());
    result["account_id"] = json!(account_id);
    result["last_refresh"] = auth_json
        .get("last_refresh")
        .cloned()
        .unwrap_or(Value::Null);
    if let Some(object) = result.as_object_mut() {
        if let Some(details) = compute_expiry_details(exp_seconds).as_object() {
            for (key, value) in details {
                object.insert(key.clone(), value.clone());
            }
        }
        if let Some(identity_object) = identity.as_object() {
            for (key, value) in identity_object {
                object.insert(key.clone(), value.clone());
            }
        }
    }
    result
}

pub fn inspect_openai_auth(api_key_override: Option<&str>) -> Value {
    let (api_key, source) = resolve_openai_api_key(api_key_override);
    json!({
        "provider": "openai",
        "ready": api_key.is_some(),
        "auth_source": source,
        "api_key_present": api_key.is_some(),
        "env_var": OPENAI_API_KEY_ENV,
        "default_model": DEFAULT_OPENAI_MODEL,
    })
}

fn resolve_openai_api_key(api_key_override: Option<&str>) -> (Option<String>, &'static str) {
    if let Some(value) = api_key_override
        && !value.trim().is_empty()
    {
        return (Some(value.to_string()), "flag");
    }
    match std::env::var(OPENAI_API_KEY_ENV) {
        Ok(value) if !value.trim().is_empty() => (Some(value), "env"),
        _ => (None, "missing"),
    }
}

fn load_codex_auth_state(auth_path: &Path) -> Result<CodexAuthState, AppError> {
    let auth_json = read_auth_json(auth_path)?;
    let tokens = get_token_container(&auth_json);
    let access_token = tokens
        .get("access_token")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            AppError::new(
                "access_token_missing",
                format!("Missing access_token in {}", auth_path.display()),
            )
            .with_detail(json!({ "auth_file": auth_path.display().to_string() }))
        })?
        .to_string();
    let refresh_token = tokens
        .get("refresh_token")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let account_id = resolve_account_id(
        &access_token,
        tokens.get("account_id").and_then(Value::as_str),
    )?;
    Ok(CodexAuthState {
        auth_path: auth_path.to_path_buf(),
        auth_json,
        access_token,
        refresh_token,
        account_id,
        persistence: CodexAuthPersistence::AuthFile,
    })
}

fn load_openai_auth_state(api_key_override: Option<&str>) -> Result<OpenAiAuthState, AppError> {
    let (api_key, source) = resolve_openai_api_key(api_key_override);
    let Some(api_key) = api_key else {
        return Err(AppError::new(
            "api_key_missing",
            format!("Missing {}.", OPENAI_API_KEY_ENV),
        )
        .with_detail(json!({
            "provider": "openai",
            "env_var": OPENAI_API_KEY_ENV,
        })));
    };
    Ok(OpenAiAuthState {
        api_key,
        source: source.to_string(),
    })
}

fn load_openai_auth_state_for(
    cli: &Cli,
    selection: &ProviderSelection,
) -> Result<OpenAiAuthState, AppError> {
    if let Some(api_key) = cli.api_key.as_deref()
        && !api_key.trim().is_empty()
    {
        return Ok(OpenAiAuthState {
            api_key: api_key.to_string(),
            source: "flag".to_string(),
        });
    }
    let config = load_app_config(&cli_config_path(cli))?;
    if let Some(provider) = config.providers.get(&selection.resolved) {
        let (api_key, source) = get_provider_credential(&selection.resolved, provider, "api_key")?;
        return Ok(OpenAiAuthState { api_key, source });
    }
    if selection.resolved == "openai" {
        return load_openai_auth_state(None);
    }
    Err(AppError::new(
        "provider_unknown",
        format!("Unknown provider: {}", selection.resolved),
    ))
}

fn load_codex_auth_state_for(
    cli: &Cli,
    selection: &ProviderSelection,
) -> Result<CodexAuthState, AppError> {
    let config_path = cli_config_path(cli);
    let config = load_app_config(&config_path)?;
    if selection.resolved == "codex" && !config.providers.contains_key(&selection.resolved) {
        return load_codex_auth_state(Path::new(&cli.auth_file));
    }
    let provider = config.providers.get(&selection.resolved).ok_or_else(|| {
        AppError::new(
            "provider_unknown",
            format!("Unknown provider: {}", selection.resolved),
        )
    })?;
    let (access_token, _) = get_provider_credential(&selection.resolved, provider, "access_token")?;
    let refresh_token = provider
        .credentials
        .get("refresh_token")
        .and_then(|credential| resolve_credential(credential).ok().map(|(value, _)| value));
    let account_id = provider
        .credentials
        .get("account_id")
        .and_then(|credential| resolve_credential(credential).ok().map(|(value, _)| value));
    let account_id = resolve_account_id(&access_token, account_id.as_deref())?;
    let auth_access_token = access_token.clone();
    let auth_refresh_token = refresh_token.clone();
    let auth_account_id = account_id.clone();
    let auth_json = json!({
        "tokens": {
            "access_token": auth_access_token,
            "refresh_token": auth_refresh_token,
            "account_id": auth_account_id,
        }
    });
    Ok(CodexAuthState {
        auth_path: config_path.clone(),
        auth_json,
        access_token,
        refresh_token,
        account_id,
        persistence: CodexAuthPersistence::ConfigProvider {
            config_path,
            provider_name: selection.resolved.clone(),
            credential_sources: provider.credentials.clone(),
        },
    })
}

fn save_auth_json(auth_state: &CodexAuthState) -> Result<(), AppError> {
    match &auth_state.persistence {
        CodexAuthPersistence::AuthFile => {
            let mut content =
                serde_json::to_string_pretty(&auth_state.auth_json).map_err(|error| {
                    AppError::new("auth_write_failed", "Unable to serialize auth.json.")
                        .with_detail(json!({"error": error.to_string()}))
                })?;
            content.push('\n');
            fs::create_dir_all(
                auth_state
                    .auth_path
                    .parent()
                    .unwrap_or_else(|| Path::new(".")),
            )
            .map_err(|error| {
                AppError::new("auth_write_failed", "Unable to create auth directory.")
                    .with_detail(json!({"error": error.to_string()}))
            })?;
            fs::write(&auth_state.auth_path, content).map_err(|error| {
                AppError::new("auth_write_failed", "Unable to save auth.json.")
                    .with_detail(json!({"error": error.to_string()}))
            })?;
            Ok(())
        }
        CodexAuthPersistence::ConfigProvider {
            config_path,
            provider_name,
            credential_sources,
        } => save_codex_config_credentials(
            config_path,
            provider_name,
            credential_sources,
            &auth_state.access_token,
            auth_state.refresh_token.as_deref(),
            &auth_state.account_id,
        ),
        CodexAuthPersistence::SessionOnly => Ok(()),
    }
}

fn save_codex_config_credentials(
    config_path: &Path,
    provider_name: &str,
    credential_sources: &BTreeMap<String, CredentialRef>,
    access_token: &str,
    refresh_token: Option<&str>,
    account_id: &str,
) -> Result<(), AppError> {
    let mut config = load_app_config(config_path)?;
    let provider = config.providers.get_mut(provider_name).ok_or_else(|| {
        AppError::new(
            "provider_unknown",
            format!("Unknown provider: {provider_name}"),
        )
    })?;
    persist_credential_value(provider, credential_sources, "access_token", access_token)?;
    persist_credential_value(provider, credential_sources, "account_id", account_id)?;
    if let Some(refresh_token) = refresh_token {
        persist_credential_value(provider, credential_sources, "refresh_token", refresh_token)?;
    }
    save_app_config(config_path, &config)
}

fn persist_credential_value(
    provider: &mut ProviderConfig,
    credential_sources: &BTreeMap<String, CredentialRef>,
    key: &str,
    value: &str,
) -> Result<(), AppError> {
    match credential_sources.get(key) {
        Some(CredentialRef::File { .. }) | None => {
            provider.credentials.insert(
                key.to_string(),
                CredentialRef::File {
                    value: value.to_string(),
                },
            );
            Ok(())
        }
        Some(CredentialRef::Keychain { service, account }) => write_keychain_secret(
            service.as_deref().unwrap_or(KEYCHAIN_SERVICE),
            account,
            value,
        ),
        Some(CredentialRef::Env { .. }) => Ok(()),
    }
}

fn make_client(timeout_seconds: u64) -> Result<Client, AppError> {
    Client::builder()
        .timeout(Duration::from_secs(timeout_seconds))
        .user_agent(build_user_agent())
        .build()
        .map_err(|error| {
            AppError::new("http_client_error", "Unable to build HTTP client.")
                .with_detail(json!({ "error": error.to_string() }))
        })
}

fn http_status_error(status: StatusCode, detail: String) -> AppError {
    AppError::new("http_error", format!("HTTP {}", status.as_u16()))
        .with_detail(json!(detail))
        .with_status_code(status.as_u16())
}

fn refresh_access_token(auth_state: &mut CodexAuthState) -> Result<Value, AppError> {
    let Some(refresh_token) = auth_state.refresh_token.clone() else {
        return Err(AppError::new(
            "refresh_token_missing",
            "Missing refresh_token in auth.json",
        ));
    };
    let client = make_client(DEFAULT_REFRESH_TIMEOUT)?;
    let response = client
        .post(REFRESH_ENDPOINT)
        .header(CONTENT_TYPE, "application/json")
        .header(ACCEPT, "application/json")
        .json(&json!({
            "client_id": REFRESH_CLIENT_ID,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        }))
        .send()
        .map_err(|error| {
            AppError::new("refresh_failed", "Refresh request failed.")
                .with_detail(json!({ "error": error.to_string() }))
        })?;
    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().unwrap_or_else(|_| String::new());
        return Err(
            http_status_error(status, detail.clone()).with_detail(json!({
                "message": "Refresh request failed.",
                "detail": detail,
            })),
        );
    }
    let payload: Value = response.json().map_err(|error| {
        AppError::new("refresh_failed", "Refresh response was not valid JSON.")
            .with_detail(json!({ "error": error.to_string() }))
    })?;
    let access_token = payload
        .get("access_token")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            AppError::new(
                "refresh_failed",
                "Refresh response did not include access_token.",
            )
        })?
        .to_string();
    let refresh_token = payload
        .get("refresh_token")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let id_token = payload
        .get("id_token")
        .and_then(Value::as_str)
        .map(ToString::to_string);

    let tokens = get_token_container_mut(&mut auth_state.auth_json);
    tokens.insert("access_token".to_string(), json!(access_token));
    if let Some(refresh_token) = refresh_token.clone() {
        tokens.insert("refresh_token".to_string(), json!(refresh_token));
    }
    if let Some(id_token) = id_token {
        tokens.insert("id_token".to_string(), json!(id_token));
    }
    let account_id = resolve_account_id(
        payload
            .get("access_token")
            .and_then(Value::as_str)
            .unwrap_or(""),
        tokens.get("account_id").and_then(Value::as_str),
    )?;
    tokens.insert("account_id".to_string(), json!(account_id));
    if let Some(root) = auth_state.auth_json.as_object_mut() {
        root.insert("last_refresh".to_string(), json!(now_iso()));
    }
    auth_state.access_token = payload
        .get("access_token")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    auth_state.refresh_token = refresh_token;
    auth_state.account_id = account_id;
    save_auth_json(auth_state)?;
    Ok(payload)
}

fn check_endpoint_reachability(endpoint: &str) -> Value {
    let url = match Url::parse(endpoint) {
        Ok(url) => url,
        Err(error) => {
            return json!({
                "endpoint": endpoint,
                "reachable": false,
                "error": error.to_string(),
            });
        }
    };
    let host = url.host_str().unwrap_or_default().to_string();
    let port = url.port_or_known_default().unwrap_or(443);
    let mut reachable = false;
    let mut dns_resolved = false;
    let mut tcp_connected = false;
    let mut addresses = Vec::<String>::new();
    let mut error_text: Option<String> = None;

    match (host.as_str(), port).to_socket_addrs() {
        Ok(iter) => {
            dns_resolved = true;
            for address in iter {
                addresses.push(address.ip().to_string());
                if TcpStream::connect_timeout(&address, Duration::from_secs(ENDPOINT_CHECK_TIMEOUT))
                    .is_ok()
                {
                    tcp_connected = true;
                    reachable = true;
                    break;
                }
            }
            if !tcp_connected {
                error_text = Some("No address accepted a TCP connection.".to_string());
            }
        }
        Err(error) => {
            error_text = Some(error.to_string());
        }
    }

    json!({
        "endpoint": endpoint,
        "host": host,
        "port": port,
        "scheme": url.scheme(),
        "dns_resolved": dns_resolved,
        "tcp_connected": tcp_connected,
        "tls_ok": if url.scheme() == "https" { Value::Bool(reachable) } else { Value::Null },
        "reachable": reachable,
        "addresses": addresses,
        "error": error_text,
    })
}

fn maybe_add_value(target: &mut Map<String, Value>, key: &str, value: Option<Value>) {
    if let Some(value) = value {
        target.insert(key.to_string(), value);
    }
}

#[allow(clippy::too_many_arguments)]
pub fn build_openai_image_body(
    operation: &str,
    prompt: &str,
    model: &str,
    ref_images: &[String],
    mask: Option<&str>,
    input_fidelity: Option<InputFidelity>,
    background: Background,
    size: Option<&str>,
    quality: Option<Quality>,
    output_format: Option<OutputFormat>,
    output_compression: Option<u8>,
    n: Option<u8>,
    moderation: Option<Moderation>,
) -> Value {
    let mut body = Map::new();
    body.insert("model".to_string(), json!(model));
    body.insert("prompt".to_string(), json!(prompt));
    body.insert("background".to_string(), json!(background.as_str()));
    maybe_add_value(&mut body, "size", size.map(|value| json!(value)));
    maybe_add_value(
        &mut body,
        "quality",
        quality.map(|value| json!(value.as_str())),
    );
    maybe_add_value(
        &mut body,
        "output_format",
        output_format.map(|value| json!(value.as_str())),
    );
    maybe_add_value(
        &mut body,
        "output_compression",
        output_compression.map(|value| json!(value)),
    );
    maybe_add_value(&mut body, "n", n.map(|value| json!(value)));
    maybe_add_value(
        &mut body,
        "moderation",
        moderation.map(|value| json!(value.as_str())),
    );
    if operation == "edit" {
        body.insert(
            "images".to_string(),
            Value::Array(
                ref_images
                    .iter()
                    .map(|image_url| json!({ "image_url": image_url }))
                    .collect(),
            ),
        );
        if let Some(mask) = mask {
            body.insert("mask".to_string(), json!({ "image_url": mask }));
        }
        maybe_add_value(
            &mut body,
            "input_fidelity",
            input_fidelity.map(|value| json!(value.as_str())),
        );
    }
    Value::Object(body)
}

#[allow(clippy::too_many_arguments)]
fn build_codex_image_body(
    prompt: &str,
    model: &str,
    instructions: &str,
    ref_images: &[String],
    background: Background,
    size: Option<&str>,
    quality: Option<Quality>,
    output_format: Option<OutputFormat>,
    output_compression: Option<u8>,
    action: &str,
) -> Value {
    let mut content = Vec::new();
    for image_url in ref_images {
        content.push(json!({"type": "input_image", "image_url": image_url}));
    }
    content.push(json!({"type": "input_text", "text": prompt}));
    let mut tool = Map::new();
    tool.insert("type".to_string(), json!("image_generation"));
    tool.insert("background".to_string(), json!(background.as_str()));
    tool.insert("action".to_string(), json!(action));
    maybe_add_value(&mut tool, "size", size.map(|value| json!(value)));
    maybe_add_value(
        &mut tool,
        "quality",
        quality.map(|value| json!(value.as_str())),
    );
    maybe_add_value(
        &mut tool,
        "output_format",
        output_format.map(|value| json!(value.as_str())),
    );
    maybe_add_value(
        &mut tool,
        "output_compression",
        output_compression.map(|value| json!(value)),
    );

    json!({
        "model": model,
        "instructions": instructions,
        "store": false,
        "stream": true,
        "input": [
            {
                "role": "user",
                "content": content,
            }
        ],
        "tools": [Value::Object(tool)],
    })
}

fn summarize_large_string(key: Option<&str>, value: &str) -> Value {
    let lowered = key.unwrap_or_default().to_ascii_lowercase();
    if value.starts_with("data:image/") {
        let (prefix, encoded) = value.split_once(',').unwrap_or((value, ""));
        return json!({
            "_omitted": "data_url",
            "prefix": prefix,
            "base64_chars": encoded.len(),
        });
    }
    if lowered == "result" || lowered.contains("partial_image") || is_probably_base64(value) {
        return json!({
            "_omitted": "base64",
            "base64_chars": value.len(),
        });
    }
    json!({
        "_omitted": "string",
        "chars": value.len(),
    })
}

fn redact_event_payload(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut redacted = Map::new();
            for (key, child) in object {
                let lowered = key.to_ascii_lowercase();
                if [
                    "access_token",
                    "refresh_token",
                    "id_token",
                    "authorization",
                    "api_key",
                ]
                .contains(&lowered.as_str())
                {
                    redacted.insert(key.clone(), json!({"_omitted": "secret"}));
                } else {
                    redacted.insert(key.clone(), redact_value_with_key(Some(key), child));
                }
            }
            Value::Object(redacted)
        }
        Value::Array(items) => Value::Array(items.iter().map(redact_event_payload).collect()),
        _ => value.clone(),
    }
}

fn redact_value_with_key(key: Option<&str>, value: &Value) -> Value {
    match value {
        Value::Object(_) | Value::Array(_) => redact_event_payload(value),
        Value::String(text) => {
            let lowered = key.unwrap_or_default().to_ascii_lowercase();
            if text.starts_with("data:image/")
                || lowered == "result"
                || lowered == "image_url"
                || lowered == "b64_json"
                || lowered.contains("partial_image")
                || (text.len() >= 512 && is_probably_base64(text))
            {
                summarize_large_string(key, text)
            } else {
                value.clone()
            }
        }
        _ => value.clone(),
    }
}

fn is_probably_base64(value: &str) -> bool {
    if value.len() < 128 {
        return false;
    }
    value
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || "+/=\n\r".contains(character))
}

fn emit_progress_event(
    logger: &mut JsonEventLogger,
    provider: &str,
    phase: &str,
    message: &str,
    status: &str,
    percent: Option<u8>,
    extra: Value,
) {
    let mut data = json!({
        "provider": provider,
        "phase": phase,
        "status": status,
        "message": message,
    });
    if let Some(percent) = percent {
        data["percent"] = json!(percent);
    }
    if let Some(object) = extra.as_object() {
        for (key, value) in object {
            data[key] = redact_value_with_key(Some(key), value);
        }
    }
    logger.emit("progress", phase, data);
}

fn emit_sse_event(logger: &mut JsonEventLogger, event: &Value) {
    let event_type = event
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    logger.emit("sse", event_type, redact_event_payload(event));
}

fn build_known_model_payloads() -> Value {
    json!({
        "openai": {
            "default_model": DEFAULT_OPENAI_MODEL,
            "model_presets": [{
                "id": DEFAULT_OPENAI_MODEL,
                "default": true,
                "source": "official_default",
                "notes": "Official API-key image generation model."
            }],
            "operations": [
                {"id": "generate", "command": "images generate", "requires_ref_image": false},
                {"id": "edit", "command": "images edit", "requires_ref_image": true}
            ],
            "supports": ["background", "size", "quality", "format", "compression", "n", "moderation", "mask", "input_fidelity"]
        },
        "codex": {
            "default_model": DEFAULT_CODEX_MODEL,
            "model_presets": [
                {"id": "gpt-5.4", "default": true, "source": "local_preset", "notes": "Validated default for the Codex responses image path."},
                {"id": "gpt-5.4-mini", "default": false, "source": "local_preset", "notes": "Pass explicitly when the account exposes this Codex model."},
                {"id": "gpt-5.4-pro", "default": false, "source": "local_preset", "notes": "Pass explicitly when the account exposes this Codex model."}
            ],
            "image_generation_tool": {
                "type": "image_generation",
                "delegated_model": DELEGATED_IMAGE_MODEL,
                "operations": [
                    {"id": "generate", "command": "images generate", "requires_ref_image": false},
                    {"id": "edit", "command": "images edit", "requires_ref_image": true}
                ],
                "supports": ["background", "size", "quality", "format", "compression", "action", "json_events", "auth_refresh"]
            }
        }
    })
}

fn read_body_json(path: &str) -> Result<Value, AppError> {
    let raw = if path == "-" {
        let mut full = String::new();
        let mut stdin = io::stdin();
        stdin.read_to_string(&mut full).map_err(|error| {
            AppError::new("invalid_body_json", "Unable to read stdin body.")
                .with_detail(json!({ "error": error.to_string() }))
        })?;
        full
    } else {
        fs::read_to_string(path).map_err(|error| {
            AppError::new("invalid_body_json", "Unable to read request body.")
                .with_detail(json!({"error": error.to_string(), "body_file": path}))
        })?
    };
    let parsed: Value = serde_json::from_str(&raw).map_err(|error| {
        AppError::new("invalid_body_json", "Request body must be valid JSON.")
            .with_detail(json!({ "error": error.to_string() }))
    })?;
    if !parsed.is_object() {
        return Err(AppError::new(
            "invalid_body_json",
            "Request body must be a JSON object.",
        ));
    }
    Ok(parsed)
}

fn configured_provider_selection(
    requested: &str,
    provider: &ProviderConfig,
    reason: &str,
    api_key_override: Option<&str>,
) -> Result<ProviderSelection, AppError> {
    let edit_region_mode = provider
        .edit_region_mode
        .as_deref()
        .map(normalize_edit_region_mode)
        .transpose()?;
    match provider.provider_type.as_str() {
        "openai" | "openai-compatible" => {
            let api_base = provider
                .api_base
                .clone()
                .unwrap_or_else(|| DEFAULT_OPENAI_API_BASE.to_string());
            if api_key_override
                .map(|value| value.trim().is_empty())
                .unwrap_or(true)
            {
                let _ = get_provider_credential(requested, provider, "api_key")?;
            }
            Ok(ProviderSelection {
                requested: requested.to_string(),
                resolved: requested.to_string(),
                reason: reason.to_string(),
                kind: ProviderKind::OpenAi,
                api_base,
                codex_endpoint: DEFAULT_CODEX_ENDPOINT.to_string(),
                default_model: provider
                    .model
                    .clone()
                    .unwrap_or_else(|| DEFAULT_OPENAI_MODEL.to_string()),
                supports_n: provider
                    .supports_n
                    .unwrap_or(provider.provider_type == "openai"),
                edit_region_mode: edit_region_mode.unwrap_or_else(|| {
                    default_edit_region_mode(&provider.provider_type).to_string()
                }),
            })
        }
        "codex" => {
            let _ = get_provider_credential(requested, provider, "access_token")?;
            Ok(ProviderSelection {
                requested: requested.to_string(),
                resolved: requested.to_string(),
                reason: reason.to_string(),
                kind: ProviderKind::Codex,
                api_base: DEFAULT_OPENAI_API_BASE.to_string(),
                codex_endpoint: provider
                    .endpoint
                    .clone()
                    .unwrap_or_else(|| DEFAULT_CODEX_ENDPOINT.to_string()),
                default_model: provider
                    .model
                    .clone()
                    .unwrap_or_else(|| DEFAULT_CODEX_MODEL.to_string()),
                supports_n: false,
                edit_region_mode: edit_region_mode
                    .unwrap_or_else(|| EDIT_REGION_REFERENCE_HINT.to_string()),
            })
        }
        other => Err(AppError::new(
            "provider_kind_unsupported",
            format!("Unsupported provider type: {other}"),
        )
        .with_detail(json!({"provider": requested, "type": other}))),
    }
}

const EDIT_REGION_NATIVE_MASK: &str = "native-mask";
const EDIT_REGION_REFERENCE_HINT: &str = "reference-hint";
const EDIT_REGION_NONE: &str = "none";

fn default_edit_region_mode(provider_type: &str) -> &'static str {
    match provider_type {
        "openai" => EDIT_REGION_NATIVE_MASK,
        "codex" => EDIT_REGION_REFERENCE_HINT,
        _ => EDIT_REGION_REFERENCE_HINT,
    }
}

fn normalize_edit_region_mode(value: &str) -> Result<String, AppError> {
    match value {
        EDIT_REGION_NATIVE_MASK | EDIT_REGION_REFERENCE_HINT | EDIT_REGION_NONE => {
            Ok(value.to_string())
        }
        other => Err(AppError::new(
            "invalid_provider_config",
            format!("Unsupported edit_region_mode: {other}"),
        )
        .with_detail(json!({
            "allowed": [EDIT_REGION_NATIVE_MASK, EDIT_REGION_REFERENCE_HINT, EDIT_REGION_NONE]
        }))),
    }
}

fn select_configured_provider(
    cli: &Cli,
    requested: &str,
    reason: &str,
) -> Result<ProviderSelection, AppError> {
    let config_path = cli_config_path(cli);
    let config = load_app_config(&config_path)?;
    let provider = config.providers.get(requested).ok_or_else(|| {
        AppError::new("provider_unknown", format!("Unknown provider: {requested}"))
            .with_detail(json!({"config_file": config_path.display().to_string()}))
    })?;
    configured_provider_selection(requested, provider, reason, cli.api_key.as_deref())
}

fn select_builtin_provider(cli: &Cli, requested: &str) -> Result<ProviderSelection, AppError> {
    if matches!(requested, "openai" | "codex") {
        let config_path = cli_config_path(cli);
        let config = load_app_config(&config_path)?;
        if let Some(provider) = config.providers.get(requested) {
            return configured_provider_selection(
                requested,
                provider,
                "explicit_config_provider",
                cli.api_key.as_deref(),
            );
        }
    }

    let auth_path = PathBuf::from(&cli.auth_file);
    let openai_ready = inspect_openai_auth(cli.api_key.as_deref())
        .get("ready")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let codex_ready = inspect_codex_auth_file(&auth_path)
        .get("ready")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    match requested {
        "openai" => {
            if !openai_ready {
                return Err(AppError::new(
                    "api_key_missing",
                    format!("Missing {}.", OPENAI_API_KEY_ENV),
                ));
            }
            Ok(ProviderSelection {
                requested: requested.to_string(),
                resolved: "openai".to_string(),
                reason: "explicit".to_string(),
                kind: ProviderKind::OpenAi,
                api_base: cli.openai_api_base.clone(),
                codex_endpoint: cli.endpoint.clone(),
                default_model: DEFAULT_OPENAI_MODEL.to_string(),
                supports_n: true,
                edit_region_mode: EDIT_REGION_NATIVE_MASK.to_string(),
            })
        }
        "codex" => {
            if !codex_ready {
                return Err(AppError::new(
                    "access_token_missing",
                    format!("Missing access_token in {}", auth_path.display()),
                ));
            }
            Ok(ProviderSelection {
                requested: requested.to_string(),
                resolved: "codex".to_string(),
                reason: "explicit".to_string(),
                kind: ProviderKind::Codex,
                api_base: cli.openai_api_base.clone(),
                codex_endpoint: cli.endpoint.clone(),
                default_model: DEFAULT_CODEX_MODEL.to_string(),
                supports_n: false,
                edit_region_mode: EDIT_REGION_REFERENCE_HINT.to_string(),
            })
        }
        "auto" => {
            let config_path = cli_config_path(cli);
            let config = load_app_config(&config_path)?;
            if let Some(default_provider) = config.default_provider.as_deref()
                && let Some(provider) = config.providers.get(default_provider)
            {
                return configured_provider_selection(
                    default_provider,
                    provider,
                    "config_default_provider",
                    cli.api_key.as_deref(),
                );
            }
            if openai_ready {
                Ok(ProviderSelection {
                    requested: "auto".to_string(),
                    resolved: "openai".to_string(),
                    reason: "auto_openai_api_key".to_string(),
                    kind: ProviderKind::OpenAi,
                    api_base: cli.openai_api_base.clone(),
                    codex_endpoint: cli.endpoint.clone(),
                    default_model: DEFAULT_OPENAI_MODEL.to_string(),
                    supports_n: true,
                    edit_region_mode: EDIT_REGION_NATIVE_MASK.to_string(),
                })
            } else if codex_ready {
                Ok(ProviderSelection {
                    requested: "auto".to_string(),
                    resolved: "codex".to_string(),
                    reason: "auto_codex_auth".to_string(),
                    kind: ProviderKind::Codex,
                    api_base: cli.openai_api_base.clone(),
                    codex_endpoint: cli.endpoint.clone(),
                    default_model: DEFAULT_CODEX_MODEL.to_string(),
                    supports_n: false,
                    edit_region_mode: EDIT_REGION_REFERENCE_HINT.to_string(),
                })
            } else {
                Err(
                    AppError::new("provider_unavailable", "No usable provider auth was found.")
                        .with_detail(json!({
                            "openai": inspect_openai_auth(cli.api_key.as_deref()),
                            "codex": inspect_codex_auth_file(&auth_path),
                            "config_file": config_path.display().to_string(),
                            "configured_providers": config.providers.keys().cloned().collect::<Vec<_>>(),
                        })),
                )
            }
        }
        _ => select_configured_provider(cli, requested, "explicit_config_provider"),
    }
}

fn select_image_provider(cli: &Cli) -> Result<ProviderSelection, AppError> {
    let requested = cli.provider.trim();
    select_builtin_provider(
        cli,
        if requested.is_empty() {
            "auto"
        } else {
            requested
        },
    )
}

fn select_request_provider(
    cli: &Cli,
    args: &RequestCreateArgs,
) -> Result<ProviderSelection, AppError> {
    let requested = cli.provider.trim();
    if requested != "auto" && !requested.is_empty() {
        return select_image_provider(cli);
    }
    let config_path = cli_config_path(cli);
    let config = load_app_config(&config_path)?;
    if let Some(default_provider) = config.default_provider.as_deref()
        && let Some(provider) = config.providers.get(default_provider)
    {
        return configured_provider_selection(
            default_provider,
            provider,
            "config_default_provider",
            cli.api_key.as_deref(),
        );
    }
    if args.request_operation == RequestOperation::Responses
        && inspect_codex_auth_file(Path::new(&cli.auth_file))
            .get("ready")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    {
        return Ok(ProviderSelection {
            requested: "auto".to_string(),
            resolved: "codex".to_string(),
            reason: "auto_request_responses".to_string(),
            kind: ProviderKind::Codex,
            api_base: cli.openai_api_base.clone(),
            codex_endpoint: cli.endpoint.clone(),
            default_model: DEFAULT_CODEX_MODEL.to_string(),
            supports_n: false,
            edit_region_mode: EDIT_REGION_REFERENCE_HINT.to_string(),
        });
    }
    if matches!(
        args.request_operation,
        RequestOperation::Generate | RequestOperation::Edit
    ) && inspect_openai_auth(cli.api_key.as_deref())
        .get("ready")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return Ok(ProviderSelection {
            requested: "auto".to_string(),
            resolved: "openai".to_string(),
            reason: "auto_request_images".to_string(),
            kind: ProviderKind::OpenAi,
            api_base: cli.openai_api_base.clone(),
            codex_endpoint: cli.endpoint.clone(),
            default_model: DEFAULT_OPENAI_MODEL.to_string(),
            supports_n: true,
            edit_region_mode: EDIT_REGION_NATIVE_MASK.to_string(),
        });
    }
    select_image_provider(cli)
}

fn validate_provider_specific_image_args(
    selection: &ProviderSelection,
    shared: &SharedImageArgs,
    mask: Option<&str>,
    input_fidelity: Option<InputFidelity>,
) -> Result<(), AppError> {
    if matches!(selection.kind, ProviderKind::Codex) {
        if shared.n.unwrap_or(1) != 1 {
            return Err(AppError::new(
                "unsupported_option",
                "--n is supported by the openai provider.",
            ));
        }
        if shared.moderation.is_some() {
            return Err(AppError::new(
                "unsupported_option",
                "--moderation is supported by the openai provider.",
            ));
        }
        if mask.is_some() {
            return Err(AppError::new(
                "unsupported_option",
                "--mask requires a provider with native-mask region editing.",
            ));
        }
        if input_fidelity.is_some() {
            return Err(AppError::new(
                "unsupported_option",
                "--input-fidelity is supported by the openai provider.",
            ));
        }
    }
    if mask.is_some() && selection.edit_region_mode != EDIT_REGION_NATIVE_MASK {
        return Err(AppError::new(
            "unsupported_option",
            "--mask requires a provider with native-mask region editing.",
        )
        .with_detail(json!({
            "provider": selection.resolved,
            "edit_region_mode": selection.edit_region_mode,
        })));
    }
    if matches!(selection.kind, ProviderKind::OpenAi) && shared.instructions != DEFAULT_INSTRUCTIONS
    {
        return Err(AppError::new(
            "unsupported_option",
            "--instructions is supported by the codex provider.",
        ));
    }
    Ok(())
}

fn validate_reference_image_count(count: usize) -> Result<(), AppError> {
    if count > MAX_REFERENCE_IMAGES {
        return Err(AppError::new(
            "ref_image_too_many",
            format!("At most {MAX_REFERENCE_IMAGES} reference images are supported."),
        )
        .with_detail(json!({
            "max": MAX_REFERENCE_IMAGES,
            "actual": count,
        })));
    }
    Ok(())
}

fn should_retry(error: &AppError) -> bool {
    if let Some(status_code) = error.status_code {
        return status_code == 429 || status_code >= 500;
    }
    matches!(
        error.code.as_str(),
        "network_error" | "request_failed" | "refresh_failed"
    )
}

fn compute_retry_delay_seconds(retry_number: usize) -> u64 {
    DEFAULT_RETRY_DELAY_SECONDS * (2_u64.pow((retry_number.saturating_sub(1)) as u32))
}

fn execute_openai_with_retry<T, F>(
    logger: &mut JsonEventLogger,
    provider: &str,
    mut run_once: F,
) -> Result<(T, usize), AppError>
where
    F: FnMut(&mut JsonEventLogger) -> Result<T, AppError>,
{
    let mut retry_count = 0;
    loop {
        match run_once(logger) {
            Ok(value) => return Ok((value, retry_count)),
            Err(error) => {
                if retry_count >= DEFAULT_RETRY_COUNT || !should_retry(&error) {
                    return Err(error);
                }
                retry_count += 1;
                let delay_seconds = compute_retry_delay_seconds(retry_count);
                emit_progress_event(
                    logger,
                    provider,
                    "retry_scheduled",
                    "Retry scheduled after transient failure.",
                    "running",
                    None,
                    json!({
                        "retry_number": retry_count,
                        "max_retries": DEFAULT_RETRY_COUNT,
                        "delay_seconds": delay_seconds,
                        "reason": error.message,
                        "status_code": error.status_code,
                    }),
                );
                std::thread::sleep(Duration::from_secs(delay_seconds));
            }
        }
    }
}

fn request_codex_with_retry(
    endpoint: &str,
    auth_state: &mut CodexAuthState,
    body: &Value,
    logger: &mut JsonEventLogger,
) -> Result<(Value, bool, usize), AppError> {
    let mut auth_refreshed = false;
    let mut retry_count = 0;
    loop {
        match request_codex_responses_once(endpoint, auth_state, body, logger) {
            Ok(value) => return Ok((value, auth_refreshed, retry_count)),
            Err(error) => {
                if error.status_code == Some(401) && !auth_refreshed {
                    emit_progress_event(
                        logger,
                        "codex",
                        "auth_refresh_started",
                        "Refreshing Codex access token.",
                        "running",
                        Some(2),
                        json!({ "endpoint": REFRESH_ENDPOINT }),
                    );
                    let payload = refresh_access_token(auth_state)?;
                    logger.emit(
                        "local",
                        "auth.refresh.completed",
                        redact_event_payload(&payload),
                    );
                    emit_progress_event(
                        logger,
                        "codex",
                        "auth_refresh_completed",
                        "Codex access token refreshed.",
                        "running",
                        Some(4),
                        json!({}),
                    );
                    auth_refreshed = true;
                    continue;
                }
                if retry_count >= DEFAULT_RETRY_COUNT || !should_retry(&error) {
                    return Err(error);
                }
                retry_count += 1;
                let delay_seconds = compute_retry_delay_seconds(retry_count);
                emit_progress_event(
                    logger,
                    "codex",
                    "retry_scheduled",
                    "Retry scheduled after transient failure.",
                    "running",
                    None,
                    json!({
                        "retry_number": retry_count,
                        "max_retries": DEFAULT_RETRY_COUNT,
                        "delay_seconds": delay_seconds,
                        "reason": error.message,
                        "status_code": error.status_code,
                    }),
                );
                std::thread::sleep(Duration::from_secs(delay_seconds));
            }
        }
    }
}

fn request_codex_responses_once(
    endpoint: &str,
    auth_state: &CodexAuthState,
    body: &Value,
    logger: &mut JsonEventLogger,
) -> Result<Value, AppError> {
    logger.emit(
        "local",
        "request.started",
        json!({"provider": "codex", "endpoint": endpoint}),
    );
    emit_progress_event(
        logger,
        "codex",
        "request_started",
        "Codex image request sent.",
        "running",
        Some(0),
        json!({ "endpoint": endpoint }),
    );
    let client = make_client(DEFAULT_REQUEST_TIMEOUT)?;
    let response = client
        .post(endpoint)
        .header(AUTHORIZATION, format!("Bearer {}", auth_state.access_token))
        .header("ChatGPT-Account-ID", auth_state.account_id.as_str())
        .header(CONTENT_TYPE, "application/json")
        .header(ACCEPT, "text/event-stream")
        .header("originator", "codex_desktop")
        .body(body.to_string())
        .send()
        .map_err(|error| {
            AppError::new("network_error", "Codex request failed.")
                .with_detail(json!({ "error": error.to_string() }))
        })?;
    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().unwrap_or_else(|_| String::new());
        return Err(http_status_error(status, detail));
    }

    let mut response_meta = json!({});
    let mut output_items: Vec<Value> = Vec::new();
    let mut response_error: Option<Value> = None;
    let reader = BufReader::new(response);
    let mut data_lines: Vec<String> = Vec::new();

    for line in reader.lines() {
        let line = line.map_err(|error| {
            AppError::new("request_failed", "Unable to read Codex SSE response.")
                .with_detail(json!({ "error": error.to_string() }))
        })?;
        if line.trim().is_empty() {
            if !data_lines.is_empty() {
                handle_sse_payload(
                    &data_lines.join(""),
                    logger,
                    &mut response_meta,
                    &mut output_items,
                    &mut response_error,
                )?;
                data_lines.clear();
            }
            continue;
        }
        if let Some(data) = line.strip_prefix("data:") {
            data_lines.push(data.trim_start().to_string());
        }
    }
    if !data_lines.is_empty() {
        handle_sse_payload(
            &data_lines.join(""),
            logger,
            &mut response_meta,
            &mut output_items,
            &mut response_error,
        )?;
    }

    let image_items = extract_codex_image_items(&output_items);
    if response_error.is_some() && image_items.is_empty() {
        let error_message = format_response_error(response_error.as_ref());
        return Err(AppError::new("request_failed", error_message));
    }
    emit_progress_event(
        logger,
        "codex",
        "request_completed",
        "Codex response payload received.",
        "running",
        Some(97),
        json!({
            "response_id": response_meta.get("id").cloned().unwrap_or(Value::Null),
            "image_count": image_items.len(),
        }),
    );
    Ok(json!({
        "response": response_meta,
        "output_items": output_items,
        "image_items": image_items,
    }))
}

fn handle_sse_payload(
    payload: &str,
    logger: &mut JsonEventLogger,
    response_meta: &mut Value,
    output_items: &mut Vec<Value>,
    response_error: &mut Option<Value>,
) -> Result<(), AppError> {
    if payload == "[DONE]" {
        logger.emit("sse", "done", json!({"raw": "[DONE]"}));
        return Ok(());
    }
    let event: Value = serde_json::from_str(payload).map_err(|error| {
        AppError::new("request_failed", "Unable to parse Codex SSE event.")
            .with_detail(json!({ "error": error.to_string(), "payload": payload }))
    })?;
    emit_sse_event(logger, &event);
    let event_type = event
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    match event_type {
        "response.created" => {
            if let Some(created) = event.get("response") {
                *response_meta = created.clone();
                emit_progress_event(
                    logger,
                    "codex",
                    "response_created",
                    "Codex accepted the image request.",
                    "running",
                    Some(15),
                    json!({
                        "response_id": created.get("id"),
                        "model": created.get("model"),
                    }),
                );
            }
        }
        "response.output_item.done" => {
            if let Some(item) = event.get("item") {
                merge_output_items(output_items, std::slice::from_ref(item));
                emit_progress_event(
                    logger,
                    "codex",
                    "output_item_done",
                    "Codex finished one output item.",
                    "running",
                    Some(85),
                    json!({
                        "item_id": item.get("id"),
                        "item_type": item.get("type"),
                        "item_status": item.get("status"),
                        "image_count": extract_codex_image_items(output_items).len(),
                    }),
                );
            }
        }
        "error" => {
            *response_error = event.get("error").cloned();
            emit_progress_event(
                logger,
                "codex",
                "request_failed",
                "Codex reported an image generation error.",
                "failed",
                None,
                json!({ "error": event.get("error") }),
            );
        }
        "response.failed" => {
            if let Some(failed_response) = event.get("response") {
                *response_meta = failed_response.clone();
                if let Some(output) = failed_response.get("output").and_then(Value::as_array) {
                    merge_output_items(output_items, output);
                }
                *response_error = failed_response
                    .get("error")
                    .cloned()
                    .or_else(|| response_error.clone());
                emit_progress_event(
                    logger,
                    "codex",
                    "request_failed",
                    "Codex marked the image request as failed.",
                    "failed",
                    None,
                    json!({
                        "response_id": failed_response.get("id"),
                        "error": response_error.clone(),
                    }),
                );
            }
        }
        "response.completed" => {
            if let Some(completed) = event.get("response") {
                *response_meta = completed.clone();
                emit_progress_event(
                    logger,
                    "codex",
                    "response_completed",
                    "Codex completed the server-side image response.",
                    "running",
                    Some(95),
                    json!({
                        "response_id": completed.get("id"),
                        "image_count": extract_codex_image_items(output_items).len(),
                    }),
                );
            }
        }
        _ => {}
    }
    Ok(())
}

fn merge_output_items(existing: &mut Vec<Value>, incoming: &[Value]) {
    for item in incoming {
        let item_id = item.get("id").and_then(Value::as_str);
        if let Some(item_id) = item_id
            && let Some(position) = existing
                .iter()
                .position(|candidate| candidate.get("id").and_then(Value::as_str) == Some(item_id))
        {
            existing[position] = item.clone();
            continue;
        }
        existing.push(item.clone());
    }
}

fn extract_codex_image_items(output_items: &[Value]) -> Vec<Value> {
    output_items
        .iter()
        .filter(|item| {
            item.get("type").and_then(Value::as_str) == Some("image_generation_call")
                && item.get("result").and_then(Value::as_str).is_some()
        })
        .cloned()
        .collect()
}

fn format_response_error(error: Option<&Value>) -> String {
    let Some(error) = error else {
        return "Image generation failed without structured error details.".to_string();
    };
    if let Some(object) = error.as_object() {
        let code = object
            .get("code")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let message = object
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Image generation failed");
        if !code.is_empty() {
            return format!("{code}: {message}");
        }
        return message.to_string();
    }
    "Image generation failed without structured error details.".to_string()
}

fn request_openai_images_once(
    endpoint: &str,
    auth_state: &OpenAiAuthState,
    body: &Value,
    logger: &mut JsonEventLogger,
) -> Result<Value, AppError> {
    logger.emit(
        "local",
        "request.started",
        json!({"provider": "openai", "endpoint": endpoint}),
    );
    emit_progress_event(
        logger,
        "openai",
        "request_started",
        "OpenAI image request sent.",
        "running",
        Some(0),
        json!({ "endpoint": endpoint }),
    );
    let client = make_client(DEFAULT_REQUEST_TIMEOUT)?;
    let response = client
        .post(endpoint)
        .header(AUTHORIZATION, format!("Bearer {}", auth_state.api_key))
        .header(CONTENT_TYPE, "application/json")
        .header(ACCEPT, "application/json")
        .body(body.to_string())
        .send()
        .map_err(|error| {
            AppError::new("network_error", "OpenAI request failed.")
                .with_detail(json!({ "error": error.to_string() }))
        })?;
    parse_openai_json_response(response, logger)
}

fn request_openai_edit_once(
    endpoint: &str,
    auth_state: &OpenAiAuthState,
    body: &Value,
    logger: &mut JsonEventLogger,
) -> Result<Value, AppError> {
    logger.emit(
        "local",
        "request.started",
        json!({"provider": "openai", "endpoint": endpoint, "transport": "multipart"}),
    );
    emit_progress_event(
        logger,
        "openai",
        "request_started",
        "OpenAI multipart image edit request started.",
        "running",
        Some(0),
        json!({ "endpoint": endpoint, "transport": "multipart" }),
    );
    let form = build_openai_edit_form(body)?;
    emit_progress_event(
        logger,
        "openai",
        "multipart_prepared",
        "OpenAI multipart image payload prepared.",
        "running",
        Some(10),
        json!({ "transport": "multipart" }),
    );
    let client = make_client(DEFAULT_REQUEST_TIMEOUT)?;
    let response = client
        .post(endpoint)
        .header(AUTHORIZATION, format!("Bearer {}", auth_state.api_key))
        .multipart(form)
        .send()
        .map_err(|error| {
            AppError::new("network_error", "OpenAI multipart request failed.")
                .with_detail(json!({ "error": error.to_string() }))
        })?;
    parse_openai_json_response(response, logger)
}

fn parse_openai_json_response(
    response: Response,
    logger: &mut JsonEventLogger,
) -> Result<Value, AppError> {
    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().unwrap_or_else(|_| String::new());
        return Err(http_status_error(status, detail));
    }
    let payload: Value = response.json().map_err(|error| {
        AppError::new(
            "invalid_json_response",
            "OpenAI Images API returned invalid JSON.",
        )
        .with_detail(json!({ "error": error.to_string() }))
    })?;
    if !payload.is_object() {
        return Err(AppError::new(
            "invalid_json_response",
            "OpenAI Images API returned a non-object JSON payload.",
        ));
    }
    emit_progress_event(
        logger,
        "openai",
        "request_completed",
        "OpenAI image response received.",
        "running",
        Some(95),
        json!({
            "created": payload.get("created"),
            "image_count": payload.get("data").and_then(Value::as_array).map(|items| items.len()).unwrap_or(0),
        }),
    );
    Ok(payload)
}

fn build_openai_edit_form(body: &Value) -> Result<Form, AppError> {
    let object = json_object(body)?;
    let mut form = Form::new();
    for key in [
        "model",
        "prompt",
        "size",
        "quality",
        "background",
        "output_format",
        "output_compression",
        "n",
        "moderation",
        "input_fidelity",
    ] {
        if let Some(value) = object.get(key)
            && let Some(scalar) = coerce_multipart_scalar(value)
        {
            form = form.text(key.to_string(), scalar);
        }
    }
    let images = extract_openai_edit_image_sources(body)?;
    if images.is_empty() {
        return Err(AppError::new(
            "missing_image_result",
            "OpenAI edit requests require at least one input image.",
        ));
    }
    for (index, source) in images.iter().enumerate() {
        let (mime_type, bytes, file_name) =
            load_image_source_bytes(source, &format!("image-{}", index + 1))?;
        let part = Part::bytes(bytes)
            .file_name(file_name)
            .mime_str(&mime_type)
            .map_err(|error| {
                AppError::new(
                    "ref_image_invalid",
                    "Invalid image MIME type for multipart edit.",
                )
                .with_detail(json!({ "error": error.to_string() }))
            })?;
        form = form.part("image[]", part);
    }
    if let Some(mask_source) = extract_openai_mask_source(body)? {
        let (mime_type, bytes, file_name) = load_image_source_bytes(&mask_source, "mask")?;
        let part = Part::bytes(bytes)
            .file_name(file_name)
            .mime_str(&mime_type)
            .map_err(|error| {
                AppError::new(
                    "ref_image_invalid",
                    "Invalid mask MIME type for multipart edit.",
                )
                .with_detail(json!({ "error": error.to_string() }))
            })?;
        form = form.part("mask", part);
    }
    Ok(form)
}

fn extract_openai_edit_image_sources(body: &Value) -> Result<Vec<String>, AppError> {
    let object = json_object(body)?;
    if let Some(images) = object.get("images").and_then(Value::as_array) {
        let mut result = Vec::new();
        for entry in images {
            if let Some(text) = entry.as_str() {
                result.push(text.to_string());
                continue;
            }
            if let Some(image_url) = entry
                .as_object()
                .and_then(|item| item.get("image_url"))
                .and_then(Value::as_str)
            {
                result.push(image_url.to_string());
            }
        }
        return Ok(result);
    }
    if let Some(image) = object.get("image")
        && let Some(text) = image.as_str()
    {
        return Ok(vec![text.to_string()]);
    }
    Ok(Vec::new())
}

fn extract_openai_mask_source(body: &Value) -> Result<Option<String>, AppError> {
    let object = json_object(body)?;
    if let Some(mask) = object.get("mask") {
        if let Some(text) = mask.as_str() {
            return Ok(Some(text.to_string()));
        }
        if let Some(image_url) = mask
            .as_object()
            .and_then(|item| item.get("image_url"))
            .and_then(Value::as_str)
        {
            return Ok(Some(image_url.to_string()));
        }
    }
    Ok(None)
}

fn coerce_multipart_scalar(value: &Value) -> Option<String> {
    match value {
        Value::Null => None,
        Value::Bool(value) => Some(if *value { "true" } else { "false" }.to_string()),
        Value::Number(value) => Some(value.to_string()),
        Value::String(value) => Some(value.clone()),
        _ => None,
    }
}

fn decode_base64_bytes(value: &str) -> Result<Vec<u8>, AppError> {
    let encoded = if value.starts_with("data:image/") {
        value
            .split_once(',')
            .ok_or_else(|| {
                AppError::new(
                    "invalid_base64",
                    "Image data URL did not contain a comma separator.",
                )
            })?
            .1
    } else {
        value
    };
    STANDARD.decode(encoded).map_err(|_| {
        AppError::new("invalid_base64", "Image payload was not valid base64.")
            .with_detail(json!({ "length": encoded.len() }))
    })
}

fn detect_mime_type(path: &Path, bytes: &[u8]) -> Result<String, AppError> {
    if let Some(mime) = mime_guess::from_path(path).first_raw()
        && mime.starts_with("image/")
    {
        return Ok(mime.to_string());
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Ok("image/png".to_string());
    }
    if bytes.starts_with(b"\xff\xd8\xff") {
        return Ok("image/jpeg".to_string());
    }
    if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        return Ok("image/webp".to_string());
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Ok("image/gif".to_string());
    }
    if bytes.starts_with(b"BM") {
        return Ok("image/bmp".to_string());
    }
    Err(AppError::new(
        "ref_image_invalid",
        format!(
            "Unsupported image format for reference image: {}",
            path.display()
        ),
    ))
}

fn filename_extension_for_mime_type(mime_type: &str) -> &'static str {
    match mime_type {
        "image/png" => ".png",
        "image/jpeg" => ".jpg",
        "image/webp" => ".webp",
        "image/gif" => ".gif",
        "image/bmp" => ".bmp",
        _ => ".bin",
    }
}

fn detect_extension(bytes: &[u8]) -> &'static str {
    match detect_mime_type(Path::new("file.bin"), bytes).as_deref() {
        Ok("image/png") => ".png",
        Ok("image/jpeg") => ".jpg",
        Ok("image/webp") => ".webp",
        Ok("image/gif") => ".gif",
        Ok("image/bmp") => ".bmp",
        _ => ".bin",
    }
}

fn local_path_to_data_url(path: &Path) -> Result<String, AppError> {
    if !path.is_file() {
        return Err(AppError::new(
            "ref_image_missing",
            format!("Reference image not found: {}", path.display()),
        ));
    }
    let bytes = fs::read(path).map_err(|error| {
        AppError::new("ref_image_invalid", "Unable to read reference image.")
            .with_detail(json!({ "error": error.to_string(), "path": path.display().to_string() }))
    })?;
    let mime_type = detect_mime_type(path, &bytes)?;
    let encoded = STANDARD.encode(bytes);
    Ok(format!("data:{mime_type};base64,{encoded}"))
}

fn resolve_ref_image(value: &str) -> Result<String, AppError> {
    match Url::parse(value) {
        Ok(url) => match url.scheme() {
            "http" | "https" | "data" => Ok(value.to_string()),
            "file" => {
                let path = url
                    .to_file_path()
                    .map_err(|_| AppError::new("ref_image_invalid", "Unsupported file URL."))?;
                local_path_to_data_url(&path)
            }
            _ => local_path_to_data_url(Path::new(value)),
        },
        Err(_) => local_path_to_data_url(Path::new(value)),
    }
}

fn resolve_ref_images(values: &[String]) -> Result<Vec<String>, AppError> {
    values
        .iter()
        .map(|value| resolve_ref_image(value))
        .collect()
}

fn sanitize_file_name(name: &str) -> String {
    let clean: String = name
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric() || ['-', '_', '.'].contains(character)
        })
        .collect();
    if clean.is_empty() {
        "image.bin".to_string()
    } else {
        clean
    }
}

fn parse_data_url_image(value: &str) -> Result<(String, Vec<u8>), AppError> {
    let Some((prefix, encoded)) = value.split_once(',') else {
        return Err(AppError::new(
            "invalid_data_url",
            "Image data URL must contain a base64 payload.",
        ));
    };
    if !prefix.contains(";base64") {
        return Err(AppError::new(
            "invalid_data_url",
            "Image data URL must contain a base64 payload.",
        ));
    }
    let mime_type = prefix
        .trim_start_matches("data:")
        .split(';')
        .next()
        .unwrap_or("application/octet-stream")
        .to_string();
    Ok((mime_type, decode_base64_bytes(encoded)?))
}

fn download_bytes(url: &str) -> Result<Vec<u8>, AppError> {
    let client = make_client(DEFAULT_REQUEST_TIMEOUT)?;
    let response = client.get(url).send().map_err(|error| {
        AppError::new("network_error", "Unable to download image bytes.")
            .with_detail(json!({ "error": error.to_string(), "url": url }))
    })?;
    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().unwrap_or_else(|_| String::new());
        return Err(http_status_error(status, detail));
    }
    response
        .bytes()
        .map(|bytes| bytes.to_vec())
        .map_err(|error| {
            AppError::new("network_error", "Unable to read downloaded image bytes.")
                .with_detail(json!({ "error": error.to_string(), "url": url }))
        })
}

fn load_image_source_bytes(
    source: &str,
    fallback_name: &str,
) -> Result<(String, Vec<u8>, String), AppError> {
    if source.starts_with("data:image/") {
        let (mime_type, bytes) = parse_data_url_image(source)?;
        let file_name = format!(
            "{fallback_name}{}",
            filename_extension_for_mime_type(&mime_type)
        );
        return Ok((mime_type, bytes, sanitize_file_name(&file_name)));
    }
    if let Ok(url) = Url::parse(source) {
        match url.scheme() {
            "http" | "https" => {
                let bytes = download_bytes(source)?;
                let guessed_name = Path::new(url.path())
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or(fallback_name);
                let mime_type = detect_mime_type(Path::new(guessed_name), &bytes)?;
                let file_name = format!(
                    "{}{}",
                    Path::new(guessed_name)
                        .file_stem()
                        .and_then(|stem| stem.to_str())
                        .unwrap_or(fallback_name),
                    filename_extension_for_mime_type(&mime_type)
                );
                return Ok((mime_type, bytes, sanitize_file_name(&file_name)));
            }
            "file" => {
                let path = url
                    .to_file_path()
                    .map_err(|_| AppError::new("ref_image_invalid", "Unsupported file URL."))?;
                let bytes = fs::read(&path).map_err(|error| {
                    AppError::new("ref_image_invalid", "Unable to read local file URL image.")
                        .with_detail(json!({ "error": error.to_string(), "path": path.display().to_string() }))
                })?;
                let mime_type = detect_mime_type(&path, &bytes)?;
                let file_name = path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(sanitize_file_name)
                    .unwrap_or_else(|| "image.bin".to_string());
                return Ok((mime_type, bytes, file_name));
            }
            _ => {}
        }
    }
    let path = Path::new(source);
    if path.is_file() {
        let bytes = fs::read(path).map_err(|error| {
            AppError::new("ref_image_invalid", "Unable to read local image.").with_detail(
                json!({ "error": error.to_string(), "path": path.display().to_string() }),
            )
        })?;
        let mime_type = detect_mime_type(path, &bytes)?;
        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .map(sanitize_file_name)
            .unwrap_or_else(|| "image.bin".to_string());
        return Ok((mime_type, bytes, file_name));
    }
    Err(AppError::new(
        "ref_image_invalid",
        format!("Unsupported image source for multipart edit: {source}"),
    ))
}

fn save_image(path: &Path, bytes: &[u8]) -> Result<PathBuf, AppError> {
    let final_path = if path.extension().is_none() {
        path.with_extension(detect_extension(bytes).trim_start_matches('.'))
    } else {
        path.to_path_buf()
    };
    if let Some(parent) = final_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            AppError::new("output_write_failed", "Unable to create output directory.").with_detail(
                json!({ "error": error.to_string(), "path": parent.display().to_string() }),
            )
        })?;
    }
    fs::write(&final_path, bytes).map_err(|error| {
        AppError::new("output_write_failed", "Unable to write output image.").with_detail(
            json!({ "error": error.to_string(), "path": final_path.display().to_string() }),
        )
    })?;
    Ok(final_path)
}

fn save_images(output_path: &Path, image_bytes_list: &[Vec<u8>]) -> Result<Vec<Value>, AppError> {
    if image_bytes_list.is_empty() {
        return Err(AppError::new(
            "missing_image_result",
            "No image bytes were available to save.",
        ));
    }
    if image_bytes_list.len() == 1 {
        let path = save_image(output_path, &image_bytes_list[0])?;
        return Ok(vec![json!({
            "index": 0,
            "path": path.display().to_string(),
            "bytes": image_bytes_list[0].len(),
        })]);
    }
    let mut saved = Vec::new();
    let base_name = output_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .or_else(|| output_path.file_name().and_then(|name| name.to_str()))
        .unwrap_or("image");
    let suffix = output_path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| format!(".{ext}"));
    for (index, bytes) in image_bytes_list.iter().enumerate() {
        let extension = suffix
            .clone()
            .unwrap_or_else(|| detect_extension(bytes).to_string());
        let path = output_path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join(format!("{base_name}-{}{}", index + 1, extension));
        save_image(&path, bytes)?;
        saved.push(json!({
            "index": index,
            "path": path.display().to_string(),
            "bytes": bytes.len(),
        }));
    }
    Ok(saved)
}

fn normalize_saved_output(saved_files: &[Value]) -> Value {
    if saved_files.len() == 1 {
        json!({
            "path": saved_files[0].get("path"),
            "bytes": saved_files[0].get("bytes"),
            "files": saved_files,
        })
    } else {
        let total_bytes: u64 = saved_files
            .iter()
            .filter_map(|item| item.get("bytes").and_then(Value::as_u64))
            .sum();
        json!({
            "path": Value::Null,
            "bytes": total_bytes,
            "files": saved_files,
        })
    }
}

fn primary_saved_output_path(output_path: &Path, saved_files: &[Value]) -> PathBuf {
    saved_files
        .first()
        .and_then(|file| file.get("path"))
        .and_then(Value::as_str)
        .map(PathBuf::from)
        .unwrap_or_else(|| output_path.to_path_buf())
}

fn history_image_metadata(
    operation: &str,
    selection: &ProviderSelection,
    shared: &SharedImageArgs,
    saved_files: &[Value],
) -> Value {
    json!({
        "operation": operation,
        "prompt": &shared.prompt,
        "size": shared.size.as_deref(),
        "format": shared.output_format.map(OutputFormat::as_str),
        "quality": shared.quality.map(Quality::as_str),
        "background": shared.background.as_str(),
        "n": shared.n,
        "provider_selection": selection.payload(),
        "output": normalize_saved_output(saved_files),
    })
}

type DecodedOpenAiImages = (Vec<Vec<u8>>, Vec<Option<String>>);

fn decode_openai_images(payload: &Value) -> Result<DecodedOpenAiImages, AppError> {
    let mut result = Vec::new();
    let mut revised_prompts = Vec::new();
    for item in payload
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        revised_prompts.push(
            item.get("revised_prompt")
                .and_then(Value::as_str)
                .map(ToString::to_string),
        );
        if let Some(b64_json) = item.get("b64_json").and_then(Value::as_str) {
            result.push(decode_base64_bytes(b64_json)?);
            continue;
        }
        if let Some(url) = item.get("url").and_then(Value::as_str) {
            result.push(download_bytes(url)?);
        }
    }
    Ok((result, revised_prompts))
}

fn summarize_image_request_options(
    provider: &str,
    operation: &str,
    resolved_model: &str,
    shared: &SharedImageArgs,
    ref_image_count: usize,
    mask_present: bool,
    input_fidelity: Option<InputFidelity>,
) -> Value {
    let mut summary = json!({
        "operation": operation,
        "provider": provider,
        "model": resolved_model,
        "background": shared.background.as_str(),
        "ref_image_count": ref_image_count,
    });
    if let Some(size) = &shared.size {
        summary["size"] = json!(size);
    }
    if let Some(quality) = shared.quality {
        summary["quality"] = json!(quality.as_str());
    }
    if let Some(output_format) = shared.output_format {
        summary["format"] = json!(output_format.as_str());
    }
    if let Some(output_compression) = shared.output_compression {
        summary["compression"] = json!(output_compression);
    }
    if let Some(n) = shared.n {
        summary["n"] = json!(n);
    }
    if let Some(moderation) = shared.moderation {
        summary["moderation"] = json!(moderation.as_str());
    }
    if provider == "codex" {
        summary["delegated_image_model"] = json!(DELEGATED_IMAGE_MODEL);
    }
    if mask_present {
        summary["mask_present"] = json!(true);
    }
    if let Some(input_fidelity) = input_fidelity {
        summary["input_fidelity"] = json!(input_fidelity.as_str());
    }
    summary
}

fn summarize_output_item(item: &Value) -> Value {
    let mut summary = json!({
        "id": item.get("id"),
        "type": item.get("type"),
        "status": item.get("status"),
    });
    for key in [
        "action",
        "background",
        "output_format",
        "quality",
        "size",
        "revised_prompt",
    ] {
        if let Some(value) = item.get(key) {
            summary[key] = value.clone();
        }
    }
    if let Some(result) = item.get("result").and_then(Value::as_str) {
        summary["result"] = summarize_large_string(Some("result"), result);
    }
    summary
}

fn build_openai_operation_endpoint(api_base: &str, operation: &str) -> Result<String, AppError> {
    match operation {
        "generate" => Ok(format!(
            "{}{}",
            api_base.trim_end_matches('/'),
            OPENAI_GENERATIONS_PATH
        )),
        "edit" => Ok(format!(
            "{}{}",
            api_base.trim_end_matches('/'),
            OPENAI_EDITS_PATH
        )),
        _ => Err(AppError::new(
            "invalid_operation",
            format!("Unsupported OpenAI image operation: {operation}"),
        )),
    }
}

fn run_config_command(cli: &Cli, command: &ConfigCommand) -> Result<CommandOutcome, AppError> {
    match &command.config_command {
        ConfigSubcommand::Path => Ok(CommandOutcome {
            payload: json!({
                "ok": true,
                "command": "config path",
                "config_dir": shared_config_dir().display().to_string(),
                "config_file": cli_config_path(cli).display().to_string(),
                "history_file": history_db_path().display().to_string(),
                "jobs_dir": jobs_dir().display().to_string(),
            }),
            exit_status: 0,
        }),
        ConfigSubcommand::Inspect => {
            let path = cli_config_path(cli);
            let config = load_app_config(&path)?;
            Ok(CommandOutcome {
                payload: json!({
                    "ok": true,
                    "command": "config inspect",
                    "config_file": path.display().to_string(),
                    "exists": path.is_file(),
                    "config": redact_app_config(&config),
                }),
                exit_status: 0,
            })
        }
        ConfigSubcommand::ListProviders => {
            let path = cli_config_path(cli);
            let config = load_app_config(&path)?;
            Ok(CommandOutcome {
                payload: json!({
                    "ok": true,
                    "command": "config list-providers",
                    "default_provider": config.default_provider,
                    "providers": redact_app_config(&config)["providers"].clone(),
                }),
                exit_status: 0,
            })
        }
        ConfigSubcommand::SetDefault(args) => {
            validate_provider_name(&args.name)?;
            let path = cli_config_path(cli);
            let mut config = load_app_config(&path)?;
            if !provider_is_builtin(&args.name) && !config.providers.contains_key(&args.name) {
                return Err(AppError::new(
                    "provider_unknown",
                    format!("Unknown provider: {}", args.name),
                ));
            }
            config.default_provider = Some(args.name.clone());
            save_app_config(&path, &config)?;
            Ok(CommandOutcome {
                payload: json!({
                    "ok": true,
                    "command": "config set-default",
                    "default_provider": args.name,
                    "config_file": path.display().to_string(),
                }),
                exit_status: 0,
            })
        }
        ConfigSubcommand::AddProvider(args) => run_config_add_provider(cli, args),
        ConfigSubcommand::RemoveProvider(args) => {
            let path = cli_config_path(cli);
            let mut config = load_app_config(&path)?;
            let removed = config.providers.remove(&args.name).is_some();
            if config.default_provider.as_deref() == Some(args.name.as_str()) {
                config.default_provider = None;
            }
            save_app_config(&path, &config)?;
            Ok(CommandOutcome {
                payload: json!({
                    "ok": true,
                    "command": "config remove-provider",
                    "provider": args.name,
                    "removed": removed,
                }),
                exit_status: 0,
            })
        }
        ConfigSubcommand::TestProvider(args) => {
            let selection = select_configured_provider(cli, &args.name, "config_test_provider")?;
            let endpoint = match selection.kind {
                ProviderKind::OpenAi => check_endpoint_reachability(&selection.api_base),
                ProviderKind::Codex => check_endpoint_reachability(&selection.codex_endpoint),
            };
            Ok(CommandOutcome {
                payload: json!({
                    "ok": endpoint.get("reachable").and_then(Value::as_bool).unwrap_or(false),
                    "command": "config test-provider",
                    "provider_selection": selection.payload(),
                    "endpoint": endpoint,
                }),
                exit_status: 0,
            })
        }
    }
}

fn run_config_add_provider(cli: &Cli, args: &AddProviderArgs) -> Result<CommandOutcome, AppError> {
    validate_provider_name(&args.name)?;
    let path = cli_config_path(cli);
    let mut config = load_app_config(&path)?;
    if args.supports_n && args.no_supports_n {
        return Err(AppError::new(
            "invalid_provider_config",
            "Use either --supports-n or --no-supports-n, not both.",
        ));
    }
    let edit_region_mode = args
        .edit_region_mode
        .as_deref()
        .map(normalize_edit_region_mode)
        .transpose()?;
    let mut credentials = BTreeMap::new();
    if let Some(api_key) = &args.api_key {
        credentials.insert(
            "api_key".to_string(),
            CredentialRef::File {
                value: api_key.clone(),
            },
        );
    }
    if let Some(api_key_env) = &args.api_key_env {
        credentials.insert(
            "api_key".to_string(),
            CredentialRef::Env {
                env: api_key_env.clone(),
            },
        );
    }
    if let Some(account_id) = &args.account_id {
        credentials.insert(
            "account_id".to_string(),
            CredentialRef::File {
                value: account_id.clone(),
            },
        );
    }
    if let Some(access_token) = &args.access_token {
        credentials.insert(
            "access_token".to_string(),
            CredentialRef::File {
                value: access_token.clone(),
            },
        );
    }
    if let Some(refresh_token) = &args.refresh_token {
        credentials.insert(
            "refresh_token".to_string(),
            CredentialRef::File {
                value: refresh_token.clone(),
            },
        );
    }
    let model = args
        .model
        .clone()
        .or_else(|| match args.provider_type.as_str() {
            "codex" => Some(DEFAULT_CODEX_MODEL.to_string()),
            _ => Some(DEFAULT_OPENAI_MODEL.to_string()),
        });
    let supports_n = if args.supports_n {
        Some(true)
    } else if args.no_supports_n {
        Some(false)
    } else {
        None
    };
    config.providers.insert(
        args.name.clone(),
        ProviderConfig {
            provider_type: args.provider_type.clone(),
            api_base: args.api_base.clone(),
            endpoint: args.endpoint.clone(),
            model,
            credentials,
            supports_n,
            edit_region_mode,
        },
    );
    if args.set_default || config.default_provider.is_none() {
        config.default_provider = Some(args.name.clone());
    }
    save_app_config(&path, &config)?;
    Ok(CommandOutcome {
        payload: json!({
            "ok": true,
            "command": "config add-provider",
            "provider": args.name,
            "config_file": path.display().to_string(),
            "config": redact_app_config(&config),
        }),
        exit_status: 0,
    })
}

fn run_secret_command(cli: &Cli, command: &SecretCommand) -> Result<CommandOutcome, AppError> {
    match &command.secret_command {
        SecretSubcommand::Set(args) => run_secret_set(cli, args),
        SecretSubcommand::Get(args) => run_secret_get(cli, args),
        SecretSubcommand::Delete(args) => run_secret_delete(cli, args),
    }
}

fn read_secret_value(args_value: &Option<String>) -> Result<String, AppError> {
    if let Some(value) = args_value {
        return Ok(value.clone());
    }
    let mut value = String::new();
    io::stdin().read_to_string(&mut value).map_err(|error| {
        AppError::new("secret_read_failed", "Unable to read secret from stdin.")
            .with_detail(json!({"error": error.to_string()}))
    })?;
    Ok(value.trim_end_matches(['\r', '\n']).to_string())
}

fn run_secret_set(cli: &Cli, args: &SecretSetArgs) -> Result<CommandOutcome, AppError> {
    let path = cli_config_path(cli);
    let mut config = load_app_config(&path)?;
    let provider = config.providers.get_mut(&args.provider).ok_or_else(|| {
        AppError::new(
            "provider_unknown",
            format!("Unknown provider: {}", args.provider),
        )
    })?;
    let credential = match args.source.as_str() {
        "file" => CredentialRef::File {
            value: read_secret_value(&args.value)?,
        },
        "env" => CredentialRef::Env {
            env: args.env.clone().ok_or_else(|| {
                AppError::new("secret_env_missing", "--env is required for env secrets.")
            })?,
        },
        "keychain" => {
            let account = args
                .account
                .clone()
                .unwrap_or_else(|| default_keychain_account(&args.provider, &args.name));
            let value = read_secret_value(&args.value)?;
            write_keychain_secret(KEYCHAIN_SERVICE, &account, &value)?;
            CredentialRef::Keychain {
                service: Some(KEYCHAIN_SERVICE.to_string()),
                account,
            }
        }
        other => {
            return Err(AppError::new(
                "secret_source_unsupported",
                format!("Unsupported secret source: {other}"),
            ));
        }
    };
    provider.credentials.insert(args.name.clone(), credential);
    save_app_config(&path, &config)?;
    Ok(CommandOutcome {
        payload: json!({
            "ok": true,
            "command": "secret set",
            "provider": args.provider,
            "name": args.name,
            "config_file": path.display().to_string(),
        }),
        exit_status: 0,
    })
}

fn run_secret_get(cli: &Cli, args: &SecretGetArgs) -> Result<CommandOutcome, AppError> {
    let config = load_app_config(&cli_config_path(cli))?;
    let provider = config.providers.get(&args.provider).ok_or_else(|| {
        AppError::new(
            "provider_unknown",
            format!("Unknown provider: {}", args.provider),
        )
    })?;
    let credential = provider.credentials.get(&args.name).ok_or_else(|| {
        AppError::new(
            "credential_missing",
            format!("Missing credential: {}", args.name),
        )
    })?;
    let resolved = resolve_credential(credential);
    if args.status {
        return Ok(CommandOutcome {
            payload: json!({
                "ok": true,
                "command": "secret get",
                "provider": args.provider,
                "name": args.name,
                "status": redact_credential_ref(credential),
                "ready": resolved.is_ok(),
            }),
            exit_status: 0,
        });
    }
    let (value, source) = resolved?;
    Ok(CommandOutcome {
        payload: json!({
            "ok": true,
            "command": "secret get",
            "provider": args.provider,
            "name": args.name,
            "source": source,
            "value": value,
        }),
        exit_status: 0,
    })
}

fn run_secret_delete(cli: &Cli, args: &SecretDeleteArgs) -> Result<CommandOutcome, AppError> {
    let path = cli_config_path(cli);
    let mut config = load_app_config(&path)?;
    let provider = config.providers.get_mut(&args.provider).ok_or_else(|| {
        AppError::new(
            "provider_unknown",
            format!("Unknown provider: {}", args.provider),
        )
    })?;
    let removed = provider.credentials.remove(&args.name);
    if let Some(CredentialRef::Keychain { service, account }) = &removed {
        let _ = delete_keychain_secret(service.as_deref().unwrap_or(KEYCHAIN_SERVICE), account);
    }
    save_app_config(&path, &config)?;
    Ok(CommandOutcome {
        payload: json!({
            "ok": true,
            "command": "secret delete",
            "provider": args.provider,
            "name": args.name,
            "removed": removed.is_some(),
        }),
        exit_status: 0,
    })
}

fn open_history_db() -> Result<Connection, AppError> {
    let path = history_db_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            AppError::new("history_open_failed", "Unable to create history directory.").with_detail(
                json!({"history_file": path.display().to_string(), "error": error.to_string()}),
            )
        })?;
    }
    let conn = Connection::open(&path).map_err(|error| {
        AppError::new("history_open_failed", "Unable to open history database.").with_detail(
            json!({"history_file": path.display().to_string(), "error": error.to_string()}),
        )
    })?;
    conn.busy_timeout(Duration::from_secs(5)).map_err(|error| {
        AppError::new(
            "history_migration_failed",
            "Unable to configure history database busy timeout.",
        )
        .with_detail(json!({"error": error.to_string()}))
    })?;
    conn.pragma_update(None, "journal_mode", "WAL".to_string())
        .map_err(|error| {
            AppError::new(
                "history_migration_failed",
                "Unable to configure history database journal mode.",
            )
            .with_detail(json!({"error": error.to_string()}))
        })?;
    conn.pragma_update(None, "synchronous", "NORMAL".to_string())
        .map_err(|error| {
            AppError::new(
                "history_migration_failed",
                "Unable to configure history database synchronous mode.",
            )
            .with_detail(json!({"error": error.to_string()}))
        })?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            command TEXT NOT NULL,
            provider TEXT NOT NULL,
            status TEXT NOT NULL,
            output_path TEXT,
            created_at TEXT NOT NULL,
            metadata TEXT NOT NULL
        )",
        [],
    )
    .map_err(|error| {
        AppError::new(
            "history_migration_failed",
            "Unable to initialize history database.",
        )
        .with_detail(json!({"error": error.to_string()}))
    })?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_jobs_created_at_id ON jobs (created_at DESC, id DESC)",
        [],
    )
    .map_err(|error| {
        AppError::new(
            "history_migration_failed",
            "Unable to initialize history indexes.",
        )
        .with_detail(json!({"error": error.to_string()}))
    })?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_jobs_status_created_at_id ON jobs (status, created_at DESC, id DESC)",
        [],
    )
    .map_err(|error| {
        AppError::new(
            "history_migration_failed",
            "Unable to initialize history indexes.",
        )
        .with_detail(json!({"error": error.to_string()}))
    })?;
    // Soft-delete migration: add `deleted_at TEXT` column. SQLite returns
    // "duplicate column name" if the column already exists — swallow only
    // that case so the migration is idempotent.
    match conn.execute("ALTER TABLE jobs ADD COLUMN deleted_at TEXT", []) {
        Ok(_) => {}
        Err(rusqlite::Error::SqliteFailure(_, Some(msg)))
            if msg.contains("duplicate column name") => {}
        Err(error) => {
            return Err(AppError::new(
                "history_migration_failed",
                "Unable to add deleted_at column.",
            )
            .with_detail(json!({"error": error.to_string()})));
        }
    }
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_jobs_deleted_at_created_at ON jobs (deleted_at, created_at DESC, id DESC)",
        [],
    )
    .map_err(|error| {
        AppError::new(
            "history_migration_failed",
            "Unable to initialize history indexes.",
        )
        .with_detail(json!({"error": error.to_string()}))
    })?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS output_uploads (
            job_id TEXT NOT NULL,
            output_index INTEGER NOT NULL,
            target TEXT NOT NULL,
            target_type TEXT NOT NULL,
            status TEXT NOT NULL,
            url TEXT,
            error TEXT,
            bytes INTEGER,
            attempts INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL,
            metadata TEXT NOT NULL DEFAULT '{}',
            PRIMARY KEY (job_id, output_index, target),
            FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
        )",
        [],
    )
    .map_err(|error| {
        AppError::new(
            "history_migration_failed",
            "Unable to initialize output upload history.",
        )
        .with_detail(json!({"error": error.to_string()}))
    })?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_output_uploads_job_output ON output_uploads (job_id, output_index)",
        [],
    )
        .map_err(|error| {
        AppError::new(
            "history_migration_failed",
            "Unable to initialize output upload indexes.",
        )
        .with_detail(json!({"error": error.to_string()}))
    })?;
    Ok(conn)
}

fn record_history_job(
    command_name: &str,
    provider: &str,
    status: &str,
    output_path: Option<&Path>,
    metadata: Value,
) -> Result<String, AppError> {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let job_id = format!("job-{}-{}", unique, std::process::id());
    upsert_history_job(
        &job_id,
        command_name,
        provider,
        status,
        output_path,
        None,
        metadata,
    )?;
    Ok(job_id)
}

pub fn upsert_history_job(
    job_id: &str,
    command_name: &str,
    provider: &str,
    status: &str,
    output_path: Option<&Path>,
    created_at: Option<&str>,
    metadata: Value,
) -> Result<(), AppError> {
    let conn = open_history_db()?;
    let timestamp = created_at
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(now_iso);
    conn.execute(
        "INSERT OR REPLACE INTO jobs (id, command, provider, status, output_path, created_at, metadata)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            job_id,
            command_name,
            provider,
            status,
            output_path.map(|path| path.display().to_string()),
            timestamp,
            serde_json::to_string(&metadata).unwrap_or_else(|_| "{}".to_string()),
        ],
    )
    .map_err(|error| {
        AppError::new("history_write_failed", "Unable to record history job.")
            .with_detail(json!({"error": error.to_string()}))
    })?;
    Ok(())
}

pub fn delete_history_job(job_id: &str) -> Result<usize, AppError> {
    let conn = open_history_db()?;
    conn.execute(
        "DELETE FROM output_uploads WHERE job_id = ?1",
        params![job_id],
    )
    .map_err(|error| {
        AppError::new(
            "history_delete_failed",
            "Unable to delete output upload history.",
        )
        .with_detail(json!({"error": error.to_string()}))
    })?;
    conn.execute("DELETE FROM jobs WHERE id = ?1", params![job_id])
        .map_err(|error| {
            AppError::new("history_delete_failed", "Unable to delete history job.")
                .with_detail(json!({"error": error.to_string()}))
        })
}

/// Mark a history row as soft-deleted by stamping `deleted_at` with the
/// current epoch seconds. Already-deleted rows are not re-stamped, keeping
/// the original deletion time intact for trash retention windows.
pub fn soft_delete_history_job(job_id: &str) -> Result<usize, AppError> {
    let conn = open_history_db()?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string();
    conn.execute(
        "UPDATE jobs SET deleted_at = ?1 WHERE id = ?2 AND deleted_at IS NULL",
        params![now, job_id],
    )
    .map_err(|error| {
        AppError::new(
            "history_soft_delete_failed",
            "Unable to soft-delete history job.",
        )
        .with_detail(json!({"error": error.to_string()}))
    })
}

/// Clear `deleted_at` so the row reappears in the default listing. Idempotent.
pub fn restore_deleted_history_job(job_id: &str) -> Result<usize, AppError> {
    let conn = open_history_db()?;
    conn.execute(
        "UPDATE jobs SET deleted_at = NULL WHERE id = ?1",
        params![job_id],
    )
    .map_err(|error| {
        AppError::new("history_restore_failed", "Unable to restore history job.")
            .with_detail(json!({"error": error.to_string()}))
    })
}

/// Return the IDs of soft-deleted history jobs whose `deleted_at` epoch
/// timestamp is at or before `threshold_epoch_secs` (i.e. their undo window
/// has elapsed). Used by the trash GC worker so the cutoff is anchored to
/// when the row was soft-deleted, not to the trash directory's filesystem
/// mtime (which `fs::rename` doesn't update).
pub fn list_expired_deleted_history_jobs(
    threshold_epoch_secs: u64,
) -> Result<Vec<String>, AppError> {
    let conn = open_history_db()?;
    let mut stmt = conn
        .prepare(
            "SELECT id FROM jobs WHERE deleted_at IS NOT NULL AND CAST(deleted_at AS INTEGER) <= ?1",
        )
        .map_err(|error| {
            AppError::new(
                "history_expired_query_failed",
                "Unable to query expired trash entries.",
            )
            .with_detail(json!({"error": error.to_string()}))
        })?;
    let rows = stmt
        .query_map(params![threshold_epoch_secs as i64], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|error| {
            AppError::new(
                "history_expired_query_failed",
                "Unable to query expired trash entries.",
            )
            .with_detail(json!({"error": error.to_string()}))
        })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|error| {
        AppError::new(
            "history_expired_query_failed",
            "Unable to read expired trash rows.",
        )
        .with_detail(json!({"error": error.to_string()}))
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputUploadRecord {
    pub job_id: String,
    pub output_index: usize,
    pub target: String,
    pub target_type: String,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bytes: Option<u64>,
    pub attempts: u32,
    pub updated_at: String,
    #[serde(default)]
    pub metadata: Value,
}

fn upload_record_to_value(record: &OutputUploadRecord) -> Value {
    json!({
        "job_id": record.job_id,
        "output_index": record.output_index,
        "target": record.target,
        "target_type": record.target_type,
        "status": record.status,
        "url": record.url,
        "error": record.error,
        "bytes": record.bytes,
        "attempts": record.attempts,
        "updated_at": record.updated_at,
        "metadata": record.metadata,
    })
}

fn row_to_upload_record(row: &Row<'_>) -> rusqlite::Result<OutputUploadRecord> {
    let metadata = serde_json::from_str::<Value>(&row.get::<_, String>(10)?).unwrap_or(Value::Null);
    Ok(OutputUploadRecord {
        job_id: row.get(0)?,
        output_index: row.get::<_, i64>(1)?.max(0) as usize,
        target: row.get(2)?,
        target_type: row.get(3)?,
        status: row.get(4)?,
        url: row.get(5)?,
        error: row.get(6)?,
        bytes: row
            .get::<_, Option<i64>>(7)?
            .map(|value| value.max(0) as u64),
        attempts: row.get::<_, i64>(8)?.max(0) as u32,
        updated_at: row.get(9)?,
        metadata,
    })
}

pub fn upsert_output_upload_record(record: &OutputUploadRecord) -> Result<(), AppError> {
    let conn = open_history_db()?;
    conn.execute(
        "INSERT INTO output_uploads (
            job_id, output_index, target, target_type, status, url, error, bytes, attempts, updated_at, metadata
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        ON CONFLICT(job_id, output_index, target) DO UPDATE SET
            target_type = excluded.target_type,
            status = excluded.status,
            url = excluded.url,
            error = excluded.error,
            bytes = excluded.bytes,
            attempts = excluded.attempts,
            updated_at = excluded.updated_at,
            metadata = excluded.metadata",
        params![
            record.job_id,
            record.output_index as i64,
            record.target,
            record.target_type,
            record.status,
            record.url,
            record.error,
            record.bytes.map(|value| value as i64),
            record.attempts as i64,
            record.updated_at,
            serde_json::to_string(&record.metadata).unwrap_or_else(|_| "{}".to_string()),
        ],
    )
    .map_err(|error| {
        AppError::new("history_write_failed", "Unable to record output upload history.")
            .with_detail(json!({"error": error.to_string()}))
    })?;
    Ok(())
}

pub fn list_output_upload_records(job_id: &str) -> Result<Vec<OutputUploadRecord>, AppError> {
    let conn = open_history_db()?;
    list_output_upload_records_with_conn(&conn, job_id)
}

#[derive(Debug, Clone, Default)]
pub struct StorageUploadOverrides {
    pub targets: Option<Vec<String>>,
    pub fallback_targets: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageTestResult {
    pub ok: bool,
    pub target: String,
    pub target_type: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u128>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<Value>,
    #[serde(default)]
    pub unsupported: bool,
    #[serde(default)]
    pub local_only: bool,
}

#[derive(Debug, Clone)]
struct UploadOutput {
    index: usize,
    path: PathBuf,
    bytes: u64,
}

#[derive(Debug, Clone)]
struct StorageUploadOutcome {
    url: Option<String>,
    bytes: Option<u64>,
    metadata: Value,
}

fn storage_target_type(target: &StorageTargetConfig) -> &'static str {
    match target {
        StorageTargetConfig::Local { .. } => "local",
        StorageTargetConfig::S3 { .. } => "s3",
        StorageTargetConfig::WebDav { .. } => "webdav",
        StorageTargetConfig::Http { .. } => "http",
        StorageTargetConfig::Sftp { .. } => "sftp",
    }
}

fn upload_now() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
}

fn parse_output_index(value: &Value, fallback: usize) -> usize {
    value
        .get("index")
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .unwrap_or(fallback)
}

fn upload_outputs_from_job(job: &Value) -> Vec<UploadOutput> {
    job.get("outputs")
        .and_then(Value::as_array)
        .map(|outputs| {
            outputs
                .iter()
                .enumerate()
                .filter_map(|(fallback, output)| {
                    let path = output.get("path").and_then(Value::as_str)?;
                    let bytes = output.get("bytes").and_then(Value::as_u64).unwrap_or(0);
                    Some(UploadOutput {
                        index: parse_output_index(output, fallback),
                        path: PathBuf::from(path),
                        bytes,
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn path_safe_token(value: &str, fallback: &str) -> String {
    let token = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    if token.is_empty() {
        fallback.to_string()
    } else {
        token
    }
}

fn output_file_name(output: &UploadOutput) -> String {
    output
        .path
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| path_safe_token(name, "image.png"))
        .unwrap_or_else(|| "image.png".to_string())
}

fn storage_object_key(job_id: &str, output: &UploadOutput) -> String {
    format!(
        "{}/{}-{}",
        path_safe_token(job_id, "job"),
        output.index + 1,
        output_file_name(output)
    )
}

fn join_storage_url(base: &str, key: &str) -> String {
    format!(
        "{}/{}",
        base.trim_end_matches('/'),
        key.split('/')
            .map(|part| part.replace(' ', "%20"))
            .collect::<Vec<_>>()
            .join("/")
    )
}

fn target_names_for_upload(
    config: &StorageConfig,
    overrides: &StorageUploadOverrides,
) -> (Vec<String>, Vec<String>) {
    let primary = overrides
        .targets
        .clone()
        .unwrap_or_else(|| config.default_targets.clone());
    let fallback = overrides
        .fallback_targets
        .clone()
        .unwrap_or_else(|| config.fallback_targets.clone());
    (
        primary
            .into_iter()
            .map(|name| name.trim().to_string())
            .filter(|name| !name.is_empty())
            .collect(),
        fallback
            .into_iter()
            .map(|name| name.trim().to_string())
            .filter(|name| !name.is_empty())
            .collect(),
    )
}

fn resolve_storage_headers(
    headers: &BTreeMap<String, CredentialRef>,
) -> Result<HeaderMap, AppError> {
    let mut resolved = HeaderMap::new();
    for (name, credential) in headers {
        let header_name = HeaderName::from_bytes(name.as_bytes()).map_err(|error| {
            AppError::new(
                "storage_header_invalid",
                "Invalid HTTP storage header name.",
            )
            .with_detail(json!({"header": name, "error": error.to_string()}))
        })?;
        let (value, _) = resolve_credential(credential)?;
        let header_value = HeaderValue::from_str(&value).map_err(|error| {
            AppError::new(
                "storage_header_invalid",
                "Invalid HTTP storage header value.",
            )
            .with_detail(json!({"header": name, "error": error.to_string()}))
        })?;
        resolved.insert(header_name, header_value);
    }
    Ok(resolved)
}

fn json_pointer_string(value: &Value, pointer: Option<&str>) -> Option<String> {
    let pointer = pointer?.trim();
    if pointer.is_empty() {
        return None;
    }
    value.pointer(pointer).and_then(|value| {
        value
            .as_str()
            .map(ToString::to_string)
            .or_else(|| value.as_object().map(|_| value.to_string()))
    })
}

fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut value = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        value.push(HEX[(byte >> 4) as usize] as char);
        value.push(HEX[(byte & 0x0f) as usize] as char);
    }
    value
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex_lower(&Sha256::digest(bytes))
}

fn hmac_sha256(key: &[u8], data: &str) -> Result<Vec<u8>, AppError> {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).map_err(|error| {
        AppError::new(
            "storage_s3_signing_failed",
            "Unable to initialize S3 signer.",
        )
        .with_detail(json!({"error": error.to_string()}))
    })?;
    mac.update(data.as_bytes());
    Ok(mac.finalize().into_bytes().to_vec())
}

fn pinned_http_client(
    host_label: &str,
    addrs: &[SocketAddr],
    timeout: Duration,
    error_code: &'static str,
    error_message: &'static str,
) -> Result<Client, AppError> {
    Client::builder()
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::none())
        .resolve_to_addrs(host_label, addrs)
        .build()
        .map_err(|error| {
            AppError::new(error_code, error_message)
                .with_detail(json!({"error": error.to_string()}))
        })
}

fn s3_encode_key_segment(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                vec![byte as char]
            }
            other => format!("%{other:02X}").chars().collect(),
        })
        .collect()
}

fn s3_canonical_uri(key: &str) -> String {
    format!(
        "/{}",
        key.split('/')
            .map(s3_encode_key_segment)
            .collect::<Vec<_>>()
            .join("/")
    )
}

fn s3_host_header(url: &Url) -> Result<String, AppError> {
    let host = url
        .host_str()
        .ok_or_else(|| AppError::new("storage_s3_url_invalid", "S3 endpoint host is missing."))?;
    Ok(match url.port() {
        Some(port) => format!("{host}:{port}"),
        None => host.to_string(),
    })
}

fn redact_url_for_log(url: &str) -> String {
    let Ok(mut parsed) = Url::parse(url) else {
        return url.chars().take(256).collect();
    };
    let _ = parsed.set_username("");
    let _ = parsed.set_password(None);
    parsed.set_query(None);
    parsed.set_fragment(None);
    parsed.to_string()
}

fn response_body_snippet(body: &str) -> String {
    const MAX_LEN: usize = 2048;
    let mut snippet = body
        .chars()
        .map(|ch| {
            if ch.is_control() && ch != '\n' && ch != '\r' && ch != '\t' {
                ' '
            } else {
                ch
            }
        })
        .take(MAX_LEN + 1)
        .collect::<String>();
    if snippet.chars().count() > MAX_LEN {
        snippet = snippet.chars().take(MAX_LEN).collect::<String>();
        snippet.push_str("...");
    }
    snippet
}

fn is_sensitive_response_key(key: &str) -> bool {
    let lowered = key.to_ascii_lowercase();
    [
        "access_token",
        "refresh_token",
        "id_token",
        "authorization",
        "api_key",
        "token",
        "secret",
        "password",
        "signature",
        "credential",
        "set-cookie",
        "cookie",
        "url",
    ]
    .iter()
    .any(|needle| lowered.contains(needle))
}

fn redact_storage_response_value(key: Option<&str>, value: &Value) -> Value {
    if key.is_some_and(is_sensitive_response_key) {
        return json!({"_omitted": "secret"});
    }
    match value {
        Value::Object(object) => Value::Object(
            object
                .iter()
                .map(|(key, child)| (key.clone(), redact_storage_response_value(Some(key), child)))
                .collect(),
        ),
        Value::Array(items) => Value::Array(
            items
                .iter()
                .take(20)
                .map(|item| redact_storage_response_value(None, item))
                .collect(),
        ),
        Value::String(text) if text.len() > 256 => json!(response_body_snippet(text)),
        _ => value.clone(),
    }
}

fn sanitized_response_body(body: &str) -> Value {
    match serde_json::from_str::<Value>(body) {
        Ok(value) => redact_storage_response_value(None, &value),
        Err(_) => json!(response_body_snippet(body)),
    }
}

fn http_url_if_safe(url: Option<String>) -> Option<String> {
    let url = url?;
    let parsed = Url::parse(&url).ok()?;
    match parsed.scheme() {
        "http" | "https" => Some(url),
        _ => None,
    }
}

fn storage_error_message(error: AppError) -> String {
    if let Some(detail) = error.detail {
        format!("{}: {}", error.message, detail)
    } else {
        error.message
    }
}

fn storage_credential_present_and_resolvable(
    credential: Option<&CredentialRef>,
) -> Result<(), AppError> {
    let credential = credential.ok_or_else(|| {
        AppError::new(
            "storage_credentials_missing",
            "Storage credential is missing.",
        )
    })?;
    let (resolved, _) = resolve_credential(credential)?;
    if resolved.trim().is_empty() {
        return Err(AppError::new(
            "storage_credentials_missing",
            "Storage credential is empty.",
        ));
    }
    Ok(())
}

fn upload_to_local(
    directory: &Path,
    public_base_url: Option<&str>,
    job_id: &str,
    output: &UploadOutput,
) -> Result<StorageUploadOutcome, AppError> {
    if !output.path.is_file() {
        return Err(AppError::new(
            "storage_source_missing",
            "Generated output file is missing.",
        )
        .with_detail(json!({"path": output.path.display().to_string()})));
    }
    let key = storage_object_key(job_id, output);
    let destination = directory.join(&key);
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            AppError::new(
                "storage_local_create_failed",
                "Unable to create local storage directory.",
            )
            .with_detail(json!({"path": parent.display().to_string(), "error": error.to_string()}))
        })?;
    }
    fs::copy(&output.path, &destination).map_err(|error| {
        AppError::new(
            "storage_local_copy_failed",
            "Unable to copy output to local storage.",
        )
        .with_detail(json!({
            "source": output.path.display().to_string(),
            "destination": destination.display().to_string(),
            "error": error.to_string(),
        }))
    })?;
    Ok(StorageUploadOutcome {
        url: http_url_if_safe(public_base_url.map(|base| join_storage_url(base, &key))),
        bytes: Some(output.bytes),
        metadata: json!({
            "path": destination.display().to_string(),
            "key": key,
        }),
    })
}

fn upload_to_http(
    url: &str,
    method: &str,
    headers: &BTreeMap<String, CredentialRef>,
    public_url_json_pointer: Option<&str>,
    job_id: &str,
    output: &UploadOutput,
) -> Result<StorageUploadOutcome, AppError> {
    let (_, host_label, addrs) = validate_remote_http_target(url, "HTTP storage")?;
    if !output.path.is_file() {
        return Err(AppError::new(
            "storage_source_missing",
            "Generated output file is missing.",
        )
        .with_detail(json!({"path": output.path.display().to_string()})));
    }
    let bytes = fs::read(&output.path).map_err(|error| {
        AppError::new("storage_read_failed", "Unable to read generated output.").with_detail(
            json!({"path": output.path.display().to_string(), "error": error.to_string()}),
        )
    })?;
    let mime = mime_guess::from_path(&output.path).first_or_octet_stream();
    let file_name = output_file_name(output);
    let part = Part::bytes(bytes.clone())
        .file_name(file_name.clone())
        .mime_str(mime.as_ref())
        .map_err(|error| {
            AppError::new(
                "storage_http_multipart_failed",
                "Unable to build HTTP upload part.",
            )
            .with_detail(json!({"error": error.to_string()}))
        })?;
    let form = Form::new()
        .text("job_id", job_id.to_string())
        .text("output_index", output.index.to_string())
        .text("key", storage_object_key(job_id, output))
        .part("file", part);
    let client = pinned_http_client(
        &host_label,
        &addrs,
        Duration::from_secs(DEFAULT_REQUEST_TIMEOUT.min(120)),
        "storage_http_client_failed",
        "Unable to build HTTP storage client.",
    )?;
    let mut request = match method.to_ascii_uppercase().as_str() {
        "PUT" => client.put(url),
        "PATCH" => client.patch(url),
        "POST" | "" => client.post(url),
        other => {
            return Err(AppError::new(
                "storage_http_method_unsupported",
                format!("Unsupported HTTP storage method: {other}"),
            ));
        }
    };
    let resolved_headers = resolve_storage_headers(headers)?;
    request = request.headers(resolved_headers).multipart(form);
    let response = request.send().map_err(|error| {
        AppError::new("storage_http_request_failed", "HTTP storage upload failed.")
            .with_detail(json!({"url": redact_url_for_log(url), "error": error.to_string()}))
    })?;
    let status = response.status();
    let body = response.text().unwrap_or_default();
    if !status.is_success() {
        return Err(AppError::new(
            "storage_http_status_failed",
            format!("HTTP storage upload returned {status}."),
        )
        .with_detail(json!({
            "url": redact_url_for_log(url),
            "body": sanitized_response_body(&body),
        })));
    }
    let response_json = serde_json::from_str::<Value>(&body).unwrap_or(Value::Null);
    let extracted_url =
        http_url_if_safe(json_pointer_string(&response_json, public_url_json_pointer));
    Ok(StorageUploadOutcome {
        url: extracted_url,
        bytes: Some(bytes.len() as u64),
        metadata: json!({
            "http_status": status.as_u16(),
            "url_from_response": public_url_json_pointer
                .map(|_| json_pointer_string(&response_json, public_url_json_pointer).is_some())
                .unwrap_or(false),
        }),
    })
}

fn s3_endpoint_and_host(
    bucket: &str,
    region: Option<&str>,
    endpoint: Option<&str>,
    key: &str,
) -> Result<(String, String, String), AppError> {
    let canonical_uri = s3_canonical_uri(key);
    if let Some(endpoint) = endpoint.filter(|value| !value.trim().is_empty()) {
        let base = endpoint.trim_end_matches('/');
        let url = if base.contains("{bucket}") {
            format!("{}{}", base.replace("{bucket}", bucket), canonical_uri)
        } else {
            format!("{}/{bucket}{canonical_uri}", base)
        };
        let parsed = Url::parse(&url).map_err(|error| {
            AppError::new("storage_s3_url_invalid", "Invalid S3 endpoint URL.")
                .with_detail(json!({"url": url, "error": error.to_string()}))
        })?;
        let host = s3_host_header(&parsed)?;
        return Ok((url, host, parsed.path().to_string()));
    }
    let region = region
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("us-east-1");
    let host = if region == "us-east-1" {
        format!("{bucket}.s3.amazonaws.com")
    } else {
        format!("{bucket}.s3.{region}.amazonaws.com")
    };
    Ok((
        format!("https://{host}{canonical_uri}"),
        host,
        canonical_uri,
    ))
}

fn s3_signing_key(secret_access_key: &str, date: &str, region: &str) -> Result<Vec<u8>, AppError> {
    let date_key = hmac_sha256(format!("AWS4{secret_access_key}").as_bytes(), date)?;
    let region_key = hmac_sha256(&date_key, region)?;
    let service_key = hmac_sha256(&region_key, "s3")?;
    hmac_sha256(&service_key, "aws4_request")
}

fn upload_to_s3(
    bucket: &str,
    region: Option<&str>,
    endpoint: Option<&str>,
    prefix: Option<&str>,
    access_key_id: Option<&CredentialRef>,
    secret_access_key: Option<&CredentialRef>,
    session_token: Option<&CredentialRef>,
    public_base_url: Option<&str>,
    job_id: &str,
    output: &UploadOutput,
) -> Result<StorageUploadOutcome, AppError> {
    if !output.path.is_file() {
        return Err(AppError::new(
            "storage_source_missing",
            "Generated output file is missing.",
        )
        .with_detail(json!({"path": output.path.display().to_string()})));
    }
    let (access_key_id, _) = access_key_id
        .ok_or_else(|| {
            AppError::new(
                "storage_s3_credentials_missing",
                "S3 access key is missing.",
            )
        })
        .and_then(resolve_credential)?;
    let (secret_access_key, _) = secret_access_key
        .ok_or_else(|| {
            AppError::new(
                "storage_s3_credentials_missing",
                "S3 secret key is missing.",
            )
        })
        .and_then(resolve_credential)?;
    let session_token = session_token
        .map(resolve_credential)
        .transpose()?
        .map(|(value, _)| value);
    let bytes = fs::read(&output.path).map_err(|error| {
        AppError::new("storage_read_failed", "Unable to read generated output.").with_detail(
            json!({"path": output.path.display().to_string(), "error": error.to_string()}),
        )
    })?;
    let prefix = prefix.unwrap_or("").trim_matches('/');
    let raw_key = storage_object_key(job_id, output);
    let key = if prefix.is_empty() {
        raw_key
    } else {
        format!("{prefix}/{raw_key}")
    };
    let signing_region = region
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("us-east-1");
    let (url, host, canonical_uri) =
        s3_endpoint_and_host(bucket, Some(signing_region), endpoint, &key)?;
    let (_, host_label, addrs) = validate_remote_http_target(&url, "S3 storage")?;
    let now = Utc::now();
    let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();
    let short_date = now.format("%Y%m%d").to_string();
    let payload_hash = sha256_hex(&bytes);
    let content_type = mime_guess::from_path(&output.path)
        .first_or_octet_stream()
        .to_string();
    let mut canonical_headers = format!(
        "content-type:{content_type}\nhost:{host}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{amz_date}\n"
    );
    let mut signed_headers = "content-type;host;x-amz-content-sha256;x-amz-date".to_string();
    if let Some(token) = &session_token {
        canonical_headers.push_str(&format!("x-amz-security-token:{token}\n"));
        signed_headers.push_str(";x-amz-security-token");
    }
    let canonical_request =
        format!("PUT\n{canonical_uri}\n\n{canonical_headers}\n{signed_headers}\n{payload_hash}");
    let credential_scope = format!("{short_date}/{signing_region}/s3/aws4_request");
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{amz_date}\n{credential_scope}\n{}",
        sha256_hex(canonical_request.as_bytes())
    );
    let signing_key = s3_signing_key(&secret_access_key, &short_date, signing_region)?;
    let signature = hex_lower(&hmac_sha256(&signing_key, &string_to_sign)?);
    let authorization = format!(
        "AWS4-HMAC-SHA256 Credential={access_key_id}/{credential_scope}, SignedHeaders={signed_headers}, Signature={signature}"
    );
    let client = pinned_http_client(
        &host_label,
        &addrs,
        Duration::from_secs(DEFAULT_REQUEST_TIMEOUT.min(120)),
        "storage_s3_client_failed",
        "Unable to build S3 storage client.",
    )?;
    let mut request = client
        .put(&url)
        .header("Host", host.clone())
        .header(CONTENT_TYPE, content_type)
        .header("x-amz-content-sha256", payload_hash)
        .header("x-amz-date", amz_date)
        .header(AUTHORIZATION, authorization)
        .body(bytes.clone());
    if let Some(token) = session_token {
        request = request.header("x-amz-security-token", token);
    }
    let response = request.send().map_err(|error| {
        AppError::new("storage_s3_request_failed", "S3 storage upload failed.")
            .with_detail(json!({"url": redact_url_for_log(&url), "error": error.to_string()}))
    })?;
    let status = response.status();
    let etag = response
        .headers()
        .get("etag")
        .and_then(|value| value.to_str().ok())
        .map(ToString::to_string);
    let body = response.text().unwrap_or_default();
    if !status.is_success() {
        return Err(AppError::new(
            "storage_s3_status_failed",
            format!("S3 storage upload returned {status}."),
        )
        .with_detail(json!({
            "url": redact_url_for_log(&url),
            "body": sanitized_response_body(&body),
        })));
    }
    Ok(StorageUploadOutcome {
        url: http_url_if_safe(public_base_url.map(|base| join_storage_url(base, &key))),
        bytes: Some(bytes.len() as u64),
        metadata: json!({
            "bucket": bucket,
            "key": key,
            "endpoint": redact_url_for_log(&url),
            "etag": etag,
            "http_status": status.as_u16(),
        }),
    })
}

fn upload_to_webdav(
    url: &str,
    username: Option<&str>,
    password: Option<&CredentialRef>,
    public_base_url: Option<&str>,
    job_id: &str,
    output: &UploadOutput,
) -> Result<StorageUploadOutcome, AppError> {
    let (_, host_label, addrs) = validate_remote_http_target(url, "WebDAV storage")?;
    if !output.path.is_file() {
        return Err(AppError::new(
            "storage_source_missing",
            "Generated output file is missing.",
        )
        .with_detail(json!({"path": output.path.display().to_string()})));
    }
    let key = storage_object_key(job_id, output);
    let endpoint = join_storage_url(url, &key);
    let bytes = fs::read(&output.path).map_err(|error| {
        AppError::new("storage_read_failed", "Unable to read generated output.").with_detail(
            json!({"path": output.path.display().to_string(), "error": error.to_string()}),
        )
    })?;
    let client = pinned_http_client(
        &host_label,
        &addrs,
        Duration::from_secs(DEFAULT_REQUEST_TIMEOUT.min(120)),
        "storage_webdav_client_failed",
        "Unable to build WebDAV client.",
    )?;
    let resolved_password = if username.is_some_and(|value| !value.trim().is_empty()) {
        Some(
            password
                .map(resolve_credential)
                .transpose()?
                .map(|(value, _)| value)
                .unwrap_or_default(),
        )
    } else {
        None
    };
    let parent_keys = key
        .split('/')
        .scan(String::new(), |state, part| {
            if state.is_empty() {
                state.push_str(part);
            } else {
                state.push('/');
                state.push_str(part);
            }
            Some(state.clone())
        })
        .take_while(|value| value != &key)
        .collect::<Vec<_>>();
    for parent_key in parent_keys {
        let collection_url = join_storage_url(url, &parent_key);
        let mut request = client.request(
            reqwest::Method::from_bytes(b"MKCOL").unwrap(),
            &collection_url,
        );
        if let Some(username) = username.filter(|value| !value.trim().is_empty()) {
            request = request.basic_auth(username.to_string(), resolved_password.clone());
        }
        let response = request.send().map_err(|error| {
            AppError::new(
                "storage_webdav_mkcol_failed",
                "WebDAV collection creation failed.",
            )
            .with_detail(json!({
                "url": redact_url_for_log(&collection_url),
                "error": error.to_string(),
            }))
        })?;
        let status = response.status();
        if !(status.is_success() || matches!(status.as_u16(), 405 | 409)) {
            let body = response.text().unwrap_or_default();
            return Err(AppError::new(
                "storage_webdav_mkcol_failed",
                format!("WebDAV MKCOL returned {status}."),
            )
            .with_detail(json!({
                "url": redact_url_for_log(&collection_url),
                "body": sanitized_response_body(&body),
            })));
        }
    }
    let mut request = client
        .put(&endpoint)
        .header(
            CONTENT_TYPE,
            mime_guess::from_path(&output.path)
                .first_or_octet_stream()
                .as_ref(),
        )
        .body(bytes.clone());
    if let Some(username) = username.filter(|value| !value.trim().is_empty()) {
        request = request.basic_auth(username.to_string(), resolved_password);
    }
    let response = request.send().map_err(|error| {
        AppError::new(
            "storage_webdav_request_failed",
            "WebDAV storage upload failed.",
        )
        .with_detail(json!({
            "url": redact_url_for_log(&endpoint),
            "error": error.to_string(),
        }))
    })?;
    let status = response.status();
    let body = response.text().unwrap_or_default();
    if !status.is_success() {
        return Err(AppError::new(
            "storage_webdav_status_failed",
            format!("WebDAV storage upload returned {status}."),
        )
        .with_detail(json!({
            "url": redact_url_for_log(&endpoint),
            "body": sanitized_response_body(&body),
        })));
    }
    Ok(StorageUploadOutcome {
        url: http_url_if_safe(public_base_url.map(|base| join_storage_url(base, &key))),
        bytes: Some(bytes.len() as u64),
        metadata: json!({
            "key": key,
            "webdav_url": redact_url_for_log(&endpoint),
            "http_status": status.as_u16(),
        }),
    })
}

fn ensure_remote_dir(sftp: &ssh2::Sftp, remote_dir: &Path) {
    let mut current = PathBuf::new();
    for component in remote_dir.components() {
        current.push(component.as_os_str());
        if current.as_os_str().is_empty() {
            continue;
        }
        let _ = sftp.mkdir(&current, 0o755);
    }
}

fn sftp_expected_host_key(expected: Option<&str>) -> Result<&str, AppError> {
    expected
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::new(
                "storage_sftp_host_key_missing",
                "SFTP storage requires a SHA256 host key fingerprint.",
            )
        })
}

fn strip_sha256_prefix(value: &str) -> &str {
    if value.len() >= 7 && value[..7].eq_ignore_ascii_case("SHA256:") {
        &value[7..]
    } else {
        value
    }
}

fn sftp_host_key_matches(expected: &str, actual_hex: &str, actual_base64: &str) -> bool {
    let expected = strip_sha256_prefix(expected.trim());
    let compact_expected = expected.replace(':', "");
    compact_expected.eq_ignore_ascii_case(actual_hex)
        || expected == actual_base64
        || expected.trim_end_matches('=') == actual_base64.trim_end_matches('=')
}

fn verify_sftp_host_key(session: &Session, expected: Option<&str>) -> Result<String, AppError> {
    let expected = sftp_expected_host_key(expected)?;
    let (host_key, _) = session.host_key().ok_or_else(|| {
        AppError::new(
            "storage_sftp_host_key_unavailable",
            "SFTP server did not provide a host key.",
        )
    })?;
    let digest = Sha256::digest(host_key);
    let actual_hex = hex_lower(&digest);
    let actual_base64 = STANDARD.encode(digest);
    if !sftp_host_key_matches(expected, &actual_hex, &actual_base64) {
        return Err(AppError::new(
            "storage_sftp_host_key_mismatch",
            "SFTP host key fingerprint does not match.",
        )
        .with_detail(json!({
            "expected": expected,
            "actual": format!("SHA256:{}", actual_base64.trim_end_matches('=')),
        })));
    }
    Ok(format!("SHA256:{}", actual_base64.trim_end_matches('=')))
}

fn connect_sftp_session(
    host: &str,
    port: u16,
    host_key_sha256: Option<&str>,
) -> Result<(Session, String), AppError> {
    sftp_expected_host_key(host_key_sha256)?;
    let addrs = validate_remote_tcp_target(host, port, "SFTP storage")?;
    let tcp = TcpStream::connect(addrs.as_slice()).map_err(|error| {
        AppError::new(
            "storage_sftp_connect_failed",
            "Unable to connect to SFTP server.",
        )
        .with_detail(json!({"host": host, "port": port, "error": error.to_string()}))
    })?;
    let mut session = Session::new().map_err(|error| {
        AppError::new(
            "storage_sftp_session_failed",
            "Unable to create SFTP session.",
        )
        .with_detail(json!({"error": error.to_string()}))
    })?;
    session.set_tcp_stream(tcp);
    session.handshake().map_err(|error| {
        AppError::new("storage_sftp_handshake_failed", "SFTP handshake failed.")
            .with_detail(json!({"host": host, "error": error.to_string()}))
    })?;
    let host_key_fingerprint = verify_sftp_host_key(&session, host_key_sha256)?;
    Ok((session, host_key_fingerprint))
}

fn authenticate_sftp_session(
    session: &Session,
    host: &str,
    username: &str,
    password: Option<&CredentialRef>,
    private_key: Option<&CredentialRef>,
) -> Result<(), AppError> {
    if let Some(private_key) = private_key {
        let (private_key, _) = resolve_credential(private_key)?;
        let passphrase = password
            .map(resolve_credential)
            .transpose()?
            .map(|(value, _)| value);
        session
            .userauth_pubkey_memory(username, None, &private_key, passphrase.as_deref())
            .map_err(|error| {
                AppError::new("storage_sftp_auth_failed", "SFTP private-key auth failed.")
                    .with_detail(
                        json!({"host": host, "username": username, "error": error.to_string()}),
                    )
            })?;
    } else if let Some(password) = password {
        let (password, _) = resolve_credential(password)?;
        session
            .userauth_password(username, &password)
            .map_err(|error| {
                AppError::new("storage_sftp_auth_failed", "SFTP password auth failed.").with_detail(
                    json!({"host": host, "username": username, "error": error.to_string()}),
                )
            })?;
    } else {
        return Err(AppError::new(
            "storage_sftp_auth_missing",
            "SFTP storage requires a password or private key.",
        ));
    }
    if !session.authenticated() {
        return Err(AppError::new(
            "storage_sftp_auth_failed",
            "SFTP authentication failed.",
        ));
    }
    Ok(())
}

fn upload_to_sftp(
    host: &str,
    port: u16,
    host_key_sha256: Option<&str>,
    username: &str,
    password: Option<&CredentialRef>,
    private_key: Option<&CredentialRef>,
    remote_dir: &str,
    public_base_url: Option<&str>,
    job_id: &str,
    output: &UploadOutput,
) -> Result<StorageUploadOutcome, AppError> {
    if !output.path.is_file() {
        return Err(AppError::new(
            "storage_source_missing",
            "Generated output file is missing.",
        )
        .with_detail(json!({"path": output.path.display().to_string()})));
    }
    let (session, host_key_fingerprint) = connect_sftp_session(host, port, host_key_sha256)?;
    authenticate_sftp_session(&session, host, username, password, private_key)?;
    let sftp = session.sftp().map_err(|error| {
        AppError::new("storage_sftp_open_failed", "Unable to open SFTP subsystem.")
            .with_detail(json!({"error": error.to_string()}))
    })?;
    let key = storage_object_key(job_id, output);
    let remote_base = PathBuf::from(remote_dir);
    let destination = remote_base.join(&key);
    if let Some(parent) = destination.parent() {
        ensure_remote_dir(&sftp, parent);
    }
    let bytes = fs::read(&output.path).map_err(|error| {
        AppError::new("storage_read_failed", "Unable to read generated output.").with_detail(
            json!({"path": output.path.display().to_string(), "error": error.to_string()}),
        )
    })?;
    let mut remote = sftp.create(&destination).map_err(|error| {
        AppError::new(
            "storage_sftp_create_failed",
            "Unable to create remote SFTP file.",
        )
        .with_detail(json!({"path": destination.display().to_string(), "error": error.to_string()}))
    })?;
    remote.write_all(&bytes).map_err(|error| {
        AppError::new(
            "storage_sftp_write_failed",
            "Unable to write remote SFTP file.",
        )
        .with_detail(json!({"path": destination.display().to_string(), "error": error.to_string()}))
    })?;
    Ok(StorageUploadOutcome {
        url: http_url_if_safe(public_base_url.map(|base| join_storage_url(base, &key))),
        bytes: Some(bytes.len() as u64),
        metadata: json!({
            "key": key,
            "remote_path": destination.display().to_string(),
            "host_key_sha256": host_key_fingerprint,
        }),
    })
}

fn upload_to_target(
    target: &StorageTargetConfig,
    job_id: &str,
    output: &UploadOutput,
) -> Result<StorageUploadOutcome, AppError> {
    match target {
        StorageTargetConfig::Local {
            directory,
            public_base_url,
        } => upload_to_local(directory, public_base_url.as_deref(), job_id, output),
        StorageTargetConfig::Http {
            url,
            method,
            headers,
            public_url_json_pointer,
        } => upload_to_http(
            url,
            method,
            headers,
            public_url_json_pointer.as_deref(),
            job_id,
            output,
        ),
        StorageTargetConfig::WebDav {
            url,
            username,
            password,
            public_base_url,
        } => upload_to_webdav(
            url,
            username.as_deref(),
            password.as_ref(),
            public_base_url.as_deref(),
            job_id,
            output,
        ),
        StorageTargetConfig::Sftp {
            host,
            port,
            host_key_sha256,
            username,
            password,
            private_key,
            remote_dir,
            public_base_url,
        } => upload_to_sftp(
            host,
            *port,
            host_key_sha256.as_deref(),
            username,
            password.as_ref(),
            private_key.as_ref(),
            remote_dir,
            public_base_url.as_deref(),
            job_id,
            output,
        ),
        StorageTargetConfig::S3 {
            bucket,
            region,
            endpoint,
            prefix,
            access_key_id,
            secret_access_key,
            session_token,
            public_base_url,
        } => upload_to_s3(
            bucket,
            region.as_deref(),
            endpoint.as_deref(),
            prefix.as_deref(),
            access_key_id.as_ref(),
            secret_access_key.as_ref(),
            session_token.as_ref(),
            public_base_url.as_deref(),
            job_id,
            output,
        ),
    }
}

fn record_upload_attempt(
    job_id: &str,
    output: &UploadOutput,
    target_name: &str,
    target: &StorageTargetConfig,
    role: &str,
) -> Result<bool, AppError> {
    let started = OutputUploadRecord {
        job_id: job_id.to_string(),
        output_index: output.index,
        target: target_name.to_string(),
        target_type: storage_target_type(target).to_string(),
        status: "running".to_string(),
        url: None,
        error: None,
        bytes: None,
        attempts: 1,
        updated_at: upload_now(),
        metadata: json!({"role": role}),
    };
    upsert_output_upload_record(&started)?;
    let result = upload_to_target(target, job_id, output);
    let (status, url, error, bytes, metadata) = match result {
        Ok(outcome) => (
            "completed".to_string(),
            outcome.url,
            None,
            outcome.bytes,
            json!({
                "role": role,
                "detail": outcome.metadata,
            }),
        ),
        Err(error) => (
            if error.code == "storage_target_unsupported" {
                "unsupported".to_string()
            } else {
                "failed".to_string()
            },
            None,
            Some(storage_error_message(error)),
            None,
            json!({"role": role}),
        ),
    };
    let completed = status == "completed";
    let record = OutputUploadRecord {
        job_id: job_id.to_string(),
        output_index: output.index,
        target: target_name.to_string(),
        target_type: storage_target_type(target).to_string(),
        status,
        url,
        error,
        bytes,
        attempts: 1,
        updated_at: upload_now(),
        metadata,
    };
    upsert_output_upload_record(&record)?;
    Ok(completed)
}

fn record_missing_storage_target(
    job_id: &str,
    output: &UploadOutput,
    target_name: &str,
    role: &str,
) -> Result<(), AppError> {
    let record = OutputUploadRecord {
        job_id: job_id.to_string(),
        output_index: output.index,
        target: target_name.to_string(),
        target_type: "unknown".to_string(),
        status: "failed".to_string(),
        url: None,
        error: Some(format!("Unknown storage target: {target_name}")),
        bytes: None,
        attempts: 0,
        updated_at: upload_now(),
        metadata: json!({"role": role}),
    };
    upsert_output_upload_record(&record)
}

fn run_target_uploads(
    config: &StorageConfig,
    job_id: &str,
    output: &UploadOutput,
    target_names: &[String],
    role: &str,
) -> Result<bool, AppError> {
    let target_concurrency = config.target_concurrency.clamp(1, 32);
    let (tx, rx) = mpsc::channel::<Result<bool, AppError>>();
    let mut active = 0usize;
    let mut completed = false;
    let mut first_error = None;
    for target_name in target_names {
        while active >= target_concurrency {
            match rx.recv() {
                Ok(Ok(value)) => {
                    completed |= value;
                    active = active.saturating_sub(1);
                }
                Ok(Err(error)) => {
                    first_error.get_or_insert(error);
                    active = active.saturating_sub(1);
                }
                Err(_) => break,
            }
        }
        if let Some(target) = config.targets.get(target_name) {
            let tx = tx.clone();
            let job_id = job_id.to_string();
            let output = output.clone();
            let target_name = target_name.clone();
            let target = target.clone();
            let role = role.to_string();
            thread::spawn(move || {
                let result = record_upload_attempt(&job_id, &output, &target_name, &target, &role);
                let _ = tx.send(result);
            });
            active += 1;
        } else {
            if let Err(error) = record_missing_storage_target(job_id, output, target_name, role) {
                first_error.get_or_insert(error);
            }
        }
    }
    drop(tx);
    while active > 0 {
        match rx.recv() {
            Ok(Ok(value)) => {
                completed |= value;
                active -= 1;
            }
            Ok(Err(error)) => {
                first_error.get_or_insert(error);
                active -= 1;
            }
            Err(_) => break,
        }
    }
    if let Some(error) = first_error {
        Err(error)
    } else {
        Ok(completed)
    }
}

pub fn upload_job_outputs_to_storage(
    config: &StorageConfig,
    job: &Value,
    overrides: StorageUploadOverrides,
) -> Result<Vec<OutputUploadRecord>, AppError> {
    let Some(job_id) = job.get("id").and_then(Value::as_str) else {
        return Err(AppError::new(
            "storage_job_invalid",
            "Job id is required before uploading outputs.",
        ));
    };
    let outputs = upload_outputs_from_job(job);
    if outputs.is_empty() {
        return list_output_upload_records(job_id);
    }
    let (primary_names, fallback_names) = target_names_for_upload(config, &overrides);
    if primary_names.is_empty() && config.fallback_policy != StorageFallbackPolicy::Always {
        return list_output_upload_records(job_id);
    }
    let upload_concurrency = config.upload_concurrency.clamp(1, 32);
    let (tx, rx) = mpsc::channel::<Result<(), AppError>>();
    let mut active = 0usize;
    let mut first_error = None;
    for output in outputs {
        while active >= upload_concurrency {
            match rx.recv() {
                Ok(Ok(())) => {}
                Ok(Err(error)) => {
                    first_error.get_or_insert(error);
                }
                Err(_) => break,
            }
            active = active.saturating_sub(1);
        }
        let tx = tx.clone();
        let job_id = job_id.to_string();
        let config = config.clone();
        let primary_names = primary_names.clone();
        let fallback_names = fallback_names.clone();
        thread::spawn(move || {
            let primary_completed =
                match run_target_uploads(&config, &job_id, &output, &primary_names, "primary") {
                    Ok(value) => value,
                    Err(error) => {
                        let _ = tx.send(Err(error));
                        return;
                    }
                };
            let should_run_fallback = match config.fallback_policy {
                StorageFallbackPolicy::Never => false,
                StorageFallbackPolicy::Always => true,
                StorageFallbackPolicy::OnFailure => !primary_names.is_empty() && !primary_completed,
            };
            if should_run_fallback {
                if let Err(error) =
                    run_target_uploads(&config, &job_id, &output, &fallback_names, "fallback")
                {
                    let _ = tx.send(Err(error));
                    return;
                }
            }
            let _ = tx.send(Ok(()));
        });
        active += 1;
    }
    drop(tx);
    while active > 0 {
        match rx.recv() {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                first_error.get_or_insert(error);
            }
            Err(_) => break,
        }
        active -= 1;
    }
    if let Some(error) = first_error {
        return Err(error);
    }
    list_output_upload_records(job_id)
}

pub fn test_storage_target(name: &str, target: &StorageTargetConfig) -> StorageTestResult {
    let started = SystemTime::now();
    let target_type = storage_target_type(target).to_string();
    let mut result = match target {
        StorageTargetConfig::Local { directory, .. } => {
            let check = fs::create_dir_all(directory).and_then(|_| {
                let path = directory.join(".gpt-image-2-storage-test");
                fs::write(&path, b"ok")?;
                let _ = fs::remove_file(&path);
                Ok(())
            });
            match check {
                Ok(()) => StorageTestResult {
                    ok: true,
                    target: name.to_string(),
                    target_type,
                    message: "本地目录可写。".to_string(),
                    latency_ms: None,
                    detail: Some(json!({"directory": directory.display().to_string()})),
                    unsupported: false,
                    local_only: true,
                },
                Err(error) => StorageTestResult {
                    ok: false,
                    target: name.to_string(),
                    target_type,
                    message: format!("本地目录不可写：{error}"),
                    latency_ms: None,
                    detail: Some(json!({"directory": directory.display().to_string()})),
                    unsupported: false,
                    local_only: true,
                },
            }
        }
        StorageTargetConfig::Http { url, headers, .. } => {
            let check = validate_remote_http_target(url, "HTTP storage").and_then(
                |(_, host_label, addrs)| {
                    let client = pinned_http_client(
                        &host_label,
                        &addrs,
                        Duration::from_secs(10),
                        "storage_http_client_failed",
                        "Unable to build HTTP storage client.",
                    )?;
                    let mut request = client.head(url);
                    request = request.headers(resolve_storage_headers(headers)?);
                    request.send().map_err(|error| {
                        AppError::new("storage_http_request_failed", "HTTP storage test failed.")
                            .with_detail(json!({
                                "url": redact_url_for_log(url),
                                "error": error.to_string(),
                            }))
                    })
                },
            );
            match check {
                Ok(response) => StorageTestResult {
                    ok: response.status().is_success() || response.status().as_u16() == 405,
                    target: name.to_string(),
                    target_type,
                    message: format!("HTTP 目标可达：{}", response.status()),
                    latency_ms: None,
                    detail: Some(json!({"status": response.status().as_u16()})),
                    unsupported: false,
                    local_only: false,
                },
                Err(error) => {
                    let message = error.message.clone();
                    StorageTestResult {
                        ok: false,
                        target: name.to_string(),
                        target_type,
                        message: format!("HTTP 目标不可达：{message}"),
                        latency_ms: None,
                        detail: Some(json!({"error": storage_error_message(error)})),
                        unsupported: false,
                        local_only: false,
                    }
                }
            }
        }
        StorageTargetConfig::WebDav {
            url,
            username,
            password,
            ..
        } => {
            let check = validate_remote_http_target(url, "WebDAV storage").and_then(
                |(_, host_label, addrs)| {
                    let client = pinned_http_client(
                        &host_label,
                        &addrs,
                        Duration::from_secs(10),
                        "storage_webdav_client_failed",
                        "Unable to build WebDAV client.",
                    )?;
                    let mut request =
                        client.request(reqwest::Method::from_bytes(b"PROPFIND").unwrap(), url);
                    request = request.header("Depth", "0");
                    if let Some(username) =
                        username.as_deref().filter(|value| !value.trim().is_empty())
                    {
                        let password = password
                            .as_ref()
                            .map(resolve_credential)
                            .transpose()?
                            .map(|(value, _)| value)
                            .unwrap_or_default();
                        request = request.basic_auth(username.to_string(), Some(password));
                    }
                    request.send().map_err(|error| {
                        AppError::new(
                            "storage_webdav_request_failed",
                            "WebDAV storage test failed.",
                        )
                        .with_detail(json!({
                            "url": redact_url_for_log(url),
                            "error": error.to_string(),
                        }))
                    })
                },
            );
            match check {
                Ok(response) => StorageTestResult {
                    ok: response.status().is_success()
                        || matches!(response.status().as_u16(), 207 | 405),
                    target: name.to_string(),
                    target_type,
                    message: format!("WebDAV 目标可达：{}", response.status()),
                    latency_ms: None,
                    detail: Some(json!({"status": response.status().as_u16()})),
                    unsupported: false,
                    local_only: false,
                },
                Err(error) => {
                    let message = error.message.clone();
                    StorageTestResult {
                        ok: false,
                        target: name.to_string(),
                        target_type,
                        message: format!("WebDAV 目标不可达：{message}"),
                        latency_ms: None,
                        detail: Some(json!({"error": storage_error_message(error)})),
                        unsupported: false,
                        local_only: false,
                    }
                }
            }
        }
        StorageTargetConfig::Sftp {
            host,
            port,
            host_key_sha256,
            username,
            password,
            private_key,
            remote_dir,
            ..
        } => {
            let check = connect_sftp_session(host, *port, host_key_sha256.as_deref()).and_then(
                |(session, fingerprint)| {
                    authenticate_sftp_session(
                        &session,
                        host,
                        username,
                        password.as_ref(),
                        private_key.as_ref(),
                    )?;
                    let sftp = session.sftp().map_err(|error| {
                        AppError::new("storage_sftp_open_failed", "Unable to open SFTP subsystem.")
                            .with_detail(json!({"error": error.to_string()}))
                    })?;
                    sftp.stat(Path::new(remote_dir)).map_err(|error| {
                        AppError::new(
                            "storage_sftp_remote_dir_failed",
                            "Unable to access SFTP remote directory.",
                        )
                        .with_detail(json!({
                            "remote_dir": remote_dir,
                            "error": error.to_string(),
                        }))
                    })?;
                    Ok(fingerprint)
                },
            );
            match check {
                Ok(fingerprint) => StorageTestResult {
                    ok: true,
                    target: name.to_string(),
                    target_type,
                    message: "SFTP 认证与目录访问正常。".to_string(),
                    latency_ms: None,
                    detail: Some(json!({
                        "host": host,
                        "port": port,
                        "host_key_sha256": fingerprint,
                    })),
                    unsupported: false,
                    local_only: false,
                },
                Err(error) => StorageTestResult {
                    ok: false,
                    target: name.to_string(),
                    target_type,
                    message: format!("SFTP 目标不可用：{}", error.message),
                    latency_ms: None,
                    detail: Some(json!({
                        "host": host,
                        "port": port,
                        "error": storage_error_message(error),
                    })),
                    unsupported: false,
                    local_only: false,
                },
            }
        }
        StorageTargetConfig::S3 {
            bucket,
            region,
            endpoint,
            access_key_id,
            secret_access_key,
            ..
        } => {
            let access_key_ready =
                storage_credential_present_and_resolvable(access_key_id.as_ref()).is_ok();
            let secret_key_ready =
                storage_credential_present_and_resolvable(secret_access_key.as_ref()).is_ok();
            let credential_ready = access_key_ready && secret_key_ready;
            let endpoint_url = s3_endpoint_and_host(
                bucket,
                region.as_deref(),
                endpoint.as_deref(),
                ".gpt-image-2-storage-test",
            );
            let endpoint_ready = endpoint_url
                .as_ref()
                .map(|(url, _, _)| validate_remote_http_target(url, "S3 storage").is_ok())
                .unwrap_or(false);
            StorageTestResult {
                ok: credential_ready && endpoint_ready,
                target: name.to_string(),
                target_type,
                message: if credential_ready && endpoint_ready {
                    "S3 配置可用于上传。".to_string()
                } else if !credential_ready {
                    "S3 access key / secret key 不可用。".to_string()
                } else {
                    "S3 endpoint 配置无效。".to_string()
                },
                latency_ms: None,
                detail: Some(json!({
                    "bucket": bucket,
                    "region": region,
                    "access_key_ready": access_key_ready,
                    "secret_key_ready": secret_key_ready,
                    "endpoint_ready": endpoint_ready,
                })),
                unsupported: false,
                local_only: false,
            }
        }
    };
    result.latency_ms = Some(started.elapsed().unwrap_or_default().as_millis());
    result
}

fn list_output_upload_records_with_conn(
    conn: &Connection,
    job_id: &str,
) -> Result<Vec<OutputUploadRecord>, AppError> {
    let mut stmt = conn
        .prepare(
            "SELECT job_id, output_index, target, target_type, status, url, error, bytes, attempts, updated_at, metadata
             FROM output_uploads
             WHERE job_id = ?1
             ORDER BY output_index ASC, target ASC",
        )
        .map_err(|error| {
            AppError::new("history_query_failed", "Unable to query output upload history.")
                .with_detail(json!({"error": error.to_string()}))
        })?;
    stmt.query_map(params![job_id], row_to_upload_record)
        .map_err(|error| {
            AppError::new(
                "history_query_failed",
                "Unable to query output upload history.",
            )
            .with_detail(json!({"error": error.to_string()}))
        })?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| {
            AppError::new(
                "history_query_failed",
                "Unable to read output upload history.",
            )
            .with_detail(json!({"error": error.to_string()}))
        })
}

#[derive(Debug, Clone, Default)]
pub struct HistoryListOptions {
    pub limit: Option<usize>,
    pub cursor: Option<String>,
    pub status: Option<String>,
    pub query: Option<String>,
    /// When false (default), soft-deleted rows (deleted_at IS NOT NULL) are
    /// excluded. Trash views set this to true to surface them.
    pub include_deleted: bool,
}

#[derive(Debug, Clone)]
pub struct HistoryListPage {
    pub jobs: Vec<Value>,
    pub next_cursor: Option<String>,
    pub has_more: bool,
    pub total: usize,
}

fn storage_status_for_uploads(uploads: &[OutputUploadRecord]) -> &'static str {
    if uploads.is_empty() {
        return "not_configured";
    }
    let completed = uploads
        .iter()
        .filter(|upload| upload.status == "completed")
        .count();
    if completed == uploads.len() {
        "completed"
    } else {
        let primary_completed = uploads.iter().any(|upload| {
            upload.status == "completed"
                && upload.metadata.get("role").and_then(Value::as_str) == Some("primary")
        });
        let fallback_completed = uploads.iter().any(|upload| {
            upload.status == "completed"
                && upload.metadata.get("role").and_then(Value::as_str) == Some("fallback")
        });
        if fallback_completed && !primary_completed {
            "fallback_completed"
        } else if completed > 0 {
            "partial_failed"
        } else {
            "failed"
        }
    }
}

fn enrich_outputs_with_uploads(mut outputs: Value, uploads: &[OutputUploadRecord]) -> Value {
    let Some(output_items) = outputs.as_array_mut() else {
        return outputs;
    };
    for output in output_items {
        let Some(output_index) = output
            .get("index")
            .and_then(Value::as_u64)
            .map(|value| value as usize)
        else {
            continue;
        };
        let output_uploads = uploads
            .iter()
            .filter(|upload| upload.output_index == output_index)
            .map(upload_record_to_value)
            .collect::<Vec<_>>();
        if output_uploads.is_empty() {
            continue;
        }
        if let Some(object) = output.as_object_mut() {
            object.insert("uploads".to_string(), Value::Array(output_uploads));
        }
    }
    outputs
}

fn history_row_to_value(row: &Row<'_>) -> rusqlite::Result<Value> {
    history_row_to_value_with_uploads(row, &[])
}

fn history_row_to_value_with_uploads(
    row: &Row<'_>,
    uploads: &[OutputUploadRecord],
) -> rusqlite::Result<Value> {
    let id = row.get::<_, String>(0)?;
    let output_path = row.get::<_, Option<String>>(4)?;
    let created_at = row.get::<_, String>(5)?;
    let metadata = serde_json::from_str::<Value>(&row.get::<_, String>(6)?).unwrap_or(Value::Null);
    let output = metadata.get("output").cloned().unwrap_or_else(|| json!({}));
    let outputs = output
        .get("files")
        .cloned()
        .or_else(|| {
            metadata
                .get("image_output")
                .and_then(|value| value.get("files"))
                .cloned()
        })
        .unwrap_or_else(|| json!([]));
    let updated_at = metadata
        .get("updated_at")
        .and_then(Value::as_str)
        .unwrap_or(&created_at)
        .to_string();
    let error = metadata.get("error").cloned().unwrap_or(Value::Null);
    Ok(json!({
        "id": id,
        "command": row.get::<_, String>(1)?,
        "provider": row.get::<_, String>(2)?,
        "status": row.get::<_, String>(3)?,
        "output_path": output_path,
        "created_at": created_at,
        "updated_at": updated_at,
        "metadata": metadata,
        "outputs": enrich_outputs_with_uploads(outputs, uploads),
        "storage_status": storage_status_for_uploads(uploads),
        "error": error,
    }))
}

fn normalize_history_limit(limit: Option<usize>) -> usize {
    limit
        .unwrap_or(DEFAULT_HISTORY_PAGE_LIMIT)
        .clamp(1, MAX_HISTORY_PAGE_LIMIT)
}

fn history_status_values(status: Option<&str>) -> Vec<&'static str> {
    match status.unwrap_or("all") {
        "active" | "running" => vec!["queued", "running", "uploading"],
        "completed" => vec!["completed"],
        "failed" => vec!["failed", "cancelled", "canceled"],
        "queued" => vec!["queued"],
        "all" | "" => Vec::new(),
        _ => Vec::new(),
    }
}

fn append_status_filter(
    clauses: &mut Vec<String>,
    params: &mut Vec<SqlValue>,
    statuses: &[&'static str],
) {
    if statuses.is_empty() {
        return;
    }
    let placeholders = (0..statuses.len())
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(", ");
    clauses.push(format!("status IN ({placeholders})"));
    params.extend(
        statuses
            .iter()
            .map(|status| SqlValue::Text((*status).to_string())),
    );
}

fn normalize_history_query(query: Option<&str>) -> Option<String> {
    let trimmed = query?.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_lowercase())
}

fn escape_like_pattern(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for ch in value.chars() {
        if matches!(ch, '\\' | '%' | '_') {
            escaped.push('\\');
        }
        escaped.push(ch);
    }
    escaped
}

fn append_search_filter(
    clauses: &mut Vec<String>,
    params: &mut Vec<SqlValue>,
    query: Option<&str>,
) {
    let Some(query) = normalize_history_query(query) else {
        return;
    };
    let pattern = format!("%{}%", escape_like_pattern(&query));
    clauses.push(
        "(LOWER(id) LIKE ? ESCAPE '\\' OR LOWER(command) LIKE ? ESCAPE '\\' OR LOWER(provider) LIKE ? ESCAPE '\\' OR LOWER(metadata) LIKE ? ESCAPE '\\')"
            .to_string(),
    );
    params.extend((0..4).map(|_| SqlValue::Text(pattern.clone())));
}

fn parse_history_cursor(cursor: Option<&str>) -> Option<(String, String)> {
    let cursor = cursor?.trim();
    if cursor.is_empty() {
        return None;
    }
    let (created_at, id) = cursor.split_once('|')?;
    if created_at.is_empty() || id.is_empty() {
        return None;
    }
    Some((created_at.to_string(), id.to_string()))
}

fn history_cursor_for(job: &Value) -> Option<String> {
    let created_at = job.get("created_at")?.as_str()?;
    let id = job.get("id")?.as_str()?;
    Some(format!("{created_at}|{id}"))
}

fn enrich_history_jobs_with_uploads(conn: &Connection, jobs: &mut [Value]) -> Result<(), AppError> {
    for job in jobs {
        let Some(job_id) = job.get("id").and_then(Value::as_str).map(str::to_string) else {
            continue;
        };
        let uploads = list_output_upload_records_with_conn(conn, &job_id)?;
        if let Some(object) = job.as_object_mut() {
            let outputs = object.remove("outputs").unwrap_or_else(|| json!([]));
            object.insert(
                "outputs".to_string(),
                enrich_outputs_with_uploads(outputs, &uploads),
            );
            object.insert(
                "storage_status".to_string(),
                Value::String(storage_status_for_uploads(&uploads).to_string()),
            );
        }
    }
    Ok(())
}

fn history_where_sql(clauses: &[String]) -> String {
    if clauses.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", clauses.join(" AND "))
    }
}

pub fn list_history_jobs_page(options: HistoryListOptions) -> Result<HistoryListPage, AppError> {
    let conn = open_history_db()?;
    let limit = normalize_history_limit(options.limit);
    let statuses = history_status_values(options.status.as_deref());
    let cursor = parse_history_cursor(options.cursor.as_deref());

    let mut count_clauses = Vec::new();
    let mut count_params = Vec::new();
    append_status_filter(&mut count_clauses, &mut count_params, &statuses);
    if !options.include_deleted {
        count_clauses.push("deleted_at IS NULL".to_string());
    }
    append_search_filter(
        &mut count_clauses,
        &mut count_params,
        options.query.as_deref(),
    );
    let count_sql = format!(
        "SELECT COUNT(*) FROM jobs{}",
        history_where_sql(&count_clauses)
    );
    let total = conn
        .query_row(&count_sql, params_from_iter(count_params), |row| {
            row.get::<_, i64>(0)
        })
        .map_err(|error| {
            AppError::new("history_query_failed", "Unable to count history.")
                .with_detail(json!({"error": error.to_string()}))
        })? as usize;

    let mut clauses = Vec::new();
    let mut query_params = Vec::new();
    append_status_filter(&mut clauses, &mut query_params, &statuses);
    if !options.include_deleted {
        clauses.push("deleted_at IS NULL".to_string());
    }
    append_search_filter(&mut clauses, &mut query_params, options.query.as_deref());
    if let Some((created_at, id)) = cursor {
        clauses.push("(created_at < ? OR (created_at = ? AND id < ?))".to_string());
        query_params.push(SqlValue::Text(created_at.clone()));
        query_params.push(SqlValue::Text(created_at));
        query_params.push(SqlValue::Text(id));
    }
    query_params.push(SqlValue::Integer((limit + 1) as i64));
    let query_sql = format!(
        "SELECT id, command, provider, status, output_path, created_at, metadata FROM jobs{} ORDER BY created_at DESC, id DESC LIMIT ?",
        history_where_sql(&clauses)
    );
    let mut stmt = conn.prepare(&query_sql).map_err(|error| {
        AppError::new("history_query_failed", "Unable to query history.")
            .with_detail(json!({"error": error.to_string()}))
    })?;
    let mut jobs = stmt
        .query_map(params_from_iter(query_params), history_row_to_value)
        .map_err(|error| {
            AppError::new("history_query_failed", "Unable to query history.")
                .with_detail(json!({"error": error.to_string()}))
        })?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| {
            AppError::new("history_query_failed", "Unable to read history rows.")
                .with_detail(json!({"error": error.to_string()}))
        })?;
    enrich_history_jobs_with_uploads(&conn, &mut jobs)?;
    let has_more = jobs.len() > limit;
    if has_more {
        jobs.truncate(limit);
    }
    let next_cursor = if has_more {
        jobs.last().and_then(history_cursor_for)
    } else {
        None
    };
    Ok(HistoryListPage {
        jobs,
        next_cursor,
        has_more,
        total,
    })
}

pub fn list_history_jobs() -> Result<Vec<Value>, AppError> {
    Ok(list_history_jobs_page(HistoryListOptions::default())?.jobs)
}

pub fn list_active_history_jobs() -> Result<Vec<Value>, AppError> {
    let conn = open_history_db()?;
    let mut stmt = conn
        .prepare("SELECT id, command, provider, status, output_path, created_at, metadata FROM jobs WHERE status IN ('queued', 'running') AND deleted_at IS NULL ORDER BY created_at DESC, id DESC")
        .map_err(|error| AppError::new("history_query_failed", "Unable to query active history.").with_detail(json!({"error": error.to_string()})))?;
    let mut jobs = stmt
        .query_map([], history_row_to_value)
        .map_err(|error| {
            AppError::new("history_query_failed", "Unable to query active history.")
                .with_detail(json!({"error": error.to_string()}))
        })?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| {
            AppError::new(
                "history_query_failed",
                "Unable to read active history rows.",
            )
            .with_detail(json!({"error": error.to_string()}))
        })?;
    enrich_history_jobs_with_uploads(&conn, &mut jobs)?;
    Ok(jobs)
}

pub fn show_history_job(job_id: &str) -> Result<Value, AppError> {
    let conn = open_history_db()?;
    let uploads = list_output_upload_records_with_conn(&conn, job_id)?;
    let mut stmt = conn
        .prepare("SELECT id, command, provider, status, output_path, created_at, metadata FROM jobs WHERE id = ?1")
        .map_err(|error| AppError::new("history_query_failed", "Unable to query history.").with_detail(json!({"error": error.to_string()})))?;
    stmt.query_row(params![job_id], |row| {
        history_row_to_value_with_uploads(row, &uploads)
    })
    .map_err(|error| {
        AppError::new("history_not_found", "History job was not found.")
            .with_detail(json!({"job_id": job_id, "error": error.to_string()}))
    })
}

fn run_history_command(_cli: &Cli, command: &HistoryCommand) -> Result<CommandOutcome, AppError> {
    match &command.history_command {
        HistorySubcommand::List => Ok(CommandOutcome {
            payload: json!({"ok": true, "command": "history list", "jobs": list_history_jobs()?}),
            exit_status: 0,
        }),
        HistorySubcommand::Show(args) | HistorySubcommand::OpenOutput(args) => {
            let row = show_history_job(&args.job_id)?;
            let opened = if matches!(&command.history_command, HistorySubcommand::OpenOutput(_)) {
                row.get("output_path")
                    .and_then(Value::as_str)
                    .map(open_path)
                    .unwrap_or(false)
            } else {
                false
            };
            Ok(CommandOutcome {
                payload: json!({"ok": true, "command": "history show", "job": row, "opened": opened}),
                exit_status: 0,
            })
        }
        HistorySubcommand::Delete(args) => {
            let count = delete_history_job(&args.job_id)?;
            Ok(CommandOutcome {
                payload: json!({"ok": true, "command": "history delete", "job_id": args.job_id, "deleted": count}),
                exit_status: 0,
            })
        }
    }
}

fn open_path(path: &str) -> bool {
    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(path).status();
    #[cfg(target_os = "windows")]
    let status = Command::new("cmd").args(["/C", "start", "", path]).status();
    #[cfg(all(unix, not(target_os = "macos")))]
    let status = Command::new("xdg-open").arg(path).status();
    status.map(|status| status.success()).unwrap_or(false)
}

fn run_doctor(cli: &Cli) -> CommandOutcome {
    let auth_path = PathBuf::from(&cli.auth_file);
    let config_path = cli_config_path(cli);
    let config = load_app_config(&config_path).unwrap_or_default();
    let codex_auth = inspect_codex_auth_file(&auth_path);
    let openai_auth = inspect_openai_auth(cli.api_key.as_deref());
    let codex_endpoint = check_endpoint_reachability(&cli.endpoint);
    let openai_endpoint = check_endpoint_reachability(&cli.openai_api_base);

    let selection = select_image_provider(cli);
    let ready = selection
        .as_ref()
        .map(|selection| {
            let endpoint = match selection.kind {
                ProviderKind::OpenAi => check_endpoint_reachability(&selection.api_base),
                ProviderKind::Codex => check_endpoint_reachability(&selection.codex_endpoint),
            };
            endpoint
                .get("reachable")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        })
        .unwrap_or(false);

    let provider_selection = match selection {
        Ok(selection) => {
            let mut payload = selection.payload();
            payload["error"] = Value::Null;
            payload
        }
        Err(error) => json!({
            "requested": cli.provider.as_str(),
            "resolved": Value::Null,
            "reason": Value::Null,
            "error": {
                "code": error.code,
                "message": error.message,
                "detail": error.detail,
            },
        }),
    };

    CommandOutcome {
        payload: json!({
            "ok": ready,
            "command": "doctor",
            "version": VERSION,
            "provider_selection": provider_selection,
            "providers": {
                "openai": {"auth": openai_auth, "endpoint": openai_endpoint},
                "codex": {"auth": codex_auth, "endpoint": codex_endpoint},
                "configured": redact_app_config(&config)["providers"].clone(),
            },
            "defaults": {
                "provider": "auto",
                "config_file": config_path.display().to_string(),
                "default_provider": config.default_provider,
                "openai_model": DEFAULT_OPENAI_MODEL,
                "codex_model": DEFAULT_CODEX_MODEL,
                "codex_endpoint": cli.endpoint,
                "openai_api_base": cli.openai_api_base,
            },
            "retry_policy": {
                "max_retries": DEFAULT_RETRY_COUNT,
                "base_delay_seconds": DEFAULT_RETRY_DELAY_SECONDS,
            }
        }),
        exit_status: 0,
    }
}

fn run_auth_inspect(cli: &Cli) -> Result<CommandOutcome, AppError> {
    let auth_path = PathBuf::from(&cli.auth_file);
    let config = load_app_config(&cli_config_path(cli))?;
    let providers = json!({
        "openai": inspect_openai_auth(cli.api_key.as_deref()),
        "codex": inspect_codex_auth_file(&auth_path),
        "configured": redact_app_config(&config)["providers"].clone(),
    });
    if cli.provider == "openai"
        && !providers["openai"]
            .get("ready")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    {
        return Err(AppError::new(
            "api_key_missing",
            format!("Missing {}.", OPENAI_API_KEY_ENV),
        ));
    }
    if cli.provider == "codex"
        && !providers["codex"]
            .get("ready")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    {
        return Err(AppError::new(
            "access_token_missing",
            "auth.json did not contain a usable access_token.",
        ));
    }
    Ok(CommandOutcome {
        payload: json!({
            "ok": true,
            "command": "auth inspect",
            "requested_provider": cli.provider.as_str(),
            "providers": providers,
        }),
        exit_status: 0,
    })
}

fn run_models_list() -> CommandOutcome {
    CommandOutcome {
        payload: json!({
            "ok": true,
            "command": "models list",
            "providers": build_known_model_payloads(),
        }),
        exit_status: 0,
    }
}

fn run_openai_image_command(
    cli: &Cli,
    selection: &ProviderSelection,
    shared: &SharedImageArgs,
    operation: &str,
    ref_images: &[String],
    mask: Option<&str>,
    input_fidelity: Option<InputFidelity>,
) -> Result<CommandOutcome, AppError> {
    let output_path = PathBuf::from(&shared.out);
    let auth_state = load_openai_auth_state_for(cli, selection)?;
    let resolved_ref_images = resolve_ref_images(ref_images)?;
    let resolved_mask = match mask {
        Some(mask) => Some(resolve_ref_image(mask)?),
        None => None,
    };
    let resolved_model = shared
        .model
        .clone()
        .unwrap_or_else(|| selection.default_model.clone());
    let body = build_openai_image_body(
        operation,
        &shared.prompt,
        &resolved_model,
        &resolved_ref_images,
        resolved_mask.as_deref(),
        input_fidelity,
        shared.background,
        shared.size.as_deref(),
        shared.quality,
        shared.output_format,
        shared.output_compression,
        shared.n,
        shared.moderation,
    );
    let endpoint = build_openai_operation_endpoint(&selection.api_base, operation)?;
    let mut logger = JsonEventLogger::new(cli.json_events);
    let (payload, retry_count) =
        execute_openai_with_retry(&mut logger, &selection.resolved, |logger| {
            if operation == "edit" {
                request_openai_edit_once(&endpoint, &auth_state, &body, logger)
            } else {
                request_openai_images_once(&endpoint, &auth_state, &body, logger)
            }
        })?;
    let (image_bytes_list, revised_prompts) = decode_openai_images(&payload)?;
    if image_bytes_list.is_empty() {
        return Err(AppError::new(
            "missing_image_result",
            "The response did not include a generated image.",
        ));
    }
    let saved_files = save_images(&output_path, &image_bytes_list)?;
    let primary_output_path = primary_saved_output_path(&output_path, &saved_files);
    let history_job_id = record_history_job(
        &format!("images {operation}"),
        &selection.resolved,
        "completed",
        Some(&primary_output_path),
        history_image_metadata(operation, selection, shared, &saved_files),
    )
    .ok();
    emit_progress_event(
        &mut logger,
        "openai",
        "output_saved",
        "Generated image files saved.",
        "completed",
        Some(100),
        json!({
            "file_count": saved_files.len(),
            "output": normalize_saved_output(&saved_files),
        }),
    );
    Ok(CommandOutcome {
        payload: json!({
            "ok": true,
            "command": format!("images {}", operation),
            "provider": selection.resolved,
            "provider_selection": selection.payload(),
            "auth": {
                "source": auth_state.source,
                "env_var": OPENAI_API_KEY_ENV,
                "refreshed": false,
            },
            "request": summarize_image_request_options("openai", operation, &resolved_model, shared, resolved_ref_images.len(), resolved_mask.is_some(), input_fidelity),
            "response": {
                "created": payload.get("created"),
                "background": payload.get("background"),
                "output_format": payload.get("output_format"),
                "quality": payload.get("quality"),
                "size": payload.get("size"),
                "usage": payload.get("usage").map(redact_event_payload).unwrap_or(Value::Null),
                "image_count": image_bytes_list.len(),
                "revised_prompts": revised_prompts.into_iter().flatten().collect::<Vec<_>>(),
            },
            "output": normalize_saved_output(&saved_files),
            "history": {
                "job_id": history_job_id,
            },
            "retry": {
                "count": retry_count,
                "max_retries": DEFAULT_RETRY_COUNT,
            },
            "events": {
                "count": logger.seq,
            }
        }),
        exit_status: 0,
    })
}

fn run_codex_image_command(
    cli: &Cli,
    selection: &ProviderSelection,
    shared: &SharedImageArgs,
    operation: &str,
    ref_images: &[String],
) -> Result<CommandOutcome, AppError> {
    let mut auth_state = load_codex_auth_state_for(cli, selection)?;
    let output_path = PathBuf::from(&shared.out);
    let resolved_ref_images = resolve_ref_images(ref_images)?;
    let resolved_model = shared
        .model
        .clone()
        .unwrap_or_else(|| selection.default_model.clone());
    let body = build_codex_image_body(
        &shared.prompt,
        &resolved_model,
        &shared.instructions,
        &resolved_ref_images,
        shared.background,
        shared.size.as_deref(),
        shared.quality,
        shared.output_format,
        shared.output_compression,
        operation,
    );
    let mut logger = JsonEventLogger::new(cli.json_events);
    let (outcome, auth_refreshed, retry_count) = request_codex_with_retry(
        &selection.codex_endpoint,
        &mut auth_state,
        &body,
        &mut logger,
    )?;
    let output_items = outcome
        .get("output_items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let image_items = extract_codex_image_items(&output_items);
    if image_items.is_empty() {
        return Err(AppError::new(
            "missing_image_result",
            "The response did not include an image_generation_call result.",
        ));
    }
    let image_bytes_list: Vec<Vec<u8>> = image_items
        .iter()
        .filter_map(|item| item.get("result").and_then(Value::as_str))
        .map(decode_base64_bytes)
        .collect::<Result<_, _>>()?;
    let saved_files = save_images(&output_path, &image_bytes_list)?;
    let primary_output_path = primary_saved_output_path(&output_path, &saved_files);
    let history_job_id = record_history_job(
        &format!("images {operation}"),
        &selection.resolved,
        "completed",
        Some(&primary_output_path),
        history_image_metadata(operation, selection, shared, &saved_files),
    )
    .ok();
    emit_progress_event(
        &mut logger,
        "codex",
        "output_saved",
        "Generated image files saved.",
        "completed",
        Some(100),
        json!({
            "file_count": saved_files.len(),
            "output": normalize_saved_output(&saved_files),
        }),
    );
    let response_meta = outcome
        .get("response")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let revised_prompts = image_items
        .iter()
        .filter_map(|item| item.get("revised_prompt").and_then(Value::as_str))
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    Ok(CommandOutcome {
        payload: json!({
            "ok": true,
            "command": format!("images {}", operation),
            "provider": selection.resolved,
            "provider_selection": selection.payload(),
            "auth": {
                "source": match &auth_state.persistence {
                    CodexAuthPersistence::AuthFile => "auth.json",
                    CodexAuthPersistence::ConfigProvider { .. } => "config",
                    CodexAuthPersistence::SessionOnly => "session",
                },
                "auth_file": auth_state.auth_path.display().to_string(),
                "account_id": auth_state.account_id,
                "refreshed": auth_refreshed,
            },
            "request": summarize_image_request_options("codex", operation, &resolved_model, shared, resolved_ref_images.len(), false, None),
            "response": {
                "response_id": response_meta.get("id"),
                "model": response_meta.get("model"),
                "service_tier": response_meta.get("service_tier"),
                "status": response_meta.get("status"),
                "image_count": image_items.len(),
                "item_ids": image_items.iter().map(|item| item.get("id").cloned().unwrap_or(Value::Null)).collect::<Vec<_>>(),
                "revised_prompts": revised_prompts,
            },
            "output": normalize_saved_output(&saved_files),
            "history": {
                "job_id": history_job_id,
            },
            "retry": {
                "count": retry_count,
                "max_retries": DEFAULT_RETRY_COUNT,
            },
            "events": {
                "count": logger.seq,
            }
        }),
        exit_status: 0,
    })
}

fn batch_output_path(output_path: &Path, index: usize) -> String {
    let base_name = output_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .or_else(|| output_path.file_name().and_then(|name| name.to_str()))
        .unwrap_or("image");
    let suffix = output_path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| format!(".{ext}"))
        .unwrap_or_else(|| ".png".to_string());
    output_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(format!("{base_name}-{}{}", index + 1, suffix))
        .display()
        .to_string()
}

fn output_files_from_payload(payload: &Value) -> Vec<Value> {
    let output = payload.get("output").cloned().unwrap_or_else(|| json!({}));
    let mut files = output
        .get("files")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if files.is_empty()
        && let Some(path) = output.get("path").and_then(Value::as_str)
    {
        files.push(json!({
            "index": 0,
            "path": path,
            "bytes": output.get("bytes").and_then(Value::as_u64).unwrap_or(0),
        }));
    }
    files
}

fn normalize_batch_saved_files(files: Vec<Value>) -> Vec<Value> {
    files
        .into_iter()
        .enumerate()
        .map(|(index, mut file)| {
            if let Value::Object(object) = &mut file {
                object.insert("index".to_string(), json!(index));
            }
            file
        })
        .collect()
}

fn run_batched_image_command(
    cli: &Cli,
    selection: &ProviderSelection,
    shared: &SharedImageArgs,
    operation: &str,
    ref_images: &[String],
    mask: Option<&str>,
    input_fidelity: Option<InputFidelity>,
) -> Result<CommandOutcome, AppError> {
    let count = shared.n.unwrap_or(1);
    let output_path = PathBuf::from(&shared.out);
    let jobs = (0..count)
        .map(|index| {
            let mut next = shared.clone();
            next.n = None;
            next.out = batch_output_path(&output_path, index as usize);
            next
        })
        .collect::<Vec<_>>();
    let outcomes = std::thread::scope(|scope| {
        let handles = jobs
            .into_iter()
            .map(|next| {
                scope.spawn(move || {
                    if matches!(selection.kind, ProviderKind::OpenAi) {
                        run_openai_image_command(
                            cli,
                            selection,
                            &next,
                            operation,
                            ref_images,
                            mask,
                            input_fidelity,
                        )
                    } else {
                        run_codex_image_command(cli, selection, &next, operation, ref_images)
                    }
                })
            })
            .collect::<Vec<_>>();
        let mut outcomes = Vec::with_capacity(handles.len());
        for handle in handles {
            outcomes.push(handle.join().map_err(|_| {
                AppError::new(
                    "batch_worker_failed",
                    "Batch image request worker panicked.",
                )
            })??);
        }
        Ok::<_, AppError>(outcomes)
    })?;
    let saved_files = normalize_batch_saved_files(
        outcomes
            .iter()
            .flat_map(|outcome| output_files_from_payload(&outcome.payload))
            .collect(),
    );
    if saved_files.is_empty() {
        return Err(AppError::new(
            "missing_image_result",
            "The batch response did not include generated images.",
        ));
    }
    let primary_output_path = primary_saved_output_path(&output_path, &saved_files);
    let history_job_id = record_history_job(
        &format!("images {operation}"),
        &selection.resolved,
        "completed",
        Some(&primary_output_path),
        history_image_metadata(operation, selection, shared, &saved_files),
    )
    .ok();
    Ok(CommandOutcome {
        payload: json!({
            "ok": true,
            "command": format!("images {}", operation),
            "provider": selection.resolved,
            "provider_selection": selection.payload(),
            "request": {
                "operation": operation,
                "provider": if matches!(selection.kind, ProviderKind::OpenAi) { "openai" } else { "codex" },
                "n": count,
                "batch_mode": "parallel-single-output",
            },
            "response": {
                "image_count": saved_files.len(),
                "batch_request_count": count,
            },
            "output": normalize_saved_output(&saved_files),
            "history": {
                "job_id": history_job_id,
            },
            "events": {
                "count": outcomes.iter().filter_map(|outcome| outcome.payload.get("events").and_then(|events| events.get("count")).and_then(Value::as_u64)).sum::<u64>(),
            }
        }),
        exit_status: 0,
    })
}

fn run_images_command(
    cli: &Cli,
    subcommand: &ImagesSubcommand,
) -> Result<CommandOutcome, AppError> {
    let selection = select_image_provider(cli)?;
    match subcommand {
        ImagesSubcommand::Generate(args) => {
            let use_batch = args.shared.n.unwrap_or(1) > 1 && !selection.supports_n;
            let mut validation_shared = args.shared.clone();
            if use_batch {
                validation_shared.n = None;
            }
            validate_provider_specific_image_args(&selection, &validation_shared, None, None)?;
            if use_batch {
                return run_batched_image_command(
                    cli,
                    &selection,
                    &args.shared,
                    "generate",
                    &[],
                    None,
                    None,
                );
            }
            if matches!(selection.kind, ProviderKind::OpenAi) {
                run_openai_image_command(cli, &selection, &args.shared, "generate", &[], None, None)
            } else {
                run_codex_image_command(cli, &selection, &args.shared, "generate", &[])
            }
        }
        ImagesSubcommand::Edit(args) => {
            validate_reference_image_count(args.ref_image.len())?;
            let use_batch = args.shared.n.unwrap_or(1) > 1 && !selection.supports_n;
            let mut validation_shared = args.shared.clone();
            if use_batch {
                validation_shared.n = None;
            }
            validate_provider_specific_image_args(
                &selection,
                &validation_shared,
                args.mask.as_deref(),
                args.input_fidelity,
            )?;
            if use_batch {
                return run_batched_image_command(
                    cli,
                    &selection,
                    &args.shared,
                    "edit",
                    &args.ref_image,
                    args.mask.as_deref(),
                    args.input_fidelity,
                );
            }
            if matches!(selection.kind, ProviderKind::OpenAi) {
                run_openai_image_command(
                    cli,
                    &selection,
                    &args.shared,
                    "edit",
                    &args.ref_image,
                    args.mask.as_deref(),
                    args.input_fidelity,
                )
            } else {
                run_codex_image_command(cli, &selection, &args.shared, "edit", &args.ref_image)
            }
        }
    }
}

fn run_request_create_codex(
    cli: &Cli,
    selection: &ProviderSelection,
    args: &RequestCreateArgs,
) -> Result<CommandOutcome, AppError> {
    if args.request_operation != RequestOperation::Responses {
        return Err(AppError::new(
            "unsupported_option",
            "Codex request create uses --request-operation responses.",
        ));
    }
    let mut auth_state = load_codex_auth_state_for(cli, selection)?;
    let body = read_body_json(&args.body_file)?;
    let mut logger = JsonEventLogger::new(cli.json_events);
    let (outcome, auth_refreshed, retry_count) = request_codex_with_retry(
        &selection.codex_endpoint,
        &mut auth_state,
        &body,
        &mut logger,
    )?;
    let response_meta = outcome
        .get("response")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let output_items = outcome
        .get("output_items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let image_items = extract_codex_image_items(&output_items);
    let image_output = if image_items.is_empty() {
        None
    } else {
        let image_bytes_list: Vec<Vec<u8>> = image_items
            .iter()
            .filter_map(|item| item.get("result").and_then(Value::as_str))
            .map(decode_base64_bytes)
            .collect::<Result<_, _>>()?;
        if let Some(out_image) = &args.out_image {
            let saved_files = save_images(Path::new(out_image), &image_bytes_list)?;
            let output = normalize_saved_output(&saved_files);
            emit_progress_event(
                &mut logger,
                "codex",
                "output_saved",
                "Generated image files saved.",
                "completed",
                Some(100),
                json!({ "file_count": saved_files.len(), "output": output }),
            );
            Some(output)
        } else {
            Some(json!({
                "available": true,
                "count": image_bytes_list.len(),
                "suggested_extension": detect_extension(&image_bytes_list[0]),
            }))
        }
    };
    if args.expect_image && image_output.is_none() {
        return Err(AppError::new(
            "missing_image_result",
            "The response did not include a generated image.",
        ));
    }
    let history_job_id = record_history_job(
        "request create",
        &selection.resolved,
        "completed",
        args.out_image.as_deref().map(Path::new),
        json!({
            "operation": "responses",
            "provider_selection": selection.payload(),
            "image_output": image_output.clone(),
        }),
    )
    .ok();
    Ok(CommandOutcome {
        payload: json!({
            "ok": true,
            "command": "request create",
            "provider": selection.resolved,
            "provider_selection": selection.payload(),
            "request": {
                "operation": "responses",
                "body_file": args.body_file,
            },
            "response": {
                "response_id": response_meta.get("id"),
                "model": response_meta.get("model"),
                "service_tier": response_meta.get("service_tier"),
                "status": response_meta.get("status"),
                "error": response_meta.get("error").map(redact_event_payload).unwrap_or(Value::Null),
            },
            "output_items": output_items.iter().map(summarize_output_item).collect::<Vec<_>>(),
            "image_output": image_output,
            "history": {
                "job_id": history_job_id,
            },
            "retry": {
                "count": retry_count,
                "max_retries": DEFAULT_RETRY_COUNT,
            },
            "auth": {
                "source": match &auth_state.persistence {
                    CodexAuthPersistence::AuthFile => "auth.json",
                    CodexAuthPersistence::ConfigProvider { .. } => "config",
                    CodexAuthPersistence::SessionOnly => "session",
                },
                "auth_file": auth_state.auth_path.display().to_string(),
                "refreshed": auth_refreshed,
            },
            "events": {
                "count": logger.seq,
            }
        }),
        exit_status: 0,
    })
}

fn run_request_create_openai(
    cli: &Cli,
    selection: &ProviderSelection,
    args: &RequestCreateArgs,
) -> Result<CommandOutcome, AppError> {
    if !matches!(
        args.request_operation,
        RequestOperation::Generate | RequestOperation::Edit
    ) {
        return Err(AppError::new(
            "unsupported_option",
            "OpenAI request create uses --request-operation generate or edit.",
        ));
    }
    let auth_state = load_openai_auth_state_for(cli, selection)?;
    let body = read_body_json(&args.body_file)?;
    let endpoint =
        build_openai_operation_endpoint(&selection.api_base, args.request_operation.as_str())?;
    let mut logger = JsonEventLogger::new(cli.json_events);
    let (payload, retry_count) =
        execute_openai_with_retry(&mut logger, &selection.resolved, |logger| {
            if args.request_operation == RequestOperation::Edit {
                request_openai_edit_once(&endpoint, &auth_state, &body, logger)
            } else {
                request_openai_images_once(&endpoint, &auth_state, &body, logger)
            }
        })?;
    let (image_bytes_list, revised_prompts) = decode_openai_images(&payload)?;
    let image_output = if image_bytes_list.is_empty() {
        None
    } else if let Some(out_image) = &args.out_image {
        let saved_files = save_images(Path::new(out_image), &image_bytes_list)?;
        let output = normalize_saved_output(&saved_files);
        emit_progress_event(
            &mut logger,
            "openai",
            "output_saved",
            "Generated image files saved.",
            "completed",
            Some(100),
            json!({ "file_count": saved_files.len(), "output": output }),
        );
        Some(output)
    } else {
        Some(json!({
            "available": true,
            "count": image_bytes_list.len(),
            "suggested_extension": detect_extension(&image_bytes_list[0]),
        }))
    };
    if args.expect_image && image_output.is_none() {
        return Err(AppError::new(
            "missing_image_result",
            "The response did not include a generated image.",
        ));
    }
    let history_job_id = record_history_job(
        "request create",
        &selection.resolved,
        "completed",
        args.out_image.as_deref().map(Path::new),
        json!({
            "operation": args.request_operation.as_str(),
            "provider_selection": selection.payload(),
            "image_output": image_output.clone(),
        }),
    )
    .ok();
    Ok(CommandOutcome {
        payload: json!({
            "ok": true,
            "command": "request create",
            "provider": selection.resolved,
            "provider_selection": selection.payload(),
            "request": {
                "operation": args.request_operation.as_str(),
                "body_file": args.body_file,
                "model": body.get("model"),
            },
            "response": {
                "created": payload.get("created"),
                "background": payload.get("background"),
                "output_format": payload.get("output_format"),
                "quality": payload.get("quality"),
                "size": payload.get("size"),
                "usage": payload.get("usage").map(redact_event_payload).unwrap_or(Value::Null),
                "revised_prompts": revised_prompts.into_iter().flatten().collect::<Vec<_>>(),
            },
            "image_output": image_output,
            "history": {
                "job_id": history_job_id,
            },
            "retry": {
                "count": retry_count,
                "max_retries": DEFAULT_RETRY_COUNT,
            },
            "auth": {
                "source": auth_state.source,
                "env_var": OPENAI_API_KEY_ENV,
                "refreshed": false,
            },
            "events": {
                "count": logger.seq,
            }
        }),
        exit_status: 0,
    })
}

fn run_request_create(cli: &Cli, args: &RequestCreateArgs) -> Result<CommandOutcome, AppError> {
    let selection = select_request_provider(cli, args)?;
    if matches!(selection.kind, ProviderKind::OpenAi) {
        run_request_create_openai(cli, &selection, args)
    } else {
        run_request_create_codex(cli, &selection, args)
    }
}

fn dispatch(cli: &Cli) -> Result<CommandOutcome, AppError> {
    match &cli.command {
        Commands::Doctor => Ok(run_doctor(cli)),
        Commands::Auth(command) => match command.auth_command {
            AuthSubcommand::Inspect => run_auth_inspect(cli),
        },
        Commands::Config(command) => run_config_command(cli, command),
        Commands::Secret(command) => run_secret_command(cli, command),
        Commands::History(command) => run_history_command(cli, command),
        Commands::Models(command) => match command.models_command {
            ModelsSubcommand::List => Ok(run_models_list()),
        },
        Commands::Images(command) => run_images_command(cli, &command.images_command),
        Commands::Transparent(command) => transparent::run_transparent_command(cli, command),
        Commands::Request(command) => match &command.request_command {
            RequestSubcommand::Create(args) => run_request_create(cli, args),
        },
    }
}

pub fn run(argv: &[String]) -> i32 {
    let outcome = run_json(argv);
    emit_json(&outcome.payload);
    outcome.exit_status
}

pub fn run_json(argv: &[String]) -> CommandOutcome {
    match Cli::try_parse_from(argv) {
        Ok(cli) => match dispatch(&cli) {
            Ok(outcome) => outcome,
            Err(error) => {
                let (payload, exit_status) = build_error_payload(error);
                CommandOutcome {
                    payload,
                    exit_status,
                }
            }
        },
        Err(error) => {
            let app_error = AppError::new("invalid_command", error.to_string()).with_exit_status(2);
            let (payload, exit_status) = build_error_payload(app_error);
            CommandOutcome {
                payload,
                exit_status,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static CODEX_HOME_TEST_LOCK: Mutex<()> = Mutex::new(());

    struct TestCodexHome {
        previous: Option<std::ffi::OsString>,
    }

    impl TestCodexHome {
        fn set(path: &Path) -> Self {
            let previous = std::env::var_os("CODEX_HOME");
            unsafe {
                std::env::set_var("CODEX_HOME", path);
            }
            Self { previous }
        }
    }

    impl Drop for TestCodexHome {
        fn drop(&mut self) {
            unsafe {
                if let Some(previous) = &self.previous {
                    std::env::set_var("CODEX_HOME", previous);
                } else {
                    std::env::remove_var("CODEX_HOME");
                }
            }
        }
    }

    #[test]
    fn parse_image_size_accepts_aliases() {
        assert_eq!(parse_image_size("2K").unwrap(), "2048x2048");
        assert_eq!(parse_image_size("4k").unwrap(), "3840x2160");
    }

    #[test]
    fn parse_image_size_accepts_valid_dimensions() {
        assert_eq!(parse_image_size("1024x640").unwrap(), "1024x640");
        assert_eq!(parse_image_size("2880x2880").unwrap(), "2880x2880");
        assert_eq!(parse_image_size("2160x3840").unwrap(), "2160x3840");
    }

    #[test]
    fn parse_image_size_rejects_oversized_square() {
        assert!(parse_image_size("4096x4096").is_err());
    }

    #[test]
    fn parse_image_size_rejects_too_few_pixels() {
        assert!(parse_image_size("512x512").is_err());
    }

    #[test]
    fn build_openai_image_body_for_edit_includes_mask_and_images() {
        let body = build_openai_image_body(
            "edit",
            "edit this image",
            "gpt-image-2",
            &["data:image/png;base64,AAAA".to_string()],
            Some("data:image/png;base64,BBBB"),
            Some(InputFidelity::High),
            Background::Auto,
            Some("1024x1024"),
            Some(Quality::High),
            Some(OutputFormat::Png),
            None,
            Some(1),
            Some(Moderation::Auto),
        );
        assert_eq!(body["images"][0]["image_url"], "data:image/png;base64,AAAA");
        assert_eq!(body["mask"]["image_url"], "data:image/png;base64,BBBB");
        assert_eq!(body["input_fidelity"], "high");
        assert_eq!(body["model"], "gpt-image-2");
    }

    #[test]
    fn build_openai_edit_form_contains_required_parts() {
        let body = json!({
            "model": "gpt-image-2",
            "prompt": "Edit this image",
            "images": [{"image_url": "data:image/png;base64,YWJjZA=="}],
            "mask": {"image_url": "data:image/png;base64,YWJjZA=="},
            "size": "1024x1024",
        });
        assert!(build_openai_edit_form(&body).is_ok());
    }

    #[test]
    fn app_config_round_trips_with_file_secret() {
        let temp_dir = tempfile::tempdir().unwrap();
        let config_path = temp_dir.path().join("config.json");
        let mut config = AppConfig {
            default_provider: Some("local".to_string()),
            ..Default::default()
        };
        config.providers.insert(
            "local".to_string(),
            ProviderConfig {
                provider_type: "openai-compatible".to_string(),
                api_base: Some("https://example.com/v1".to_string()),
                endpoint: None,
                model: Some(DEFAULT_OPENAI_MODEL.to_string()),
                credentials: BTreeMap::from([(
                    "api_key".to_string(),
                    CredentialRef::File {
                        value: "sk-test".to_string(),
                    },
                )]),
                supports_n: Some(false),
                edit_region_mode: Some(EDIT_REGION_REFERENCE_HINT.to_string()),
            },
        );
        save_app_config(&config_path, &config).unwrap();
        let loaded = load_app_config(&config_path).unwrap();
        assert_eq!(loaded.default_provider.as_deref(), Some("local"));
        assert_eq!(
            redact_app_config(&loaded)["providers"]["local"]["credentials"]["api_key"]["value"]["_omitted"],
            "secret"
        );
    }

    #[test]
    fn configured_openai_provider_resolves_with_file_secret() {
        let provider = ProviderConfig {
            provider_type: "openai-compatible".to_string(),
            api_base: Some("https://example.com/v1".to_string()),
            endpoint: None,
            model: None,
            credentials: BTreeMap::from([(
                "api_key".to_string(),
                CredentialRef::File {
                    value: "sk-test".to_string(),
                },
            )]),
            supports_n: Some(true),
            edit_region_mode: None,
        };
        let selection = configured_provider_selection("local", &provider, "test", None).unwrap();
        assert_eq!(selection.resolved, "local");
        assert_eq!(selection.api_base, "https://example.com/v1");
        assert!(matches!(selection.kind, ProviderKind::OpenAi));
        assert_eq!(selection.edit_region_mode, EDIT_REGION_REFERENCE_HINT);
    }

    #[test]
    fn explicit_builtin_name_uses_configured_provider_when_present() {
        let temp_dir = tempfile::tempdir().unwrap();
        let config_path = temp_dir.path().join("config.json");
        let mut config = AppConfig::default();
        config.providers.insert(
            "openai".to_string(),
            ProviderConfig {
                provider_type: "openai-compatible".to_string(),
                api_base: Some("https://example.com/v1".to_string()),
                endpoint: None,
                model: Some("gpt-image-2".to_string()),
                credentials: BTreeMap::from([(
                    "api_key".to_string(),
                    CredentialRef::File {
                        value: "sk-test".to_string(),
                    },
                )]),
                supports_n: Some(false),
                edit_region_mode: Some(EDIT_REGION_REFERENCE_HINT.to_string()),
            },
        );
        save_app_config(&config_path, &config).unwrap();

        let cli = Cli {
            json: true,
            provider: "openai".to_string(),
            api_key: None,
            config: Some(config_path.display().to_string()),
            auth_file: default_auth_path().display().to_string(),
            endpoint: DEFAULT_CODEX_ENDPOINT.to_string(),
            openai_api_base: DEFAULT_OPENAI_API_BASE.to_string(),
            json_events: false,
            command: Commands::Doctor,
        };
        let selection = select_image_provider(&cli).unwrap();

        assert_eq!(selection.resolved, "openai");
        assert_eq!(selection.reason, "explicit_config_provider");
        assert_eq!(selection.api_base, "https://example.com/v1");
        assert!(!selection.supports_n);
    }

    #[test]
    fn configured_openai_name_loads_config_secret_for_image_auth() {
        let temp_dir = tempfile::tempdir().unwrap();
        let config_path = temp_dir.path().join("config.json");
        let mut config = AppConfig::default();
        config.providers.insert(
            "openai".to_string(),
            ProviderConfig {
                provider_type: "openai-compatible".to_string(),
                api_base: Some("https://example.com/v1".to_string()),
                endpoint: None,
                model: Some("gpt-image-2".to_string()),
                credentials: BTreeMap::from([(
                    "api_key".to_string(),
                    CredentialRef::File {
                        value: "sk-test".to_string(),
                    },
                )]),
                supports_n: Some(false),
                edit_region_mode: Some(EDIT_REGION_REFERENCE_HINT.to_string()),
            },
        );
        save_app_config(&config_path, &config).unwrap();

        let cli = Cli {
            json: true,
            provider: "openai".to_string(),
            api_key: None,
            config: Some(config_path.display().to_string()),
            auth_file: default_auth_path().display().to_string(),
            endpoint: DEFAULT_CODEX_ENDPOINT.to_string(),
            openai_api_base: DEFAULT_OPENAI_API_BASE.to_string(),
            json_events: false,
            command: Commands::Doctor,
        };
        let selection = select_image_provider(&cli).unwrap();
        let auth = load_openai_auth_state_for(&cli, &selection).unwrap();

        assert_eq!(auth.api_key, "sk-test");
        assert_eq!(auth.source, "file");
    }

    #[test]
    fn notification_config_redacts_webhook_headers_and_email_password() {
        let config = AppConfig {
            notifications: NotificationConfig {
                enabled: false,
                email: EmailNotificationConfig {
                    enabled: true,
                    smtp_host: "smtp.example.com".to_string(),
                    smtp_port: 465,
                    tls: EmailTlsMode::Smtps,
                    username: Some("robot@example.com".to_string()),
                    password: Some(CredentialRef::File {
                        value: "smtp-secret".to_string(),
                    }),
                    from: "robot@example.com".to_string(),
                    to: vec!["owner@example.com".to_string()],
                    timeout_seconds: 5,
                },
                webhooks: vec![WebhookNotificationConfig {
                    id: "ops".to_string(),
                    name: "Ops".to_string(),
                    enabled: true,
                    url: "https://hooks.example.com/task".to_string(),
                    method: "POST".to_string(),
                    headers: BTreeMap::from([(
                        "Authorization".to_string(),
                        CredentialRef::File {
                            value: "Bearer secret".to_string(),
                        },
                    )]),
                    timeout_seconds: 5,
                }],
                ..Default::default()
            },
            ..Default::default()
        };

        let redacted = redact_app_config(&config);

        assert_eq!(
            redacted["notifications"]["email"]["password"]["value"]["_omitted"],
            "secret"
        );
        assert_eq!(
            redacted["notifications"]["webhooks"][0]["headers"]["Authorization"]["value"]["_omitted"],
            "secret"
        );
        assert_eq!(redacted["notifications"]["enabled"], false);
    }

    #[test]
    fn storage_config_defaults_to_local_fallback_target() {
        let _guard = CODEX_HOME_TEST_LOCK.lock().unwrap();
        let temp_dir = tempfile::tempdir().unwrap();
        let _home = TestCodexHome::set(temp_dir.path());
        let config = AppConfig::default();

        assert_eq!(config.storage.fallback_targets, vec!["local-default"]);
        assert_eq!(
            config.storage.fallback_policy,
            StorageFallbackPolicy::OnFailure
        );
        assert_eq!(config.storage.upload_concurrency, 4);
        assert_eq!(config.storage.target_concurrency, 2);
        assert!(matches!(
            config.storage.targets.get("local-default"),
            Some(StorageTargetConfig::Local { directory, public_base_url: None }) if directory == &shared_config_dir().join("storage").join("fallback")
        ));
    }

    fn s3_test_target(
        access_key_id: Option<CredentialRef>,
        secret_access_key: Option<CredentialRef>,
    ) -> StorageTargetConfig {
        StorageTargetConfig::S3 {
            bucket: "images".to_string(),
            region: Some("us-east-1".to_string()),
            endpoint: Some("http://127.0.0.1:9000".to_string()),
            prefix: None,
            access_key_id,
            secret_access_key,
            session_token: None,
            public_base_url: None,
        }
    }

    #[test]
    fn s3_storage_test_requires_access_key() {
        let target = s3_test_target(
            None,
            Some(CredentialRef::File {
                value: "secret".to_string(),
            }),
        );

        let result = test_storage_target("s3", &target);

        assert!(!result.ok);
        assert_eq!(result.detail.unwrap()["access_key_ready"], false);
    }

    #[test]
    fn s3_storage_test_requires_secret_key() {
        let target = s3_test_target(
            Some(CredentialRef::File {
                value: "access".to_string(),
            }),
            None,
        );

        let result = test_storage_target("s3", &target);

        assert!(!result.ok);
        assert_eq!(result.detail.unwrap()["secret_key_ready"], false);
    }

    #[test]
    fn s3_storage_test_rejects_empty_file_credentials() {
        let target = s3_test_target(
            Some(CredentialRef::File {
                value: String::new(),
            }),
            Some(CredentialRef::File {
                value: "secret".to_string(),
            }),
        );

        let result = test_storage_target("s3", &target);

        assert!(!result.ok);
        assert_eq!(result.detail.unwrap()["access_key_ready"], false);
    }

    #[test]
    fn s3_storage_test_rejects_missing_env_credentials() {
        unsafe {
            std::env::remove_var("GPT_IMAGE_2_MISSING_S3_ACCESS_KEY");
        }
        let target = s3_test_target(
            Some(CredentialRef::Env {
                env: "GPT_IMAGE_2_MISSING_S3_ACCESS_KEY".to_string(),
            }),
            Some(CredentialRef::File {
                value: "secret".to_string(),
            }),
        );

        let result = test_storage_target("s3", &target);

        assert!(!result.ok);
        assert_eq!(result.detail.unwrap()["access_key_ready"], false);
    }

    #[test]
    fn product_paths_default_by_runtime() {
        let config = AppConfig::default();

        assert!(
            product_app_data_dir(Some(&config), ProductRuntime::Tauri)
                .ends_with("com.wangnov.gpt-image-2")
        );
        assert!(
            product_result_library_dir(Some(&config), ProductRuntime::Tauri)
                .ends_with(JOBS_DIR_NAME)
        );
        assert_eq!(
            product_app_data_dir(Some(&config), ProductRuntime::DockerWeb),
            PathBuf::from("/data").join(PRODUCT_DIR_NAME)
        );
        assert_eq!(
            product_result_library_dir(Some(&config), ProductRuntime::DockerWeb),
            PathBuf::from("/data")
                .join(PRODUCT_DIR_NAME)
                .join(JOBS_DIR_NAME)
        );
    }

    #[test]
    fn storage_config_redacts_target_credentials() {
        let config = AppConfig {
            storage: StorageConfig {
                targets: BTreeMap::from([
                    (
                        "s3".to_string(),
                        StorageTargetConfig::S3 {
                            bucket: "images".to_string(),
                            region: Some("us-east-1".to_string()),
                            endpoint: Some("https://s3.example.com".to_string()),
                            prefix: Some("out/".to_string()),
                            access_key_id: Some(CredentialRef::File {
                                value: "ak".to_string(),
                            }),
                            secret_access_key: Some(CredentialRef::File {
                                value: "sk".to_string(),
                            }),
                            session_token: Some(CredentialRef::File {
                                value: "token".to_string(),
                            }),
                            public_base_url: Some("https://cdn.example.com".to_string()),
                        },
                    ),
                    (
                        "webdav".to_string(),
                        StorageTargetConfig::WebDav {
                            url: "https://dav.example.com/out".to_string(),
                            username: Some("robot".to_string()),
                            password: Some(CredentialRef::File {
                                value: "dav-secret".to_string(),
                            }),
                            public_base_url: None,
                        },
                    ),
                    (
                        "http".to_string(),
                        StorageTargetConfig::Http {
                            url: "https://upload.example.com/out".to_string(),
                            method: "POST".to_string(),
                            headers: BTreeMap::from([(
                                "Authorization".to_string(),
                                CredentialRef::File {
                                    value: "Bearer secret".to_string(),
                                },
                            )]),
                            public_url_json_pointer: Some("/url".to_string()),
                        },
                    ),
                    (
                        "sftp".to_string(),
                        StorageTargetConfig::Sftp {
                            host: "sftp.example.com".to_string(),
                            port: 22,
                            host_key_sha256: Some("SHA256:abc".to_string()),
                            username: "robot".to_string(),
                            password: Some(CredentialRef::File {
                                value: "sftp-password".to_string(),
                            }),
                            private_key: Some(CredentialRef::File {
                                value: "sftp-key".to_string(),
                            }),
                            remote_dir: "/out".to_string(),
                            public_base_url: None,
                        },
                    ),
                ]),
                ..Default::default()
            },
            ..Default::default()
        };

        let redacted = redact_app_config(&config);

        assert_eq!(
            redacted["storage"]["targets"]["s3"]["access_key_id"]["value"]["_omitted"],
            "secret"
        );
        assert_eq!(
            redacted["storage"]["targets"]["s3"]["secret_access_key"]["value"]["_omitted"],
            "secret"
        );
        assert_eq!(
            redacted["storage"]["targets"]["s3"]["session_token"]["value"]["_omitted"],
            "secret"
        );
        assert_eq!(
            redacted["storage"]["targets"]["webdav"]["password"]["value"]["_omitted"],
            "secret"
        );
        assert_eq!(
            redacted["storage"]["targets"]["http"]["headers"]["Authorization"]["value"]["_omitted"],
            "secret"
        );
        assert_eq!(
            redacted["storage"]["targets"]["sftp"]["password"]["value"]["_omitted"],
            "secret"
        );
        assert_eq!(
            redacted["storage"]["targets"]["sftp"]["private_key"]["value"]["_omitted"],
            "secret"
        );
        assert_eq!(
            redacted["storage"]["targets"]["sftp"]["host_key_sha256"],
            "SHA256:abc"
        );
    }

    #[test]
    fn storage_secret_preservation_requires_same_target_identity() {
        let existing = StorageConfig {
            targets: BTreeMap::from([(
                "s3-main".to_string(),
                StorageTargetConfig::S3 {
                    bucket: "images".to_string(),
                    region: Some("us-east-1".to_string()),
                    endpoint: Some("https://s3.example.com".to_string()),
                    prefix: Some("out".to_string()),
                    access_key_id: Some(CredentialRef::File {
                        value: "ak".to_string(),
                    }),
                    secret_access_key: Some(CredentialRef::File {
                        value: "sk".to_string(),
                    }),
                    session_token: None,
                    public_base_url: None,
                },
            )]),
            ..StorageConfig::default()
        };
        let mut same_target = StorageConfig {
            targets: BTreeMap::from([(
                "s3-main".to_string(),
                StorageTargetConfig::S3 {
                    bucket: "images".to_string(),
                    region: Some("us-east-1".to_string()),
                    endpoint: Some("https://s3.example.com".to_string()),
                    prefix: Some("out".to_string()),
                    access_key_id: Some(CredentialRef::File {
                        value: String::new(),
                    }),
                    secret_access_key: Some(CredentialRef::File {
                        value: String::new(),
                    }),
                    session_token: None,
                    public_base_url: None,
                },
            )]),
            ..StorageConfig::default()
        };
        preserve_storage_secrets(&mut same_target, &existing);
        let StorageTargetConfig::S3 {
            access_key_id,
            secret_access_key,
            ..
        } = same_target.targets.get("s3-main").unwrap()
        else {
            panic!("expected s3 target");
        };
        assert_eq!(
            access_key_id,
            &Some(CredentialRef::File {
                value: "ak".to_string()
            })
        );
        assert_eq!(
            secret_access_key,
            &Some(CredentialRef::File {
                value: "sk".to_string()
            })
        );

        let mut changed_target = StorageConfig {
            targets: BTreeMap::from([(
                "s3-main".to_string(),
                StorageTargetConfig::S3 {
                    bucket: "other-images".to_string(),
                    region: Some("us-east-1".to_string()),
                    endpoint: Some("https://s3.example.com".to_string()),
                    prefix: Some("out".to_string()),
                    access_key_id: Some(CredentialRef::File {
                        value: String::new(),
                    }),
                    secret_access_key: Some(CredentialRef::File {
                        value: String::new(),
                    }),
                    session_token: None,
                    public_base_url: None,
                },
            )]),
            ..StorageConfig::default()
        };
        preserve_storage_secrets(&mut changed_target, &existing);
        let StorageTargetConfig::S3 {
            access_key_id,
            secret_access_key,
            ..
        } = changed_target.targets.get("s3-main").unwrap()
        else {
            panic!("expected s3 target");
        };
        assert_eq!(
            access_key_id,
            &Some(CredentialRef::File {
                value: String::new()
            })
        );
        assert_eq!(
            secret_access_key,
            &Some(CredentialRef::File {
                value: String::new()
            })
        );
    }

    #[test]
    fn storage_secret_preservation_survives_target_rename() {
        let existing = StorageConfig {
            targets: BTreeMap::from([(
                "s3-main".to_string(),
                StorageTargetConfig::S3 {
                    bucket: "images".to_string(),
                    region: Some("us-east-1".to_string()),
                    endpoint: Some("https://s3.example.com".to_string()),
                    prefix: Some("out".to_string()),
                    access_key_id: Some(CredentialRef::File {
                        value: "ak".to_string(),
                    }),
                    secret_access_key: Some(CredentialRef::File {
                        value: "sk".to_string(),
                    }),
                    session_token: None,
                    public_base_url: None,
                },
            )]),
            ..StorageConfig::default()
        };
        let mut renamed_target = StorageConfig {
            targets: BTreeMap::from([(
                "s3-archive".to_string(),
                StorageTargetConfig::S3 {
                    bucket: "images".to_string(),
                    region: Some("us-east-1".to_string()),
                    endpoint: Some("https://s3.example.com".to_string()),
                    prefix: Some("out".to_string()),
                    access_key_id: Some(CredentialRef::File {
                        value: String::new(),
                    }),
                    secret_access_key: Some(CredentialRef::File {
                        value: String::new(),
                    }),
                    session_token: None,
                    public_base_url: None,
                },
            )]),
            ..StorageConfig::default()
        };

        preserve_storage_secrets(&mut renamed_target, &existing);

        let StorageTargetConfig::S3 {
            access_key_id,
            secret_access_key,
            ..
        } = renamed_target.targets.get("s3-archive").unwrap()
        else {
            panic!("expected s3 target");
        };
        assert_eq!(
            access_key_id,
            &Some(CredentialRef::File {
                value: "ak".to_string()
            })
        );
        assert_eq!(
            secret_access_key,
            &Some(CredentialRef::File {
                value: "sk".to_string()
            })
        );
    }

    #[test]
    fn storage_remote_guard_blocks_internal_addresses() {
        let err = validate_remote_http_target("http://127.0.0.1/upload", "HTTP storage")
            .err()
            .unwrap_or_else(|| panic!("expected storage target to be rejected"));
        assert_eq!(err.code, "storage_remote_blocked");

        let err = validate_remote_tcp_target("127.0.0.1", 22, "SFTP storage")
            .err()
            .unwrap_or_else(|| panic!("expected storage tcp target to be rejected"));
        assert_eq!(err.code, "storage_remote_blocked");
    }

    #[test]
    fn sftp_host_key_fingerprint_accepts_sha256_prefix() {
        assert!(sftp_host_key_matches(
            "SHA256:YWJjZA",
            "deadbeef",
            "YWJjZA=="
        ));
        assert!(sftp_host_key_matches("deadbeef", "DEADBEEF", "ignored"));
        assert!(!sftp_host_key_matches(
            "SHA256:other",
            "deadbeef",
            "YWJjZA=="
        ));
    }

    #[test]
    fn history_upload_records_enrich_history_job_outputs() {
        let _guard = CODEX_HOME_TEST_LOCK.lock().unwrap();
        let temp_dir = tempfile::tempdir().unwrap();
        let _home = TestCodexHome::set(temp_dir.path());

        upsert_history_job(
            "job-storage-1",
            "images generate",
            "openai",
            "completed",
            None,
            Some("2026-05-08T10:00:00Z"),
            json!({
                "output": {
                    "files": [
                        {"index": 0, "path": "/tmp/out-0.png", "bytes": 10},
                        {"index": 1, "path": "/tmp/out-1.png", "bytes": 12}
                    ]
                }
            }),
        )
        .unwrap();

        upsert_output_upload_record(&OutputUploadRecord {
            job_id: "job-storage-1".to_string(),
            output_index: 0,
            target: "s3-main".to_string(),
            target_type: "s3".to_string(),
            status: "completed".to_string(),
            url: Some("https://cdn.example.com/out-0.png".to_string()),
            error: None,
            bytes: Some(10),
            attempts: 1,
            updated_at: "2026-05-08T10:01:00Z".to_string(),
            metadata: json!({"etag": "abc"}),
        })
        .unwrap();
        upsert_output_upload_record(&OutputUploadRecord {
            job_id: "job-storage-1".to_string(),
            output_index: 1,
            target: "s3-main".to_string(),
            target_type: "s3".to_string(),
            status: "failed".to_string(),
            url: None,
            error: Some("boom".to_string()),
            bytes: None,
            attempts: 2,
            updated_at: "2026-05-08T10:02:00Z".to_string(),
            metadata: Value::Null,
        })
        .unwrap();

        let uploads = list_output_upload_records("job-storage-1").unwrap();
        assert_eq!(uploads.len(), 2);

        let job = show_history_job("job-storage-1").unwrap();
        assert_eq!(job["storage_status"], "partial_failed");
        assert_eq!(job["outputs"][0]["uploads"][0]["target"], "s3-main");
        assert_eq!(
            job["outputs"][0]["uploads"][0]["url"],
            "https://cdn.example.com/out-0.png"
        );
        assert_eq!(job["outputs"][1]["uploads"][0]["status"], "failed");
        assert_eq!(job["outputs"][1]["uploads"][0]["error"], "boom");
    }

    #[test]
    fn history_rows_without_upload_records_keep_legacy_outputs() {
        let _guard = CODEX_HOME_TEST_LOCK.lock().unwrap();
        let temp_dir = tempfile::tempdir().unwrap();
        let _home = TestCodexHome::set(temp_dir.path());

        upsert_history_job(
            "job-legacy-1",
            "images generate",
            "openai",
            "completed",
            None,
            Some("2026-05-08T11:00:00Z"),
            json!({
                "output": {
                    "files": [{"index": 0, "path": "/tmp/legacy.png", "bytes": 99}]
                }
            }),
        )
        .unwrap();

        let job = show_history_job("job-legacy-1").unwrap();

        assert_eq!(job["outputs"][0]["path"], "/tmp/legacy.png");
        assert_eq!(job["outputs"][0].get("uploads"), None);
        assert_eq!(job["storage_status"], "not_configured");
    }

    #[test]
    fn storage_upload_falls_back_to_local_target_after_primary_failure() {
        let _guard = CODEX_HOME_TEST_LOCK.lock().unwrap();
        let temp_dir = tempfile::tempdir().unwrap();
        let _home = TestCodexHome::set(temp_dir.path());
        let source_dir = temp_dir.path().join("source");
        fs::create_dir_all(&source_dir).unwrap();
        let output_path = source_dir.join("out.png");
        fs::write(&output_path, b"png").unwrap();
        let fallback_dir = temp_dir.path().join("fallback");
        let config = StorageConfig {
            targets: BTreeMap::from([
                (
                    "missing-primary".to_string(),
                    StorageTargetConfig::Local {
                        directory: temp_dir.path().join("missing-parent").join("missing-file"),
                        public_base_url: Some("https://primary.example.com".to_string()),
                    },
                ),
                (
                    "local-fallback".to_string(),
                    StorageTargetConfig::Local {
                        directory: fallback_dir.clone(),
                        public_base_url: Some("https://fallback.example.com/images".to_string()),
                    },
                ),
            ]),
            default_targets: vec!["missing-primary".to_string()],
            fallback_targets: vec!["local-fallback".to_string()],
            fallback_policy: StorageFallbackPolicy::OnFailure,
            upload_concurrency: 2,
            target_concurrency: 2,
        };
        let job = json!({
            "id": "job-fallback-1",
            "outputs": [{"index": 0, "path": output_path.display().to_string(), "bytes": 3}],
        });
        upsert_history_job(
            "job-fallback-1",
            "images generate",
            "openai",
            "completed",
            Some(&output_path),
            Some("2026-05-08T12:00:00Z"),
            json!({
                "output": {
                    "files": [{"index": 0, "path": output_path.display().to_string(), "bytes": 3}]
                }
            }),
        )
        .unwrap();

        fs::write(
            temp_dir.path().join("missing-parent").join("missing-file"),
            b"not-a-dir",
        )
        .unwrap_err();
        fs::create_dir_all(temp_dir.path().join("missing-parent")).unwrap();
        fs::write(
            temp_dir.path().join("missing-parent").join("missing-file"),
            b"x",
        )
        .unwrap();

        let uploads =
            upload_job_outputs_to_storage(&config, &job, StorageUploadOverrides::default())
                .unwrap();

        assert_eq!(uploads.len(), 2);
        assert!(
            uploads
                .iter()
                .any(|upload| { upload.target == "missing-primary" && upload.status == "failed" })
        );
        let fallback = uploads
            .iter()
            .find(|upload| upload.target == "local-fallback")
            .unwrap();
        assert_eq!(fallback.status, "completed");
        assert_eq!(
            fallback.url.as_deref(),
            Some("https://fallback.example.com/images/job-fallback-1/1-out.png")
        );
        assert!(
            fallback_dir
                .join("job-fallback-1")
                .join("1-out.png")
                .is_file()
        );
        assert_eq!(storage_status_for_uploads(&uploads), "fallback_completed");
    }

    #[test]
    fn s3_endpoint_builder_supports_aws_and_compatible_styles() {
        let (url, host, canonical_uri) =
            s3_endpoint_and_host("images", Some("us-west-2"), None, "jobs/1 out.png").unwrap();
        assert_eq!(
            url,
            "https://images.s3.us-west-2.amazonaws.com/jobs/1%20out.png"
        );
        assert_eq!(host, "images.s3.us-west-2.amazonaws.com");
        assert_eq!(canonical_uri, "/jobs/1%20out.png");

        let (url, host, canonical_uri) = s3_endpoint_and_host(
            "images",
            Some("us-east-1"),
            Some("https://s3.example.com"),
            "jobs/out.png",
        )
        .unwrap();
        assert_eq!(url, "https://s3.example.com/images/jobs/out.png");
        assert_eq!(host, "s3.example.com");
        assert_eq!(canonical_uri, "/images/jobs/out.png");

        let (url, host, _) = s3_endpoint_and_host(
            "images",
            Some("us-east-1"),
            Some("https://{bucket}.storage.example.com"),
            "jobs/out.png",
        )
        .unwrap();
        assert_eq!(url, "https://images.storage.example.com/jobs/out.png");
        assert_eq!(host, "images.storage.example.com");
    }

    #[test]
    fn webhook_notification_request_resolves_custom_headers() {
        let webhook = WebhookNotificationConfig {
            id: "ops".to_string(),
            name: "Ops".to_string(),
            enabled: true,
            url: "https://hooks.example.com/task".to_string(),
            method: "POST".to_string(),
            headers: BTreeMap::from([(
                "Authorization".to_string(),
                CredentialRef::File {
                    value: "Bearer secret".to_string(),
                },
            )]),
            timeout_seconds: 5,
        };
        let job = NotificationJob::from_job_value(&json!({
            "id": "job-1",
            "command": "images generate",
            "provider": "openai",
            "status": "completed",
            "created_at": "2026-05-08T10:00:00Z",
            "updated_at": "2026-05-08T10:01:00Z",
            "output_path": "/tmp/out.png",
            "outputs": [{"index": 0, "path": "/tmp/out.png", "bytes": 12}],
            "metadata": {"prompt": "hello"}
        }));

        let request = build_webhook_request(&webhook, &job).unwrap();

        assert_eq!(request.method, "POST");
        assert_eq!(request.url, "https://hooks.example.com/task");
        assert_eq!(
            request.headers.get("Authorization").map(String::as_str),
            Some("Bearer secret")
        );
        assert_eq!(request.body["event"], "job.completed");
        assert_eq!(request.body["job"]["id"], "job-1");
    }

    #[test]
    fn email_notification_message_resolves_password_and_recipients() {
        let email = EmailNotificationConfig {
            enabled: true,
            smtp_host: "smtp.example.com".to_string(),
            smtp_port: 587,
            tls: EmailTlsMode::StartTls,
            username: Some("robot".to_string()),
            password: Some(CredentialRef::File {
                value: "smtp-secret".to_string(),
            }),
            from: "GPT Image 2 <robot@example.com>".to_string(),
            to: vec![
                "Owner <owner@example.com>".to_string(),
                "ops@example.com".to_string(),
            ],
            timeout_seconds: 5,
        };
        let job = NotificationJob::from_job_value(&json!({
            "id": "job-1",
            "command": "images edit",
            "provider": "openai",
            "status": "failed",
            "created_at": "2026-05-08T10:00:00Z",
            "updated_at": "2026-05-08T10:01:00Z",
            "metadata": {"prompt": "hello"},
            "error": {"message": "boom"}
        }));

        let message = build_email_notification_message(&email, &job).unwrap();

        assert_eq!(message.smtp_host, "smtp.example.com");
        assert_eq!(message.smtp_port, 587);
        assert_eq!(message.username.as_deref(), Some("robot"));
        assert_eq!(message.password.as_deref(), Some("smtp-secret"));
        assert_eq!(message.to.len(), 2);
        assert!(message.subject.contains("编辑失败"));
        assert!(message.body.contains("boom"));
    }

    #[test]
    fn notification_secret_preservation_keeps_empty_file_values() {
        let existing = NotificationConfig {
            email: EmailNotificationConfig {
                password: Some(CredentialRef::File {
                    value: "smtp-secret".to_string(),
                }),
                ..Default::default()
            },
            webhooks: vec![WebhookNotificationConfig {
                id: "ops".to_string(),
                name: "Ops".to_string(),
                enabled: true,
                url: "https://hooks.example.com/task".to_string(),
                method: "POST".to_string(),
                headers: BTreeMap::from([(
                    "Authorization".to_string(),
                    CredentialRef::File {
                        value: "Bearer secret".to_string(),
                    },
                )]),
                timeout_seconds: 10,
            }],
            ..Default::default()
        };
        let mut next = NotificationConfig {
            email: EmailNotificationConfig {
                password: Some(CredentialRef::File {
                    value: String::new(),
                }),
                ..Default::default()
            },
            webhooks: vec![WebhookNotificationConfig {
                id: "ops".to_string(),
                name: "Ops".to_string(),
                enabled: true,
                url: "https://hooks.example.com/task".to_string(),
                method: "POST".to_string(),
                headers: BTreeMap::from([(
                    "Authorization".to_string(),
                    CredentialRef::File {
                        value: String::new(),
                    },
                )]),
                timeout_seconds: 10,
            }],
            ..Default::default()
        };

        preserve_notification_secrets(&mut next, &existing);

        assert_eq!(
            next.email.password,
            Some(CredentialRef::File {
                value: "smtp-secret".to_string()
            })
        );
        assert_eq!(
            next.webhooks[0].headers.get("Authorization"),
            Some(&CredentialRef::File {
                value: "Bearer secret".to_string()
            })
        );
    }

    #[test]
    fn webhook_ssrf_guard_blocks_internal_addresses() {
        for url in [
            "http://127.0.0.1/hook",
            "http://localhost/hook",
            "http://10.0.0.1/hook",
            "http://172.16.5.5/hook",
            "http://192.168.1.1/hook",
            "http://169.254.169.254/latest/meta-data/", // AWS metadata
            "http://0.0.0.0/hook",
            "http://255.255.255.255/hook",
            "http://[::1]/hook",
            "http://[::ffff:127.0.0.1]/hook",
            "http://[fc00::1]/hook",
            "http://[fe80::1]/hook",
        ] {
            let err = validate_webhook_target(url).err().unwrap_or_else(|| {
                panic!("expected {url} to be rejected as internal");
            });
            assert_eq!(
                err.code, "notification_webhook_blocked",
                "url {url} produced unexpected error code {}",
                err.code
            );
        }
    }

    #[test]
    fn webhook_ssrf_guard_rejects_non_http_schemes() {
        let err = validate_webhook_target("ftp://example.com/hook")
            .err()
            .expect("non-http scheme should be rejected");
        assert_eq!(err.code, "notification_webhook_invalid");
    }

    #[test]
    fn webhook_ssrf_guard_rejects_malformed_urls() {
        let err = validate_webhook_target("not a url")
            .err()
            .expect("malformed url should be rejected");
        assert_eq!(err.code, "notification_webhook_invalid");
    }

    #[test]
    fn ip_is_internal_classifies_addresses() {
        assert!(ip_is_internal("127.0.0.1".parse().unwrap()));
        assert!(ip_is_internal("10.0.0.1".parse().unwrap()));
        assert!(ip_is_internal("172.16.5.5".parse().unwrap()));
        assert!(ip_is_internal("192.168.1.1".parse().unwrap()));
        assert!(ip_is_internal("169.254.169.254".parse().unwrap()));
        assert!(ip_is_internal("0.0.0.0".parse().unwrap()));
        assert!(ip_is_internal("224.0.0.1".parse().unwrap()));
        assert!(ip_is_internal("::1".parse().unwrap()));
        assert!(ip_is_internal("fc00::1".parse().unwrap()));
        assert!(ip_is_internal("fe80::1".parse().unwrap()));

        assert!(!ip_is_internal("8.8.8.8".parse().unwrap()));
        assert!(!ip_is_internal("1.1.1.1".parse().unwrap()));
        assert!(!ip_is_internal("2606:4700:4700::1111".parse().unwrap()));
    }

    #[test]
    fn canonicalize_ip_unmaps_ipv4_in_ipv6() {
        let mapped: IpAddr = "::ffff:127.0.0.1".parse().unwrap();
        match canonicalize_ip(mapped) {
            IpAddr::V4(v4) => assert_eq!(v4, Ipv4Addr::new(127, 0, 0, 1)),
            other => panic!("expected ipv4 unmapping, got {other:?}"),
        }
    }
}
