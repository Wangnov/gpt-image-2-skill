#![allow(unused_imports)]

use super::*;

use super::*;

fn openai_compatible_provider() -> ProviderConfig {
    ProviderConfig {
        provider_type: "openai-compatible".to_string(),
        api_base: Some("https://example.com/v1".to_string()),
        endpoint: None,
        model: Some("gpt-image-2".to_string()),
        credentials: BTreeMap::new(),
        supports_n: Some(false),
        edit_region_mode: Some("reference-hint".to_string()),
    }
}

#[test]
fn configured_openai_name_overrides_builtin_capabilities() {
    let mut config = AppConfig::default();
    config
        .providers
        .insert("openai".to_string(), openai_compatible_provider());

    assert!(!provider_supports_n_from_config(
        Some(&config),
        Some("openai")
    ));
    assert_eq!(
        provider_edit_region_mode_from_config(Some(&config), Some("openai")),
        "reference-hint"
    );
}

#[test]
fn default_provider_uses_configured_openai_capabilities() {
    let mut config = AppConfig {
        default_provider: Some("openai".to_string()),
        ..Default::default()
    };
    config
        .providers
        .insert("openai".to_string(), openai_compatible_provider());

    assert!(!provider_supports_n_from_config(Some(&config), None));
    assert_eq!(
        provider_edit_region_mode_from_config(Some(&config), None),
        "reference-hint"
    );
}

#[test]
fn builtin_openai_capabilities_are_fallback_when_config_absent() {
    let config = AppConfig::default();

    assert!(provider_supports_n_from_config(
        Some(&config),
        Some("openai")
    ));
    assert_eq!(
        provider_edit_region_mode_from_config(Some(&config), Some("openai")),
        "native-mask"
    );
}
