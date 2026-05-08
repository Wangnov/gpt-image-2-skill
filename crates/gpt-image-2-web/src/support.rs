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
    let deliveries = dispatch_task_notifications(&config, job);
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
