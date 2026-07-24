#![allow(unused_imports)]

use super::*;
pub(crate) use gpt_image_2_runtime::{cli_json_result, error_value_from_message};

pub(crate) fn default_result_library_mode() -> gpt_image_2_core::ExportDirMode {
    gpt_image_2_core::ExportDirMode::ResultLibrary
}

pub(crate) fn sync_result_library_to_default_export_dir(config: &mut PathConfig) {
    let preview = AppConfig {
        paths: config.clone(),
        ..Default::default()
    };
    let save_dir = product_default_export_dir(Some(&preview), ProductRuntime::Tauri);
    config.result_library_dir.mode = gpt_image_2_core::PathMode::Custom;
    config.result_library_dir.path = Some(save_dir);
}

pub(crate) fn allow_result_library_asset_scope(app: &tauri::AppHandle) {
    let path = result_library_dir();
    if let Err(error) = app.asset_protocol_scope().allow_directory(&path, true) {
        eprintln!(
            "failed to allow result directory asset scope {}: {error}",
            path.display()
        );
    }
}

pub(crate) fn app_error(error: gpt_image_2_core::AppError) -> String {
    format!("{}: {}", error.code, error.message)
}

pub(crate) fn load_config() -> Result<AppConfig, String> {
    let mut config = load_app_config(&default_config_path()).map_err(app_error)?;
    normalize_product_storage_defaults(&mut config);
    Ok(config)
}

pub(crate) fn save_config(config: &AppConfig) -> Result<(), String> {
    save_app_config(&default_config_path(), config).map_err(app_error)
}

pub(crate) fn normalize_product_storage_defaults(config: &mut AppConfig) {
    let fallback_dir = product_storage_fallback_dir(Some(config), ProductRuntime::Tauri);
    if let Some(StorageTargetConfig::Local { directory, .. }) =
        config.storage.targets.get_mut("local-default")
        && (*directory == shared_config_dir().join("storage").join("fallback")
            || directory.as_os_str().is_empty())
    {
        *directory = fallback_dir;
    }
    if matches!(
        config.paths.default_export_dir.mode,
        gpt_image_2_core::ExportDirMode::Downloads
            | gpt_image_2_core::ExportDirMode::BrowserDefault
    ) && config.paths.result_library_dir.mode == gpt_image_2_core::PathMode::Default
    {
        config.paths.default_export_dir.mode = default_result_library_mode();
        config.paths.default_export_dir.path = None;
    }
}

pub(crate) fn load_config_or_default() -> AppConfig {
    load_config().unwrap_or_default()
}

pub(crate) fn read_job_output_for_product(
    job_id: &str,
    output_index: usize,
    rehydrate_local_cache: bool,
) -> Result<StorageReadback, String> {
    let config = load_config()?;
    let job = show_history_job(job_id).map_err(app_error)?;
    let local_cache_roots = local_cache_roots_for_product(&config);
    read_job_output_from_storage_with_options(
        &config.storage,
        &job,
        output_index,
        StorageReadbackOptions {
            allow_archive_fallback: true,
            rehydrate_local_cache,
            local_cache_roots,
        },
    )
    .map_err(app_error)
}

pub(crate) fn local_cache_roots_for_product(config: &AppConfig) -> Vec<PathBuf> {
    let mut roots = vec![product_result_library_dir(
        Some(config),
        ProductRuntime::Tauri,
    )];
    if config.paths.legacy_shared_codex_dir.enabled_for_read {
        roots.push(legacy_jobs_dir(Some(config)));
    }
    roots.push(std::env::temp_dir());
    roots
}

pub(crate) fn history_output_indexes(job: &Value) -> Vec<usize> {
    let mut indexes = job
        .get("outputs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|output| {
            output
                .get("index")
                .and_then(Value::as_u64)
                .and_then(|value| usize::try_from(value).ok())
        })
        .collect::<Vec<_>>();
    indexes.sort_unstable();
    indexes.dedup();
    if indexes.is_empty() && job.get("output_path").and_then(Value::as_str).is_some() {
        indexes.push(0);
    }
    indexes
}

pub(crate) fn history_output_label(index: usize) -> String {
    if index < 26 {
        char::from(b'A' + u8::try_from(index).unwrap_or(0)).to_string()
    } else {
        format!("#{}", index + 1)
    }
}

