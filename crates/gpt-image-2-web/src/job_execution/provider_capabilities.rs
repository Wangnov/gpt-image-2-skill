#![allow(unused_imports)]

use super::*;

pub(crate) fn provider_supports_n(provider: Option<&str>) -> bool {
    let config = load_config().ok();
    let selected = provider
        .and_then(|name| {
            let name = name.trim();
            if name.is_empty() || name == "auto" {
                None
            } else {
                Some(name)
            }
        })
        .or_else(|| {
            config
                .as_ref()
                .and_then(|config| config.default_provider.as_deref())
                .filter(|name| !name.is_empty() && *name != "auto")
        });

    match selected {
        Some("codex") => false,
        Some("openai") => true,
        Some(name) => config
            .as_ref()
            .and_then(|config| config.providers.get(name))
            .map(|provider| {
                provider
                    .supports_n
                    .unwrap_or(provider.provider_type == "openai")
            })
            .unwrap_or(false),
        None => true,
    }
}

pub(crate) fn provider_edit_region_mode(provider: Option<&str>) -> String {
    let config = load_config().ok();
    let selected = provider
        .and_then(|name| {
            let name = name.trim();
            if name.is_empty() || name == "auto" {
                None
            } else {
                Some(name)
            }
        })
        .or_else(|| {
            config
                .as_ref()
                .and_then(|config| config.default_provider.as_deref())
                .filter(|name| !name.is_empty() && *name != "auto")
        });

    match selected {
        Some("openai") => "native-mask".to_string(),
        Some("codex") => "reference-hint".to_string(),
        Some(name) => config
            .as_ref()
            .and_then(|config| config.providers.get(name))
            .map(|provider| {
                provider.edit_region_mode.clone().unwrap_or_else(|| {
                    match provider.provider_type.as_str() {
                        "openai" => "native-mask".to_string(),
                        "codex" => "reference-hint".to_string(),
                        _ => "reference-hint".to_string(),
                    }
                })
            })
            .unwrap_or_else(|| "reference-hint".to_string()),
        None => "reference-hint".to_string(),
    }
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
