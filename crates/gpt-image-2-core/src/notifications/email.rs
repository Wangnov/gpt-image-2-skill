use std::time::Duration;

use lettre::message::{Mailbox, header::ContentType};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{Message, SmtpTransport, Transport};
use serde_json::json;

use crate::{AppError, resolve_credential};

use super::job::NotificationJob;
use super::types::{
    EmailNotificationConfig, EmailNotificationMessage, EmailTlsMode, NotificationDelivery,
};

pub(crate) fn send_email_notification(
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
