use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::cli_types::Cli;
use crate::config_io::load_app_config;
use crate::config_types::AppConfig;
use crate::constants::{
    CONFIG_DIR_NAME, CONFIG_FILE_NAME, EXPORTS_DIR_NAME, HISTORY_FILE_NAME,
    IMAGE_SIZE_MAX_ASPECT_RATIO, IMAGE_SIZE_MAX_EDGE, IMAGE_SIZE_MAX_TOTAL_PIXELS,
    IMAGE_SIZE_MIN_TOTAL_PIXELS, JOBS_DIR_NAME, PRODUCT_DIR_NAME,
};
use crate::storage_config::{ExportDirMode, PathMode, PathRef};

pub fn parse_image_size(value: &str) -> Result<String, String> {
    let normalized = value.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return Err("Image size must be auto, 2K, 4K, or WIDTHxHEIGHT.".to_string());
    }
    if normalized == "auto" {
        return Ok("auto".to_string());
    }
    if normalized == "2k" {
        return Ok("2048x2048".to_string());
    }
    if normalized == "4k" {
        return Ok("3840x2160".to_string());
    }
    let Some((width_text, height_text)) = normalized.split_once('x') else {
        return Err("Image size must be auto, 2K, 4K, or WIDTHxHEIGHT.".to_string());
    };
    let width: u32 = width_text
        .parse()
        .map_err(|_| "Image size must be auto, 2K, 4K, or WIDTHxHEIGHT.".to_string())?;
    let height: u32 = height_text
        .parse()
        .map_err(|_| "Image size must be auto, 2K, 4K, or WIDTHxHEIGHT.".to_string())?;
    if width == 0 || height == 0 {
        return Err("Image size must use positive width and height values.".to_string());
    }
    if !width.is_multiple_of(16) || !height.is_multiple_of(16) {
        return Err(
            "Image size must use width and height values that are multiples of 16.".to_string(),
        );
    }
    if width.max(height) > IMAGE_SIZE_MAX_EDGE {
        return Err(format!(
            "Image size supports a maximum edge of {}px.",
            IMAGE_SIZE_MAX_EDGE
        ));
    }
    let total_pixels = width.saturating_mul(height);
    if total_pixels < IMAGE_SIZE_MIN_TOTAL_PIXELS {
        return Err(format!(
            "Image size supports at least {} total pixels.",
            IMAGE_SIZE_MIN_TOTAL_PIXELS
        ));
    }
    if total_pixels > IMAGE_SIZE_MAX_TOTAL_PIXELS {
        return Err(format!(
            "Image size supports up to {} total pixels.",
            IMAGE_SIZE_MAX_TOTAL_PIXELS
        ));
    }
    let aspect_ratio = width.max(height) as f64 / width.min(height) as f64;
    if aspect_ratio > IMAGE_SIZE_MAX_ASPECT_RATIO {
        return Err(format!(
            "Image size supports a maximum aspect ratio of {}:1.",
            IMAGE_SIZE_MAX_ASPECT_RATIO
        ));
    }
    Ok(format!("{width}x{height}"))
}

pub fn default_auth_path() -> PathBuf {
    resolve_codex_home().join("auth.json")
}

pub fn shared_config_dir() -> PathBuf {
    resolve_codex_home().join(CONFIG_DIR_NAME)
}

pub const PRODUCT_CONFIG_FILE_ENV: &str = "GPT_IMAGE_2_CONFIG_FILE";

pub const PRODUCT_HISTORY_FILE_ENV: &str = "GPT_IMAGE_2_HISTORY_FILE";

pub fn default_config_path() -> PathBuf {
    if let Some(value) = std::env::var_os(PRODUCT_CONFIG_FILE_ENV)
        && !value.is_empty()
    {
        return PathBuf::from(value);
    }
    shared_config_dir().join(CONFIG_FILE_NAME)
}

pub fn history_db_path() -> PathBuf {
    if let Some(value) = std::env::var_os(PRODUCT_HISTORY_FILE_ENV)
        && !value.is_empty()
    {
        return PathBuf::from(value);
    }
    shared_config_dir().join(HISTORY_FILE_NAME)
}

pub fn jobs_dir() -> PathBuf {
    shared_config_dir().join(JOBS_DIR_NAME)
}

pub(crate) fn default_storage_fallback_dir() -> PathBuf {
    shared_config_dir().join("storage").join("fallback")
}

pub(crate) fn default_legacy_shared_codex_path() -> PathBuf {
    shared_config_dir()
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum ProductRuntime {
    Tauri,
    DockerWeb,
}

pub fn product_default_export_dirs(
    config: &AppConfig,
    runtime: ProductRuntime,
) -> BTreeMap<ExportDirMode, PathBuf> {
    [
        ExportDirMode::Downloads,
        ExportDirMode::Documents,
        ExportDirMode::Pictures,
        ExportDirMode::ResultLibrary,
        ExportDirMode::BrowserDefault,
    ]
    .into_iter()
    .map(|mode| {
        let mut preview_config = config.clone();
        preview_config.paths.default_export_dir.mode = mode.clone();
        preview_config.paths.default_export_dir.path = None;
        (
            mode,
            product_default_export_dir(Some(&preview_config), runtime),
        )
    })
    .collect()
}

pub(crate) fn default_product_app_data_dir(runtime: ProductRuntime) -> PathBuf {
    match runtime {
        ProductRuntime::Tauri => dirs::data_dir()
            .or_else(dirs::home_dir)
            .unwrap_or_else(|| PathBuf::from("."))
            .join("com.wangnov.gpt-image-2"),
        ProductRuntime::DockerWeb => std::env::var_os("GPT_IMAGE_2_DATA_DIR")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("/data").join(PRODUCT_DIR_NAME)),
    }
}

