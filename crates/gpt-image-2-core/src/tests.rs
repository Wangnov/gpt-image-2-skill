use super::*;
use std::sync::Mutex;

static CODEX_HOME_TEST_LOCK: Mutex<()> = Mutex::new(());

struct TestCodexHome {
    previous: Option<std::ffi::OsString>,
}

impl TestCodexHome {
    fn set(path: &Path) -> Self {
        let previous = std::env::var_os("CODEX_HOME");
        unsafe {
            std::env::set_var("CODEX_HOME", path);
        }
        Self { previous }
    }
}

impl Drop for TestCodexHome {
    fn drop(&mut self) {
        unsafe {
            if let Some(previous) = &self.previous {
                std::env::set_var("CODEX_HOME", previous);
            } else {
                std::env::remove_var("CODEX_HOME");
            }
        }
    }
}

#[test]
fn parse_image_size_accepts_aliases() {
    assert_eq!(parse_image_size("2K").unwrap(), "2048x2048");
    assert_eq!(parse_image_size("4k").unwrap(), "3840x2160");
}

#[test]
fn parse_image_size_accepts_valid_dimensions() {
    assert_eq!(parse_image_size("1024x640").unwrap(), "1024x640");
    assert_eq!(parse_image_size("2880x2880").unwrap(), "2880x2880");
    assert_eq!(parse_image_size("2160x3840").unwrap(), "2160x3840");
}

#[test]
fn parse_image_size_rejects_oversized_square() {
    assert!(parse_image_size("4096x4096").is_err());
}

#[test]
fn parse_image_size_rejects_too_few_pixels() {
    assert!(parse_image_size("512x512").is_err());
}

#[test]
fn build_openai_image_body_for_edit_includes_mask_and_images() {
    let body = build_openai_image_body(
        "edit",
        "edit this image",
        "gpt-image-2",
        &["data:image/png;base64,AAAA".to_string()],
        Some("data:image/png;base64,BBBB"),
        Some(InputFidelity::High),
        Background::Auto,
        Some("1024x1024"),
        Some(Quality::High),
        Some(OutputFormat::Png),
        None,
        Some(1),
        Some(Moderation::Auto),
    );
    assert_eq!(body["images"][0]["image_url"], "data:image/png;base64,AAAA");
    assert_eq!(body["mask"]["image_url"], "data:image/png;base64,BBBB");
    assert_eq!(body["input_fidelity"], "high");
    assert_eq!(body["model"], "gpt-image-2");
}

#[test]
fn build_openai_edit_form_contains_required_parts() {
    let body = json!({
        "model": "gpt-image-2",
        "prompt": "Edit this image",
        "images": [{"image_url": "data:image/png;base64,YWJjZA=="}],
        "mask": {"image_url": "data:image/png;base64,YWJjZA=="},
        "size": "1024x1024",
    });
    assert!(build_openai_edit_form(&body).is_ok());
}

#[test]
fn app_config_round_trips_with_file_secret() {
    let temp_dir = tempfile::tempdir().unwrap();
    let config_path = temp_dir.path().join("config.json");
    let mut config = AppConfig {
        default_provider: Some("local".to_string()),
        ..Default::default()
    };
    config.providers.insert(
        "local".to_string(),
        ProviderConfig {
            provider_type: "openai-compatible".to_string(),
            api_base: Some("https://example.com/v1".to_string()),
            endpoint: None,
            model: Some(DEFAULT_OPENAI_MODEL.to_string()),
            credentials: BTreeMap::from([(
                "api_key".to_string(),
                CredentialRef::File {
                    value: "sk-test".to_string(),
                },
            )]),
            supports_n: Some(false),
            edit_region_mode: Some(EDIT_REGION_REFERENCE_HINT.to_string()),
        },
    );
    save_app_config(&config_path, &config).unwrap();
    let loaded = load_app_config(&config_path).unwrap();
    assert_eq!(loaded.default_provider.as_deref(), Some("local"));
    assert_eq!(
        redact_app_config(&loaded)["providers"]["local"]["credentials"]["api_key"]["value"]["_omitted"],
        "secret"
    );
}

