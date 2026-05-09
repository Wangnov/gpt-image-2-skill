use serde_json::{Map, Value, json};

use crate::{redact_credential_ref, redact_optional_credential};

use super::types::NotificationConfig;

pub(crate) fn redact_notification_config(config: &NotificationConfig) -> Value {
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