pub(crate) fn rehydrate_history_job_outputs_for_export(job: &Value) -> Result<(), String> {
    let Some(job_id) = job.get("id").and_then(Value::as_str) else {
        return Ok(());
    };
    let mut failures = Vec::new();
    for output_index in history_output_indexes(job) {
        if let Err(error) = read_job_output_for_product(job_id, output_index, true) {
            failures.push(format!(
                "候选 {}：{}",
                history_output_label(output_index),
                error
            ));
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "远端图片不可用，无法导出整个任务。{}",
            failures.join("；")
        ))
    }
}

pub(crate) fn result_library_dir() -> PathBuf {
    product_result_library_dir(Some(&load_config_or_default()), ProductRuntime::Tauri)
}

pub(crate) fn default_export_dir() -> PathBuf {
    product_default_export_dir(Some(&load_config_or_default()), ProductRuntime::Tauri)
}

pub(crate) fn validate_writable_dir(path: &Path, label: &str) -> Result<(), String> {
    if path.as_os_str().is_empty() {
        return Err(format!("{label}不能为空。"));
    }
    fs::create_dir_all(path).map_err(|error| format!("无法创建{label}：{error}"))?;
    let probe = path.join(".gpt-image-2-path-test");
    fs::write(&probe, b"ok").map_err(|error| format!("{label}不可写：{error}"))?;
    let _ = fs::remove_file(&probe);
    Ok(())
}

pub(crate) fn validate_path_config_for_save(config: &PathConfig) -> Result<(), String> {
    if config.paths_app_data_custom() {
        return Err("应用数据目录暂不支持在界面中修改。".to_string());
    }
    if config.default_export_dir.mode == gpt_image_2_core::ExportDirMode::Custom {
        let path = config
            .default_export_dir
            .path
            .as_ref()
            .ok_or_else(|| "自定义保存文件夹不能为空。".to_string())?;
        validate_writable_dir(path, "图片保存位置")?;
    }
    if config.paths_result_library_custom() {
        let path = config
            .result_library_dir
            .path
            .as_ref()
            .ok_or_else(|| "自定义图片保存位置不能为空。".to_string())?;
        validate_writable_dir(path, "图片保存位置")?;
    }
    Ok(())
}

trait PathConfigExt {
    fn paths_app_data_custom(&self) -> bool;
    fn paths_result_library_custom(&self) -> bool;
}

impl PathConfigExt for PathConfig {
    fn paths_app_data_custom(&self) -> bool {
        self.app_data_dir.mode == gpt_image_2_core::PathMode::Custom
    }
    fn paths_result_library_custom(&self) -> bool {
        self.result_library_dir.mode == gpt_image_2_core::PathMode::Custom
    }
}

pub(crate) fn config_for_ui(config: &AppConfig) -> Value {
    let mut payload = redact_app_config(config);
    if let Some(providers) = payload.get_mut("providers").and_then(Value::as_object_mut) {
        providers.entry("codex".to_string()).or_insert_with(|| {
            json!({
                "type": "codex",
                "model": "gpt-5.4",
                "supports_n": false,
                "credentials": {},
                "builtin": true,
                "supports_n": false,
                "edit_region_mode": "reference-hint",
                "preset": "custom",
                "image_transport": "openai-sync",
            })
        });
        providers.entry("openai".to_string()).or_insert_with(|| {
            json!({
                "type": "openai-compatible",
                "api_base": "https://api.openai.com/v1",
                "model": "gpt-image-2",
                "supports_n": true,
                "credentials": {
                    "api_key": {"source": "env", "env": "OPENAI_API_KEY"}
                },
                "builtin": true,
                "supports_n": true,
                "edit_region_mode": "native-mask",
                "preset": "openai",
                "image_transport": "openai-sync",
            })
        });
    }
    payload
}

pub(crate) fn dispatch_notifications_for_job(job: &Value) -> Vec<Value> {
    let config = match load_config() {
        Ok(config) => config,
        Err(error) => {
            eprintln!("notification config load failed: {error}");
            return Vec::new();
        }
    };
    let deliveries = dispatch_task_notifications(&config.notifications, job);
    for delivery in &deliveries {
        if !delivery.ok {
            eprintln!(
                "notification delivery failed: channel={} name={} message={}",
                delivery.channel, delivery.name, delivery.message
            );
        }
    }
    deliveries
        .into_iter()
        .map(|delivery| {
            json!({
                "channel": delivery.channel,
                "name": delivery.name,
                "ok": delivery.ok,
                "message": delivery.message,
            })
        })
        .collect()
}

pub(crate) fn cli_json(args: &[String]) -> Value {
    let mut argv = vec!["gpt-image-2-skill".to_string(), "--json".to_string()];
    argv.extend(args.iter().cloned());
    run_json(&argv).payload
}