#[test]
fn configured_openai_provider_resolves_with_file_secret() {
    let provider = ProviderConfig {
        provider_type: "openai-compatible".to_string(),
        api_base: Some("https://example.com/v1".to_string()),
        endpoint: None,
        model: None,
        credentials: BTreeMap::from([(
            "api_key".to_string(),
            CredentialRef::File {
                value: "sk-test".to_string(),
            },
        )]),
        supports_n: Some(true),
        edit_region_mode: None,
    };
    let selection = configured_provider_selection("local", &provider, "test", None).unwrap();
    assert_eq!(selection.resolved, "local");
    assert_eq!(selection.api_base, "https://example.com/v1");
    assert!(matches!(selection.kind, ProviderKind::OpenAi));
    assert_eq!(selection.edit_region_mode, EDIT_REGION_REFERENCE_HINT);
}

#[test]
fn explicit_builtin_name_uses_configured_provider_when_present() {
    let temp_dir = tempfile::tempdir().unwrap();
    let config_path = temp_dir.path().join("config.json");
    let mut config = AppConfig::default();
    config.providers.insert(
        "openai".to_string(),
        ProviderConfig {
            provider_type: "openai-compatible".to_string(),
            api_base: Some("https://example.com/v1".to_string()),
            endpoint: None,
            model: Some("gpt-image-2".to_string()),
            credentials: BTreeMap::from([(
                "api_key".to_string(),
                CredentialRef::File {
                    value: "sk-test".to_string(),
                },
            )]),
            supports_n: Some(false),
            edit_region_mode: Some(EDIT_REGION_REFERENCE_HINT.to_string()),
        },
    );
    save_app_config(&config_path, &config).unwrap();

    let cli = Cli {
        json: true,
        provider: "openai".to_string(),
        api_key: None,
        config: Some(config_path.display().to_string()),
        auth_file: default_auth_path().display().to_string(),
        endpoint: DEFAULT_CODEX_ENDPOINT.to_string(),
        openai_api_base: DEFAULT_OPENAI_API_BASE.to_string(),
        json_events: false,
        command: Commands::Doctor,
    };
    let selection = select_image_provider(&cli).unwrap();

    assert_eq!(selection.resolved, "openai");
    assert_eq!(selection.reason, "explicit_config_provider");
    assert_eq!(selection.api_base, "https://example.com/v1");
    assert!(!selection.supports_n);
}

#[test]
fn configured_openai_name_loads_config_secret_for_image_auth() {
    let temp_dir = tempfile::tempdir().unwrap();
    let config_path = temp_dir.path().join("config.json");
    let mut config = AppConfig::default();
    config.providers.insert(
        "openai".to_string(),
        ProviderConfig {
            provider_type: "openai-compatible".to_string(),
            api_base: Some("https://example.com/v1".to_string()),
            endpoint: None,
            model: Some("gpt-image-2".to_string()),
            credentials: BTreeMap::from([(
                "api_key".to_string(),
                CredentialRef::File {
                    value: "sk-test".to_string(),
                },
            )]),
            supports_n: Some(false),
            edit_region_mode: Some(EDIT_REGION_REFERENCE_HINT.to_string()),
        },
    );
    save_app_config(&config_path, &config).unwrap();

    let cli = Cli {
        json: true,
        provider: "openai".to_string(),
        api_key: None,
        config: Some(config_path.display().to_string()),
        auth_file: default_auth_path().display().to_string(),
        endpoint: DEFAULT_CODEX_ENDPOINT.to_string(),
        openai_api_base: DEFAULT_OPENAI_API_BASE.to_string(),
        json_events: false,
        command: Commands::Doctor,
    };
    let selection = select_image_provider(&cli).unwrap();
    let auth = load_openai_auth_state_for(&cli, &selection).unwrap();

    assert_eq!(auth.api_key, "sk-test");
    assert_eq!(auth.source, "file");
}

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

