#![allow(unused_imports)]

use super::*;

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

pub(crate) fn string_json_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(ToString::to_string)
}

pub(crate) fn normalize_notification_status(status: &str) -> String {
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

pub(crate) fn notification_payload(job: &NotificationJob) -> Value {
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

pub(crate) fn send_webhook_notification(
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

pub(crate) fn execute_webhook_request(request: &WebhookRequest) -> Result<String, AppError> {
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

pub(crate) fn send_email_message(message: &EmailNotificationMessage) -> Result<String, AppError> {
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
