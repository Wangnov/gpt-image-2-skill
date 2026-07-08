#![allow(unused_imports)]

use super::*;

pub(crate) use gpt_image_2_runtime::{
    default_edit_region_mode_for_provider_type, provider_edit_region_mode_from_config,
    provider_supports_n_from_config, selected_provider_from_config,
};

pub(crate) fn provider_supports_n(provider: Option<&str>) -> bool {
    let config = load_config().ok();
    provider_supports_n_from_config(config.as_ref(), provider)
}

pub(crate) fn provider_edit_region_mode(provider: Option<&str>) -> String {
    let config = load_config().ok();
    provider_edit_region_mode_from_config(config.as_ref(), provider)
}

pub(crate) fn selected_provider_name(provider: Option<&str>) -> String {
    selected_provider_from_config(load_config().ok().as_ref(), provider)
        .unwrap_or_else(|| "auto".to_string())
}