#[test]
fn storage_config_defaults_to_local_fallback_target() {
    let _guard = CODEX_HOME_TEST_LOCK.lock().unwrap();
    let temp_dir = tempfile::tempdir().unwrap();
    let _home = TestCodexHome::set(temp_dir.path());
    let config = AppConfig::default();

    assert_eq!(config.storage.fallback_targets, vec!["local-default"]);
    assert_eq!(
        config.storage.fallback_policy,
        StorageFallbackPolicy::OnFailure
    );
    assert_eq!(config.storage.upload_concurrency, 4);
    assert_eq!(config.storage.target_concurrency, 2);
    assert!(matches!(
        config.storage.targets.get("local-default"),
        Some(StorageTargetConfig::Local { directory, public_base_url: None }) if directory == &shared_config_dir().join("storage").join("fallback")
    ));
}

fn s3_test_target(
    access_key_id: Option<CredentialRef>,
    secret_access_key: Option<CredentialRef>,
) -> StorageTargetConfig {
    StorageTargetConfig::S3 {
        bucket: "images".to_string(),
        region: Some("us-east-1".to_string()),
        endpoint: Some("http://127.0.0.1:9000".to_string()),
        prefix: None,
        access_key_id,
        secret_access_key,
        session_token: None,
        public_base_url: None,
    }
}

#[test]
fn s3_storage_test_requires_access_key() {
    let target = s3_test_target(
        None,
        Some(CredentialRef::File {
            value: "secret".to_string(),
        }),
    );

    let result = test_storage_target("s3", &target);

    assert!(!result.ok);
    assert_eq!(result.detail.unwrap()["access_key_ready"], false);
}

#[test]
fn s3_storage_test_requires_secret_key() {
    let target = s3_test_target(
        Some(CredentialRef::File {
            value: "access".to_string(),
        }),
        None,
    );

    let result = test_storage_target("s3", &target);

    assert!(!result.ok);
    assert_eq!(result.detail.unwrap()["secret_key_ready"], false);
}

#[test]
fn s3_storage_test_rejects_empty_file_credentials() {
    let target = s3_test_target(
        Some(CredentialRef::File {
            value: String::new(),
        }),
        Some(CredentialRef::File {
            value: "secret".to_string(),
        }),
    );

    let result = test_storage_target("s3", &target);

    assert!(!result.ok);
    assert_eq!(result.detail.unwrap()["access_key_ready"], false);
}

#[test]
fn s3_storage_test_rejects_missing_env_credentials() {
    unsafe {
        std::env::remove_var("GPT_IMAGE_2_MISSING_S3_ACCESS_KEY");
    }
    let target = s3_test_target(
        Some(CredentialRef::Env {
            env: "GPT_IMAGE_2_MISSING_S3_ACCESS_KEY".to_string(),
        }),
        Some(CredentialRef::File {
            value: "secret".to_string(),
        }),
    );

    let result = test_storage_target("s3", &target);

    assert!(!result.ok);
    assert_eq!(result.detail.unwrap()["access_key_ready"], false);
}

#[test]
fn product_paths_default_by_runtime() {
    let config = AppConfig::default();

    assert!(
        product_app_data_dir(Some(&config), ProductRuntime::Tauri)
            .ends_with("com.wangnov.gpt-image-2")
    );
    assert!(
        product_result_library_dir(Some(&config), ProductRuntime::Tauri).ends_with(JOBS_DIR_NAME)
    );
    assert_eq!(
        product_app_data_dir(Some(&config), ProductRuntime::DockerWeb),
        PathBuf::from("/data").join(PRODUCT_DIR_NAME)
    );
    assert_eq!(
        product_result_library_dir(Some(&config), ProductRuntime::DockerWeb),
        PathBuf::from("/data")
            .join(PRODUCT_DIR_NAME)
            .join(JOBS_DIR_NAME)
    );
}

