use super::*;

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
