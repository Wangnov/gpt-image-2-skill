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
        "metadata": {
            "prompt": "hello",
            "output": {
                "path": "/Users/alice/Pictures/gpt-image-2/job-1/out.png",
                "files": [{"index": 0, "path": "/Users/alice/Pictures/gpt-image-2/job-1/out.png"}]
            }
        }
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
fn webhook_payload_splits_origin_and_archive_uploads() {
    let webhook = WebhookNotificationConfig {
        id: "ops".to_string(),
        name: "Ops".to_string(),
        enabled: true,
        url: "https://hooks.example.com/task".to_string(),
        method: "POST".to_string(),
        headers: BTreeMap::new(),
        timeout_seconds: 5,
    };
    let job = NotificationJob::from_job_value(&json!({
        "id": "job-1",
        "command": "images generate",
        "provider": "openai",
        "status": "failed",
        "created_at": "2026-05-08T10:00:00Z",
        "updated_at": "2026-05-08T10:01:00Z",
        "output_path": "/tmp/out.png",
        "error": {
            "message": "Unable to read reference image at /Users/alice/Pictures/gpt-image-2/ref.png"
        },
        "outputs": [{
            "index": 0,
            "path": "/tmp/out.png",
            "bytes": 12,
            "error": "Unable to read output: {\"path\":\"/Users/alice/Pictures/gpt-image-2/job-1/out.png\"}",
            "uploads": [
                {
                    "target": "r2-origin",
                    "target_type": "s3",
                    "status": "completed",
                    "url": "https://cdn.example.com/job-1/out.png",
                    "error": null,
                    "bytes": 12,
                    "updated_at": "2026-05-08T10:01:00Z",
                    "metadata": {
                        "role": "primary",
                        "placement": "origin",
                        "detail": {"key": "job-1/out.png", "path": "/mnt/r2/job-1/out.png"},
                        "manifest": {
                            "role": "primary",
                            "placement": "origin",
                            "key": "job-1/out.png",
                            "mime": "image/png",
                            "sha256": "abc123",
                            "source_path": "/Users/alice/Pictures/gpt-image-2/job-1/out.png",
                            "local_cache_path": "/Users/alice/Pictures/gpt-image-2/job-1/out.png",
                            "path": "/mnt/r2/job-1/out.png",
                            "remote_path": "/internal/remote/job-1/out.png"
                        }
                    }
                },
                {
                    "target": "audit-webhook",
                    "target_type": "http",
                    "status": "completed",
                    "metadata": {"role": "primary", "placement": "archive"}
                },
                {
                    "target": "local-archive",
                    "target_type": "local",
                    "status": "failed",
                    "error": "Unable to copy output to local storage: {\"source\":\"/Users/alice/Pictures/gpt-image-2/job-1/out.png\",\"destination\":\"/mnt/private/out.png\"}",
                    "metadata": {"role": "fallback", "placement": "archive"}
                }
            ]
        }],
        "metadata": {
            "prompt": "hello",
            "error": {
                "message": "Unable to read reference image at /Users/alice/Pictures/gpt-image-2/metadata-ref.png"
            },
            "image_output": {
                "files": [{
                    "path": "/Users/alice/Pictures/gpt-image-2/legacy/out.png"
                }]
            }
        }
    }));

    let request = build_webhook_request(&webhook, &job).unwrap();

    assert_eq!(
        request.body["job"]["storage"]["origin"][0]["target"],
        "r2-origin"
    );
    assert_eq!(
        request.body["job"]["storage"]["archives"][0]["target"],
        "audit-webhook"
    );
    let failed_archive = &request.body["job"]["storage"]["archives"][1];
    assert_eq!(failed_archive["target"], "local-archive");
    assert_eq!(failed_archive["error"], "Storage upload failed.");
    let origin = &request.body["job"]["storage"]["origin"][0];
    assert_eq!(origin["output_index"], 0);
    assert_eq!(origin["role"], "primary");
    assert_eq!(origin["placement"], "origin");
    assert_eq!(origin["key"], "job-1/out.png");
    assert_eq!(origin["mime"], "image/png");
    assert_eq!(origin["sha256"], "abc123");
    assert_eq!(origin["url"], "https://cdn.example.com/job-1/out.png");
    assert!(origin["error"].is_null());
    assert!(origin["metadata"].is_null());
    assert!(origin["source_path"].is_null());
    assert!(origin["local_cache_path"].is_null());
    assert!(origin["path"].is_null());
    assert!(origin["remote_path"].is_null());
    assert!(origin["detail"].is_null());
    assert!(request.body["job"]["output_path"].is_null());
    assert_eq!(request.body["job"]["metadata"]["prompt"], "hello");
    assert!(request.body["job"]["metadata"]["output"].is_null());
    assert!(request.body["job"]["metadata"]["image_output"].is_null());
    assert!(request.body["job"]["metadata"]["error"].is_null());
    assert_eq!(request.body["job"]["error"]["message"], "Job failed.");
    assert_eq!(request.body["summary"], "openai · Job failed.");
    assert!(request.body["job"]["outputs"][0]["path"].is_null());
    assert_eq!(request.body["job"]["outputs"][0]["error"], "Output failed.");
    assert!(request.body["job"]["outputs"][0]["uploads"][0]["source_path"].is_null());
    let body = serde_json::to_string(&request.body).unwrap();
    assert!(!body.contains("/Users/alice"));
    assert!(!body.contains("/mnt/private"));
    assert!(!body.contains("destination"));
    assert!(!body.contains("source"));
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