#[test]
fn storage_config_redacts_target_credentials() {
    let config = AppConfig {
        storage: StorageConfig {
            targets: BTreeMap::from([
                (
                    "s3".to_string(),
                    StorageTargetConfig::S3 {
                        bucket: "images".to_string(),
                        region: Some("us-east-1".to_string()),
                        endpoint: Some("https://s3.example.com".to_string()),
                        prefix: Some("out/".to_string()),
                        access_key_id: Some(CredentialRef::File {
                            value: "ak".to_string(),
                        }),
                        secret_access_key: Some(CredentialRef::File {
                            value: "sk".to_string(),
                        }),
                        session_token: Some(CredentialRef::File {
                            value: "token".to_string(),
                        }),
                        public_base_url: Some("https://cdn.example.com".to_string()),
                    },
                ),
                (
                    "webdav".to_string(),
                    StorageTargetConfig::WebDav {
                        url: "https://dav.example.com/out".to_string(),
                        username: Some("robot".to_string()),
                        password: Some(CredentialRef::File {
                            value: "dav-secret".to_string(),
                        }),
                        public_base_url: None,
                    },
                ),
                (
                    "http".to_string(),
                    StorageTargetConfig::Http {
                        url: "https://upload.example.com/out".to_string(),
                        method: "POST".to_string(),
                        headers: BTreeMap::from([(
                            "Authorization".to_string(),
                            CredentialRef::File {
                                value: "Bearer secret".to_string(),
                            },
                        )]),
                        public_url_json_pointer: Some("/url".to_string()),
                    },
                ),
                (
                    "sftp".to_string(),
                    StorageTargetConfig::Sftp {
                        host: "sftp.example.com".to_string(),
                        port: 22,
                        host_key_sha256: Some("SHA256:abc".to_string()),
                        username: "robot".to_string(),
                        password: Some(CredentialRef::File {
                            value: "sftp-password".to_string(),
                        }),
                        private_key: Some(CredentialRef::File {
                            value: "sftp-key".to_string(),
                        }),
                        remote_dir: "/out".to_string(),
                        public_base_url: None,
                    },
                ),
            ]),
            ..Default::default()
        },
        ..Default::default()
    };

    let redacted = redact_app_config(&config);

    assert_eq!(
        redacted["storage"]["targets"]["s3"]["access_key_id"]["value"]["_omitted"],
        "secret"
    );
    assert_eq!(
        redacted["storage"]["targets"]["s3"]["secret_access_key"]["value"]["_omitted"],
        "secret"
    );
    assert_eq!(
        redacted["storage"]["targets"]["s3"]["session_token"]["value"]["_omitted"],
        "secret"
    );
    assert_eq!(
        redacted["storage"]["targets"]["webdav"]["password"]["value"]["_omitted"],
        "secret"
    );
    assert_eq!(
        redacted["storage"]["targets"]["http"]["headers"]["Authorization"]["value"]["_omitted"],
        "secret"
    );
    assert_eq!(
        redacted["storage"]["targets"]["sftp"]["password"]["value"]["_omitted"],
        "secret"
    );
    assert_eq!(
        redacted["storage"]["targets"]["sftp"]["private_key"]["value"]["_omitted"],
        "secret"
    );
    assert_eq!(
        redacted["storage"]["targets"]["sftp"]["host_key_sha256"],
        "SHA256:abc"
    );
}

