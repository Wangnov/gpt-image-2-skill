#![allow(unused_imports)]

use super::*;

pub(crate) fn app_error(error: gpt_image_2_core::AppError) -> String {
    format!("{}: {}", error.code, error.message)
}

pub(crate) fn load_config_or_default() -> AppConfig {
    load_config().unwrap_or_default()
}

pub(crate) fn normalize_product_storage_defaults(config: &mut AppConfig) {
    let fallback_dir = product_storage_fallback_dir(Some(config), ProductRuntime::DockerWeb);
    if let Some(StorageTargetConfig::Local { directory, .. }) =
        config.storage.targets.get_mut("local-default")
    {
        if *directory == shared_config_dir().join("storage").join("fallback")
            || directory.as_os_str().is_empty()
        {
            *directory = fallback_dir;
        }
    }
}

pub(crate) fn load_config() -> Result<AppConfig, String> {
    let mut config = load_app_config(&default_config_path()).map_err(app_error)?;
    normalize_product_storage_defaults(&mut config);
    Ok(config)
}

pub(crate) fn save_config(config: &AppConfig) -> Result<(), String> {
    save_app_config(&default_config_path(), config).map_err(app_error)
}

pub(crate) fn result_library_dir() -> PathBuf {
    product_result_library_dir(Some(&load_config_or_default()), ProductRuntime::DockerWeb)
}

pub(crate) fn allowed_data_roots() -> Vec<PathBuf> {
    if let Ok(value) = std::env::var("GPT_IMAGE_2_ALLOWED_DATA_ROOTS") {
        let roots = value
            .split(',')
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(PathBuf::from)
            .collect::<Vec<_>>();
        if !roots.is_empty() {
            return roots;
        }
    }
    vec![product_app_data_dir(
        Some(&load_config_or_default()),
        ProductRuntime::DockerWeb,
    )]
}

pub(crate) fn path_under_allowed_root(path: &FsPath) -> bool {
    // Walk up to the first ancestor we can canonicalize — that's where
    // create_dir_all will start creating directories, so it's the location
    // we actually need to confine. Falling back to the raw user path here
    // is unsafe: a path like `/data/gpt-image-2/../outside/newdir` would
    // pass `starts_with("/data/gpt-image-2")` lexically while
    // create_dir_all would resolve the `..` and write outside the root.
    let mut probe = path.to_path_buf();
    loop {
        if let Ok(canonical) = probe.canonicalize() {
            return allowed_data_roots().into_iter().any(|root| {
                let root = root.canonicalize().unwrap_or(root);
                canonical.starts_with(&root)
            });
        }
        if !probe.pop() {
            return false;
        }
    }
}

pub(crate) fn validate_server_writable_dir(path: &FsPath, label: &str) -> Result<(), String> {
    if !path_under_allowed_root(path) {
        return Err(format!(
            "{label} 必须位于 GPT_IMAGE_2_ALLOWED_DATA_ROOTS 允许的目录内。"
        ));
    }
    fs::create_dir_all(path).map_err(|error| format!("无法创建{label}：{error}"))?;
    let probe = path.join(".gpt-image-2-path-test");
    fs::write(&probe, b"ok").map_err(|error| format!("{label}不可写：{error}"))?;
    let _ = fs::remove_file(&probe);
    Ok(())
}

pub(crate) fn validate_path_config_for_save(config: &PathConfig) -> Result<(), String> {
    if config.app_data_dir.mode == gpt_image_2_core::PathMode::Custom {
        return Err("Docker Web 的应用数据根目录请通过 GPT_IMAGE_2_DATA_DIR 配置。".to_string());
    }
    if config.result_library_dir.mode == gpt_image_2_core::PathMode::Custom {
        let path = config
            .result_library_dir
            .path
            .as_ref()
            .ok_or_else(|| "自定义结果库目录不能为空。".to_string())?;
        validate_server_writable_dir(path, "结果库目录")?;
    }
    if config.default_export_dir.mode == gpt_image_2_core::ExportDirMode::Custom {
        let path = config
            .default_export_dir
            .path
            .as_ref()
            .ok_or_else(|| "自定义导出目录不能为空。".to_string())?;
        validate_server_writable_dir(path, "导出目录")?;
    }
    Ok(())
}

pub(crate) fn config_for_ui(config: &AppConfig) -> Value {
    let mut payload = redact_app_config(config);
    if let Some(providers) = payload.get_mut("providers").and_then(Value::as_object_mut) {
        for (name, provider) in &config.providers {
            if let Some(mode) = &provider.edit_region_mode
                && let Some(entry) = providers.get_mut(name).and_then(Value::as_object_mut)
            {
                entry.insert("edit_region_mode".to_string(), json!(mode));
            }
        }
        providers.entry("codex".to_string()).or_insert_with(|| {
            json!({
                "type": "codex",
                "model": "gpt-5.4",
                "supports_n": false,
                "credentials": {},
                "builtin": true,
                "edit_region_mode": "reference-hint",
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
                "edit_region_mode": "native-mask",
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

pub(crate) fn cli_json_result(args: &[String]) -> Result<Value, String> {
    let mut argv = vec!["gpt-image-2-skill".to_string(), "--json".to_string()];
    argv.extend(args.iter().cloned());
    let outcome = run_json(&argv);
    if outcome.exit_status == 0 {
        Ok(outcome.payload)
    } else {
        Err(outcome
            .payload
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("Command failed")
            .to_string())
    }
}
