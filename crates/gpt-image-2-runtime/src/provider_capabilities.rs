use gpt_image_2_core::AppConfig;

pub fn selected_provider_from_config(
    config: Option<&AppConfig>,
    provider: Option<&str>,
) -> Option<String> {
    provider
        .and_then(|name| {
            let name = name.trim();
            if name.is_empty() || name == "auto" {
                None
            } else {
                Some(name.to_string())
            }
        })
        .or_else(|| {
            config
                .and_then(|config| config.default_provider.as_deref())
                .filter(|name| !name.is_empty() && *name != "auto")
                .map(ToString::to_string)
        })
}

pub fn provider_supports_n_from_config(config: Option<&AppConfig>, provider: Option<&str>) -> bool {
    let selected = selected_provider_from_config(config, provider);
    let Some(name) = selected.as_deref() else {
        return true;
    };
    if let Some(provider) = config.and_then(|config| config.providers.get(name)) {
        return provider
            .supports_n
            .unwrap_or(provider.provider_type == "openai");
    }
    match name {
        "codex" => false,
        "openai" => true,
        _ => false,
    }
}

pub fn default_edit_region_mode_for_provider_type(provider_type: &str) -> String {
    match provider_type {
        "openai" => "native-mask".to_string(),
        "codex" => "reference-hint".to_string(),
        _ => "reference-hint".to_string(),
    }
}

pub fn provider_edit_region_mode_from_config(
    config: Option<&AppConfig>,
    provider: Option<&str>,
) -> String {
    let selected = selected_provider_from_config(config, provider);
    let Some(name) = selected.as_deref() else {
        return "reference-hint".to_string();
    };
    if let Some(provider) = config.and_then(|config| config.providers.get(name)) {
        return provider.edit_region_mode.clone().unwrap_or_else(|| {
            default_edit_region_mode_for_provider_type(&provider.provider_type)
        });
    }
    match name {
        "openai" => "native-mask".to_string(),
        "codex" => "reference-hint".to_string(),
        _ => "reference-hint".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use gpt_image_2_core::ProviderConfig;

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
            proxy: None,
            ..ProviderConfig::default()
        }
    }

    #[test]
    fn configured_builtin_name_overrides_builtin_capabilities() {
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
}
