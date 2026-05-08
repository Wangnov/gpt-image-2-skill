use super::*;

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