pub(crate) fn default_product_export_dir(runtime: ProductRuntime, app_data_dir: &Path) -> PathBuf {
    match runtime {
        ProductRuntime::Tauri => dirs::download_dir()
            .or_else(dirs::document_dir)
            .unwrap_or_else(|| app_data_dir.join(EXPORTS_DIR_NAME))
            .join("GPT Image 2"),
        ProductRuntime::DockerWeb => app_data_dir.join(EXPORTS_DIR_NAME),
    }
}

pub(crate) fn resolve_path_ref(default: PathBuf, path_ref: &PathRef) -> PathBuf {
    match path_ref.mode {
        PathMode::Custom => path_ref
            .path
            .as_ref()
            .filter(|path| !path.as_os_str().is_empty())
            .map(|path| expand_pathbuf_tilde(path))
            .unwrap_or(default),
        PathMode::Default => default,
    }
}

pub fn product_app_data_dir(config: Option<&AppConfig>, runtime: ProductRuntime) -> PathBuf {
    let default = default_product_app_data_dir(runtime);
    config
        .map(|config| resolve_path_ref(default.clone(), &config.paths.app_data_dir))
        .unwrap_or(default)
}

pub fn product_config_path(config: Option<&AppConfig>, runtime: ProductRuntime) -> PathBuf {
    product_app_data_dir(config, runtime).join(CONFIG_FILE_NAME)
}

pub fn product_history_db_path(config: Option<&AppConfig>, runtime: ProductRuntime) -> PathBuf {
    product_app_data_dir(config, runtime).join(HISTORY_FILE_NAME)
}

/// Configure this process so App/Web product runtimes use their own
/// config/history files, while CLI/Skill keep the legacy `$CODEX_HOME` paths.
///
/// The optional legacy config is used only to honor already-saved custom
/// product data dirs before we redirect `default_config_path()`.
pub fn initialize_product_runtime_paths(runtime: ProductRuntime) -> (PathBuf, PathBuf) {
    let legacy_config_path = shared_config_dir().join(CONFIG_FILE_NAME);
    let legacy_config = load_app_config(&legacy_config_path).ok();
    let config_file = product_config_path(legacy_config.as_ref(), runtime);
    let history_file = product_history_db_path(legacy_config.as_ref(), runtime);
    unsafe {
        std::env::set_var(PRODUCT_CONFIG_FILE_ENV, &config_file);
        std::env::set_var(PRODUCT_HISTORY_FILE_ENV, &history_file);
    }
    (config_file, history_file)
}

pub fn product_result_library_dir(config: Option<&AppConfig>, runtime: ProductRuntime) -> PathBuf {
    let app_data_dir = product_app_data_dir(config, runtime);
    let default = app_data_dir.join(JOBS_DIR_NAME);
    config
        .map(|config| resolve_path_ref(default.clone(), &config.paths.result_library_dir))
        .unwrap_or(default)
}

pub fn product_default_export_dir(config: Option<&AppConfig>, runtime: ProductRuntime) -> PathBuf {
    let app_data_dir = product_app_data_dir(config, runtime);
    let result_library_dir = product_result_library_dir(config, runtime);
    let Some(export_dir) = config.map(|config| &config.paths.default_export_dir) else {
        return default_product_export_dir(runtime, &app_data_dir);
    };
    match export_dir.mode {
        ExportDirMode::Custom => export_dir
            .path
            .as_ref()
            .filter(|path| !path.as_os_str().is_empty())
            .cloned()
            .unwrap_or_else(|| default_product_export_dir(runtime, &app_data_dir)),
        ExportDirMode::Documents => dirs::document_dir()
            .unwrap_or_else(|| app_data_dir.join(EXPORTS_DIR_NAME))
            .join("GPT Image 2"),
        ExportDirMode::Pictures => dirs::picture_dir()
            .unwrap_or_else(|| app_data_dir.join(EXPORTS_DIR_NAME))
            .join("GPT Image 2"),
        ExportDirMode::ResultLibrary => result_library_dir,
        ExportDirMode::BrowserDefault | ExportDirMode::Downloads => {
            default_product_export_dir(runtime, &app_data_dir)
        }
    }
}

pub fn product_storage_fallback_dir(
    config: Option<&AppConfig>,
    runtime: ProductRuntime,
) -> PathBuf {
    product_app_data_dir(config, runtime)
        .join("storage")
        .join("fallback")
}

pub fn legacy_shared_codex_dir(config: Option<&AppConfig>) -> PathBuf {
    config
        .map(|config| expand_pathbuf_tilde(&config.paths.legacy_shared_codex_dir.path))
        .unwrap_or_else(default_legacy_shared_codex_path)
}

pub fn legacy_jobs_dir(config: Option<&AppConfig>) -> PathBuf {
    legacy_shared_codex_dir(config).join(JOBS_DIR_NAME)
}

pub(crate) fn cli_config_path(cli: &Cli) -> PathBuf {
    cli.config
        .as_deref()
        .map(expand_tilde)
        .unwrap_or_else(default_config_path)
}

pub(crate) fn resolve_codex_home() -> PathBuf {
    if let Some(value) = std::env::var_os("CODEX_HOME")
        && !value.is_empty()
    {
        return PathBuf::from(value);
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".codex")
}

pub(crate) fn expand_tilde(value: &str) -> PathBuf {
    if value == "~" {
        return dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    }
    if let Some(rest) = value.strip_prefix("~/") {
        return dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(rest);
    }
    PathBuf::from(value)
}

pub(crate) fn expand_pathbuf_tilde(path: &Path) -> PathBuf {
    path.to_str()
        .map(expand_tilde)
        .unwrap_or_else(|| path.to_path_buf())
}
