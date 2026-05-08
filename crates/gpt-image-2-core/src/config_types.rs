#![allow(unused_imports)]

use super::*;

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

pub(crate) fn default_system_notification_mode() -> String {
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

pub(crate) fn default_smtp_port() -> u16 {
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

pub(crate) fn default_webhook_method() -> String {
    "POST".to_string()
}

pub(crate) fn default_notification_timeout_seconds() -> u64 {
    10
}

pub(crate) fn default_true() -> bool {
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

pub(crate) fn preserve_empty_file_credential(
    next: &mut CredentialRef,
    existing: Option<&CredentialRef>,
) {
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
