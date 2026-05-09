use serde_json::Value;

use super::email::send_email_notification;
use super::job::{NotificationJob, normalize_notification_status};
use super::types::{NotificationConfig, NotificationDelivery};
use super::webhook::send_webhook_notification;

pub fn notification_status_allowed(config: &NotificationConfig, status: &str) -> bool {
    match normalize_notification_status(status).as_str() {
        "completed" => config.on_completed,
        "failed" => config.on_failed,
        "cancelled" => config.on_cancelled,
        _ => false,
    }
}

pub fn dispatch_task_notifications(
    notification_config: &NotificationConfig,
    job_value: &Value,
) -> Vec<NotificationDelivery> {
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
