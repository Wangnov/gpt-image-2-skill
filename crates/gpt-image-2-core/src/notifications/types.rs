use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::CredentialRef;

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