#[test]
fn storage_secret_preservation_requires_same_target_identity() {
    let existing = StorageConfig {
        targets: BTreeMap::from([(
            "s3-main".to_string(),
            StorageTargetConfig::S3 {
                bucket: "images".to_string(),
                region: Some("us-east-1".to_string()),
                endpoint: Some("https://s3.example.com".to_string()),
                prefix: Some("out".to_string()),
                access_key_id: Some(CredentialRef::File {
                    value: "ak".to_string(),
                }),
                secret_access_key: Some(CredentialRef::File {
                    value: "sk".to_string(),
                }),
                session_token: None,
                public_base_url: None,
            },
        )]),
        ..StorageConfig::default()
    };
    let mut same_target = StorageConfig {
        targets: BTreeMap::from([(
            "s3-main".to_string(),
            StorageTargetConfig::S3 {
                bucket: "images".to_string(),
                region: Some("us-east-1".to_string()),
                endpoint: Some("https://s3.example.com".to_string()),
                prefix: Some("out".to_string()),
                access_key_id: Some(CredentialRef::File {
                    value: String::new(),
                }),
                secret_access_key: Some(CredentialRef::File {
                    value: String::new(),
                }),
                session_token: None,
                public_base_url: None,
            },
        )]),
        ..StorageConfig::default()
    };
    preserve_storage_secrets(&mut same_target, &existing);
    let StorageTargetConfig::S3 {
        access_key_id,
        secret_access_key,
        ..
    } = same_target.targets.get("s3-main").unwrap()
    else {
        panic!("expected s3 target");
    };
    assert_eq!(
        access_key_id,
        &Some(CredentialRef::File {
            value: "ak".to_string()
        })
    );
    assert_eq!(
        secret_access_key,
        &Some(CredentialRef::File {
            value: "sk".to_string()
        })
    );

    let mut changed_target = StorageConfig {
        targets: BTreeMap::from([(
            "s3-main".to_string(),
            StorageTargetConfig::S3 {
                bucket: "other-images".to_string(),
                region: Some("us-east-1".to_string()),
                endpoint: Some("https://s3.example.com".to_string()),
                prefix: Some("out".to_string()),
                access_key_id: Some(CredentialRef::File {
                    value: String::new(),
                }),
                secret_access_key: Some(CredentialRef::File {
                    value: String::new(),
                }),
                session_token: None,
                public_base_url: None,
            },
        )]),
        ..StorageConfig::default()
    };
    preserve_storage_secrets(&mut changed_target, &existing);
    let StorageTargetConfig::S3 {
        access_key_id,
        secret_access_key,
        ..
    } = changed_target.targets.get("s3-main").unwrap()
    else {
        panic!("expected s3 target");
    };
    assert_eq!(
        access_key_id,
        &Some(CredentialRef::File {
            value: String::new()
        })
    );
    assert_eq!(
        secret_access_key,
        &Some(CredentialRef::File {
            value: String::new()
        })
    );
}

#[test]
fn storage_secret_preservation_survives_target_rename() {
    let existing = StorageConfig {
        targets: BTreeMap::from([(
            "s3-main".to_string(),
            StorageTargetConfig::S3 {
                bucket: "images".to_string(),
                region: Some("us-east-1".to_string()),
                endpoint: Some("https://s3.example.com".to_string()),
                prefix: Some("out".to_string()),
                access_key_id: Some(CredentialRef::File {
                    value: "ak".to_string(),
                }),
                secret_access_key: Some(CredentialRef::File {
                    value: "sk".to_string(),
                }),
                session_token: None,
                public_base_url: None,
            },
        )]),
        ..StorageConfig::default()
    };
    let mut renamed_target = StorageConfig {
        targets: BTreeMap::from([(
            "s3-archive".to_string(),
            StorageTargetConfig::S3 {
                bucket: "images".to_string(),
                region: Some("us-east-1".to_string()),
                endpoint: Some("https://s3.example.com".to_string()),
                prefix: Some("out".to_string()),
                access_key_id: Some(CredentialRef::File {
                    value: String::new(),
                }),
                secret_access_key: Some(CredentialRef::File {
                    value: String::new(),
                }),
                session_token: None,
                public_base_url: None,
            },
        )]),
        ..StorageConfig::default()
    };

    preserve_storage_secrets(&mut renamed_target, &existing);

    let StorageTargetConfig::S3 {
        access_key_id,
        secret_access_key,
        ..
    } = renamed_target.targets.get("s3-archive").unwrap()
    else {
        panic!("expected s3 target");
    };
    assert_eq!(
        access_key_id,
        &Some(CredentialRef::File {
            value: "ak".to_string()
        })
    );
    assert_eq!(
        secret_access_key,
        &Some(CredentialRef::File {
            value: "sk".to_string()
        })
    );
}

