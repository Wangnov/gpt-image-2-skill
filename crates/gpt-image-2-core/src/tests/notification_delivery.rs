use super::*;

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
