#![allow(unused_imports)]

use super::*;

pub(crate) fn selected_provider_from_config(
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

pub(crate) fn provider_supports_n_from_config(
    config: Option<&AppConfig>,
    provider: Option<&str>,
) -> bool {
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

pub(crate) fn provider_supports_n(provider: Option<&str>) -> bool {
    let config = load_config().ok();
    provider_supports_n_from_config(config.as_ref(), provider)
}

pub(crate) fn default_edit_region_mode_for_provider_type(provider_type: &str) -> String {
    match provider_type {
        "openai" => "native-mask".to_string(),
        "codex" => "reference-hint".to_string(),
        _ => "reference-hint".to_string(),
    }
}

pub(crate) fn provider_edit_region_mode_from_config(
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

pub(crate) fn provider_edit_region_mode(provider: Option<&str>) -> String {
    let config = load_config().ok();
    provider_edit_region_mode_from_config(config.as_ref(), provider)
}

pub(crate) fn selected_provider_name(provider: Option<&str>) -> String {
    provider
        .map(str::trim)
        .filter(|name| !name.is_empty() && *name != "auto")
        .map(ToString::to_string)
        .or_else(|| {
            load_config()
                .ok()
                .and_then(|config| config.default_provider)
                .filter(|name| !name.is_empty() && name != "auto")
        })
        .unwrap_or_else(|| "auto".to_string())
}