#[test]
fn storage_remote_guard_blocks_internal_addresses() {
    let err = validate_remote_http_target("http://127.0.0.1/upload", "HTTP storage")
        .err()
        .unwrap_or_else(|| panic!("expected storage target to be rejected"));
    assert_eq!(err.code, "storage_remote_blocked");

    let err = validate_remote_tcp_target("127.0.0.1", 22, "SFTP storage")
        .err()
        .unwrap_or_else(|| panic!("expected storage tcp target to be rejected"));
    assert_eq!(err.code, "storage_remote_blocked");
}

#[test]
fn sftp_host_key_fingerprint_accepts_sha256_prefix() {
    assert!(sftp_host_key_matches(
        "SHA256:YWJjZA",
        "deadbeef",
        "YWJjZA=="
    ));
    assert!(sftp_host_key_matches("deadbeef", "DEADBEEF", "ignored"));
    assert!(!sftp_host_key_matches(
        "SHA256:other",
        "deadbeef",
        "YWJjZA=="
    ));
}

#[test]
fn history_upload_records_enrich_history_job_outputs() {
    let _guard = CODEX_HOME_TEST_LOCK.lock().unwrap();
    let temp_dir = tempfile::tempdir().unwrap();
    let _home = TestCodexHome::set(temp_dir.path());

    upsert_history_job(
        "job-storage-1",
        "images generate",
        "openai",
        "completed",
        None,
        Some("2026-05-08T10:00:00Z"),
        json!({
            "output": {
                "files": [
                    {"index": 0, "path": "/tmp/out-0.png", "bytes": 10},
                    {"index": 1, "path": "/tmp/out-1.png", "bytes": 12}
                ]
            }
        }),
    )
    .unwrap();

    upsert_output_upload_record(&OutputUploadRecord {
        job_id: "job-storage-1".to_string(),
        output_index: 0,
        target: "s3-main".to_string(),
        target_type: "s3".to_string(),
        status: "completed".to_string(),
        url: Some("https://cdn.example.com/out-0.png".to_string()),
        error: None,
        bytes: Some(10),
        attempts: 1,
        updated_at: "2026-05-08T10:01:00Z".to_string(),
        metadata: json!({"etag": "abc"}),
    })
    .unwrap();
    upsert_output_upload_record(&OutputUploadRecord {
        job_id: "job-storage-1".to_string(),
        output_index: 1,
        target: "s3-main".to_string(),
        target_type: "s3".to_string(),
        status: "failed".to_string(),
        url: None,
        error: Some("boom".to_string()),
        bytes: None,
        attempts: 2,
        updated_at: "2026-05-08T10:02:00Z".to_string(),
        metadata: Value::Null,
    })
    .unwrap();

    let uploads = list_output_upload_records("job-storage-1").unwrap();
    assert_eq!(uploads.len(), 2);

    let job = show_history_job("job-storage-1").unwrap();
    assert_eq!(job["storage_status"], "partial_failed");
    assert_eq!(job["outputs"][0]["uploads"][0]["target"], "s3-main");
    assert_eq!(
        job["outputs"][0]["uploads"][0]["url"],
        "https://cdn.example.com/out-0.png"
    );
    assert_eq!(job["outputs"][1]["uploads"][0]["status"], "failed");
    assert_eq!(job["outputs"][1]["uploads"][0]["error"], "boom");
}

