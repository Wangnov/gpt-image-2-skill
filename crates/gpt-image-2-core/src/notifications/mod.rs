mod dispatch;
mod email;
mod job;
mod payload;
mod redaction;
pub(crate) mod secrets;
mod types;
mod webhook;

pub use dispatch::{dispatch_task_notifications, notification_status_allowed};
pub use email::build_email_notification_message;
pub use job::NotificationJob;
pub use secrets::preserve_notification_secrets;
pub use types::{
    EmailNotificationConfig, EmailNotificationMessage, EmailTlsMode, NotificationConfig,
    NotificationDelivery, SystemNotificationConfig, ToastNotificationConfig,
    WebhookNotificationConfig, WebhookRequest,
};
pub use webhook::build_webhook_request;

pub(crate) use redaction::redact_notification_config;
