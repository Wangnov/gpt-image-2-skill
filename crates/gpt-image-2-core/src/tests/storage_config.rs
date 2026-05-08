use super::*;

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