#[test]
fn history_rows_without_upload_records_keep_legacy_outputs() {
    let _guard = CODEX_HOME_TEST_LOCK.lock().unwrap();
    let temp_dir = tempfile::tempdir().unwrap();
    let _home = TestCodexHome::set(temp_dir.path());

    upsert_history_job(
        "job-legacy-1",
        "images generate",
        "openai",
        "completed",
        None,
        Some("2026-05-08T11:00:00Z"),
        json!({
            "output": {
                "files": [{"index": 0, "path": "/tmp/legacy.png", "bytes": 99}]
            }
        }),
    )
    .unwrap();

    let job = show_history_job("job-legacy-1").unwrap();

    assert_eq!(job["outputs"][0]["path"], "/tmp/legacy.png");
    assert_eq!(job["outputs"][0].get("uploads"), None);
    assert_eq!(job["storage_status"], "not_configured");
}

#[test]
fn storage_upload_falls_back_to_local_target_after_primary_failure() {
    let _guard = CODEX_HOME_TEST_LOCK.lock().unwrap();
    let temp_dir = tempfile::tempdir().unwrap();
    let _home = TestCodexHome::set(temp_dir.path());
    let source_dir = temp_dir.path().join("source");
    fs::create_dir_all(&source_dir).unwrap();
    let output_path = source_dir.join("out.png");
    fs::write(&output_path, b"png").unwrap();
    let fallback_dir = temp_dir.path().join("fallback");
    let config = StorageConfig {
        targets: BTreeMap::from([
            (
                "missing-primary".to_string(),
                StorageTargetConfig::Local {
                    directory: temp_dir.path().join("missing-parent").join("missing-file"),
                    public_base_url: Some("https://primary.example.com".to_string()),
                },
            ),
            (
                "local-fallback".to_string(),
                StorageTargetConfig::Local {
                    directory: fallback_dir.clone(),
                    public_base_url: Some("https://fallback.example.com/images".to_string()),
                },
            ),
        ]),
        default_targets: vec!["missing-primary".to_string()],
        fallback_targets: vec!["local-fallback".to_string()],
        fallback_policy: StorageFallbackPolicy::OnFailure,
        upload_concurrency: 2,
        target_concurrency: 2,
    };
    let job = json!({
        "id": "job-fallback-1",
        "outputs": [{"index": 0, "path": output_path.display().to_string(), "bytes": 3}],
    });
    upsert_history_job(
        "job-fallback-1",
        "images generate",
        "openai",
        "completed",
        Some(&output_path),
        Some("2026-05-08T12:00:00Z"),
        json!({
            "output": {
                "files": [{"index": 0, "path": output_path.display().to_string(), "bytes": 3}]
            }
        }),
    )
    .unwrap();

    fs::write(
        temp_dir.path().join("missing-parent").join("missing-file"),
        b"not-a-dir",
    )
    .unwrap_err();
    fs::create_dir_all(temp_dir.path().join("missing-parent")).unwrap();
    fs::write(
        temp_dir.path().join("missing-parent").join("missing-file"),
        b"x",
    )
    .unwrap();

    let uploads =
        upload_job_outputs_to_storage(&config, &job, StorageUploadOverrides::default()).unwrap();

    assert_eq!(uploads.len(), 2);
    assert!(
        uploads
            .iter()
            .any(|upload| { upload.target == "missing-primary" && upload.status == "failed" })
    );
    let fallback = uploads
        .iter()
        .find(|upload| upload.target == "local-fallback")
        .unwrap();
    assert_eq!(fallback.status, "completed");
    assert_eq!(
        fallback.url.as_deref(),
        Some("https://fallback.example.com/images/job-fallback-1/1-out.png")
    );
    assert!(
        fallback_dir
            .join("job-fallback-1")
            .join("1-out.png")
            .is_file()
    );
    assert_eq!(storage_status_for_uploads(&uploads), "fallback_completed");
}

#[test]
fn s3_endpoint_builder_supports_aws_and_compatible_styles() {
    let (url, host, canonical_uri) =
        s3_endpoint_and_host("images", Some("us-west-2"), None, "jobs/1 out.png").unwrap();
    assert_eq!(
        url,
        "https://images.s3.us-west-2.amazonaws.com/jobs/1%20out.png"
    );
    assert_eq!(host, "images.s3.us-west-2.amazonaws.com");
    assert_eq!(canonical_uri, "/jobs/1%20out.png");

    let (url, host, canonical_uri) = s3_endpoint_and_host(
        "images",
        Some("us-east-1"),
        Some("https://s3.example.com"),
        "jobs/out.png",
    )
    .unwrap();
    assert_eq!(url, "https://s3.example.com/images/jobs/out.png");
    assert_eq!(host, "s3.example.com");
    assert_eq!(canonical_uri, "/images/jobs/out.png");

    let (url, host, _) = s3_endpoint_and_host(
        "images",
        Some("us-east-1"),
        Some("https://{bucket}.storage.example.com"),
        "jobs/out.png",
    )
    .unwrap();
    assert_eq!(url, "https://images.storage.example.com/jobs/out.png");
    assert_eq!(host, "images.storage.example.com");
}

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

#[test]
fn webhook_ssrf_guard_blocks_internal_addresses() {
    for url in [
        "http://127.0.0.1/hook",
        "http://localhost/hook",
        "http://10.0.0.1/hook",
        "http://172.16.5.5/hook",
        "http://192.168.1.1/hook",
        "http://169.254.169.254/latest/meta-data/", // AWS metadata
        "http://0.0.0.0/hook",
        "http://255.255.255.255/hook",
        "http://[::1]/hook",
        "http://[::ffff:127.0.0.1]/hook",
        "http://[fc00::1]/hook",
        "http://[fe80::1]/hook",
    ] {
        let err = validate_webhook_target(url).err().unwrap_or_else(|| {
            panic!("expected {url} to be rejected as internal");
        });
        assert_eq!(
            err.code, "notification_webhook_blocked",
            "url {url} produced unexpected error code {}",
            err.code
        );
    }
}

#[test]
fn webhook_ssrf_guard_rejects_non_http_schemes() {
    let err = validate_webhook_target("ftp://example.com/hook")
        .err()
        .expect("non-http scheme should be rejected");
    assert_eq!(err.code, "notification_webhook_invalid");
}

#[test]
fn webhook_ssrf_guard_rejects_malformed_urls() {
    let err = validate_webhook_target("not a url")
        .err()
        .expect("malformed url should be rejected");
    assert_eq!(err.code, "notification_webhook_invalid");
}

#[test]
fn ip_is_internal_classifies_addresses() {
    assert!(ip_is_internal("127.0.0.1".parse().unwrap()));
    assert!(ip_is_internal("10.0.0.1".parse().unwrap()));
    assert!(ip_is_internal("172.16.5.5".parse().unwrap()));
    assert!(ip_is_internal("192.168.1.1".parse().unwrap()));
    assert!(ip_is_internal("169.254.169.254".parse().unwrap()));
    assert!(ip_is_internal("0.0.0.0".parse().unwrap()));
    assert!(ip_is_internal("224.0.0.1".parse().unwrap()));
    assert!(ip_is_internal("::1".parse().unwrap()));
    assert!(ip_is_internal("fc00::1".parse().unwrap()));
    assert!(ip_is_internal("fe80::1".parse().unwrap()));

    assert!(!ip_is_internal("8.8.8.8".parse().unwrap()));
    assert!(!ip_is_internal("1.1.1.1".parse().unwrap()));
    assert!(!ip_is_internal("2606:4700:4700::1111".parse().unwrap()));
}

#[test]
fn canonicalize_ip_unmaps_ipv4_in_ipv6() {
    let mapped: IpAddr = "::ffff:127.0.0.1".parse().unwrap();
    match canonicalize_ip(mapped) {
        IpAddr::V4(v4) => assert_eq!(v4, Ipv4Addr::new(127, 0, 0, 1)),
        other => panic!("expected ipv4 unmapping, got {other:?}"),
    }
}
