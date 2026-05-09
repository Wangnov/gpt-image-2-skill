#![allow(unused_imports)]

use super::*;

#[tauri::command]
pub(crate) fn config_path() -> Value {
    let config = load_config_or_default();
    let app_data_dir = product_app_data_dir(Some(&config), ProductRuntime::Tauri);
    let result_library_dir = product_result_library_dir(Some(&config), ProductRuntime::Tauri);
    let default_export_dir = product_default_export_dir(Some(&config), ProductRuntime::Tauri);
    let default_export_dirs = product_default_export_dirs(&config, ProductRuntime::Tauri)
        .into_iter()
        .map(|(mode, path)| (mode, path.display().to_string()))
        .collect::<BTreeMap<_, _>>();
    let legacy_codex_config_dir = legacy_shared_codex_dir(Some(&config));
    let legacy_jobs_dir = legacy_jobs_dir(Some(&config));
    let storage_fallback_dir = product_storage_fallback_dir(Some(&config), ProductRuntime::Tauri);
    json!({
        "config_dir": shared_config_dir().display().to_string(),
        "config_file": default_config_path().display().to_string(),
        "history_file": history_db_path().display().to_string(),
        "jobs_dir": result_library_dir.display().to_string(),
        "app_data_dir": app_data_dir.display().to_string(),
        "result_library_dir": result_library_dir.display().to_string(),
        "default_export_dir": default_export_dir.display().to_string(),
        "default_export_dirs": default_export_dirs,
        "storage_fallback_dir": storage_fallback_dir.display().to_string(),
        "legacy_codex_config_dir": legacy_codex_config_dir.display().to_string(),
        "legacy_jobs_dir": legacy_jobs_dir.display().to_string(),
    })
}

#[tauri::command]
pub(crate) fn get_config() -> Result<Value, String> {
    let config = load_config()?;
    Ok(config_for_ui(&config))
}

#[tauri::command]
pub(crate) fn update_notifications(mut config: NotificationConfig) -> Result<Value, String> {
    let mut app_config = load_config()?;
    preserve_notification_secrets(&mut config, &app_config.notifications);
    app_config.notifications = config;
    save_config(&app_config)?;
    Ok(config_for_ui(&app_config))
}

#[tauri::command]
pub(crate) fn update_paths(config: PathConfig) -> Result<Value, String> {
    validate_path_config_for_save(&config)?;
    let mut app_config = load_config()?;
    app_config.paths = config;
    save_config(&app_config)?;
    Ok(config_for_ui(&app_config))
}

#[tauri::command]
pub(crate) fn update_storage(mut config: StorageConfig) -> Result<Value, String> {
    let mut app_config = load_config()?;
    preserve_storage_secrets(&mut config, &app_config.storage);
    app_config.storage = config;
    save_config(&app_config)?;
    Ok(config_for_ui(&app_config))
}

#[tauri::command]
pub(crate) fn test_storage_target(
    name: String,
    target: Option<StorageTargetConfig>,
) -> Result<Value, String> {
    let config = load_config()?;
    let owned_target;
    let target = if let Some(target) = target {
        let mut storage = StorageConfig {
            targets: BTreeMap::from([(name.clone(), target)]),
            ..StorageConfig::default()
        };
        preserve_storage_secrets(&mut storage, &config.storage);
        owned_target = storage
            .targets
            .remove(&name)
            .ok_or_else(|| format!("Unknown storage target: {name}"))?;
        &owned_target
    } else {
        config
            .storage
            .targets
            .get(&name)
            .ok_or_else(|| format!("Unknown storage target: {name}"))?
    };
    Ok(json!(gpt_image_2_core::test_storage_target(&name, target)))
}

#[derive(Deserialize)]
pub(crate) struct NotificationTestInput {
    #[serde(default)]
    status: Option<String>,
}

#[tauri::command]
pub(crate) fn test_notifications(input: NotificationTestInput) -> Result<Value, String> {
    let config = load_config()?;
    let status = input.status.as_deref().unwrap_or("completed");
    let job = json!({
        "id": "notification-test",
        "command": "images generate",
        "provider": config.default_provider.as_deref().unwrap_or("test"),
        "status": status,
        "created_at": chrono_like_now(),
        "updated_at": chrono_like_now(),
        "metadata": {"prompt": "Notification test"},
        "outputs": [],
        "output_path": Value::Null,
        "error": if status == "failed" { json!({"message": "Notification test failure"}) } else { Value::Null },
    });
    let deliveries = dispatch_task_notifications(&config.notifications, &job);
    // dispatch_task_notifications only fires server channels (email/webhook).
    // Toast and system notifications are delivered client-side, so a wholly
    // empty deliveries vec is OK as long as the config still has a local
    // channel that would fire for this status — surface that with a
    // distinct `local_only` reason instead of treating it as "nothing sent".
    let local_eligible = config.notifications.enabled
        && notification_status_allowed(&config.notifications, status)
        && (config.notifications.toast.enabled || config.notifications.system.enabled);
    let (ok, reason) = if !deliveries.is_empty() {
        (deliveries.iter().all(|delivery| delivery.ok), None)
    } else if local_eligible {
        (true, Some("local_only"))
    } else {
        (false, Some("no_eligible_channel"))
    };
    Ok(json!({
        "ok": ok,
        "reason": reason,
        "deliveries": deliveries.into_iter().map(|delivery| {
            json!({
                "channel": delivery.channel,
                "name": delivery.name,
                "ok": delivery.ok,
                "message": delivery.message,
            })
        }).collect::<Vec<_>>(),
    }))
}

#[tauri::command]
pub(crate) fn notification_capabilities() -> Value {
    json!({
        "system": {
            "tauri_native": true,
            "browser": true,
        },
        "server": {
            "email": true,
            "webhook": true,
        }
    })
}

#[tauri::command]
pub(crate) fn config_inspect() -> Result<Value, String> {
    let path = default_config_path();
    let config = load_app_config(&path).map_err(app_error)?;
    Ok(json!({
        "config_file": path.display().to_string(),
        "exists": path.is_file(),
        "config": config_for_ui(&config),
    }))
}

#[tauri::command]
pub(crate) fn config_save(config: AppConfig) -> Result<Value, String> {
    save_config(&config)?;
    Ok(json!({
        "ok": true,
        "config_file": default_config_path().display().to_string(),
        "config": config_for_ui(&config),
    }))
}

#[tauri::command]
pub(crate) fn set_default_provider(name: String) -> Result<Value, String> {
    let mut config = load_config()?;
    if !matches!(name.as_str(), "auto" | "openai" | "codex")
        && !config.providers.contains_key(&name)
    {
        return Err(format!("Unknown provider: {name}"));
    }
    config.default_provider = Some(name);
    save_config(&config)?;
    Ok(config_for_ui(&config))
}

#[tauri::command]
pub(crate) fn upsert_provider(name: String, cfg: ProviderInput) -> Result<Value, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("凭证名称不能为空。".to_string());
    }
    let mut config = load_config()?;
    let allow_overwrite = cfg.allow_overwrite;
    if name == "auto"
        || (!allow_overwrite
            && (matches!(name.as_str(), "openai" | "codex")
                || config.providers.contains_key(&name)))
    {
        return Err(format!("凭证「{name}」已存在，已配置的凭证不能覆盖。"));
    }
    let existing = config.providers.get(&name).cloned();
    let (provider, set_default) = convert_provider_input(&name, cfg, existing.as_ref())?;
    config.providers.insert(name.clone(), provider);
    if set_default || config.default_provider.is_none() {
        config.default_provider = Some(name);
    }
    save_config(&config)?;
    Ok(config_for_ui(&config))
}

#[tauri::command]
pub(crate) fn reveal_provider_credential(
    name: String,
    credential: String,
) -> Result<Value, String> {
    let config = load_config()?;
    let value = if let Some(provider) = config.providers.get(&name) {
        let credential_ref = provider
            .credentials
            .get(&credential)
            .ok_or_else(|| format!("凭证「{name}」没有 {credential}。"))?;
        match credential_ref {
            CredentialRef::File { value } => value.clone(),
            CredentialRef::Env { env } => {
                std::env::var(env).map_err(|_| format!("环境变量 {env} 当前不可用或为空。"))?
            }
            CredentialRef::Keychain { service, account } => {
                let service = service.as_deref().unwrap_or(KEYCHAIN_SERVICE);
                read_keychain_secret(service, account).map_err(app_error)?
            }
        }
    } else if name == "openai" && credential == "api_key" {
        std::env::var("OPENAI_API_KEY")
            .map_err(|_| "环境变量 OPENAI_API_KEY 当前不可用或为空。".to_string())?
    } else {
        return Err(format!("凭证「{name}」还没有保存可查看的密钥。"));
    };

    if value.trim().is_empty() {
        return Err(format!("凭证「{name}」的 {credential} 是空的。"));
    }

    Ok(json!({ "value": value }))
}

#[tauri::command]
pub(crate) fn delete_provider(name: String) -> Result<Value, String> {
    let mut config = load_config()?;
    config.providers.remove(&name);
    if config.default_provider.as_deref() == Some(name.as_str()) {
        config.default_provider = None;
    }
    save_config(&config)?;
    Ok(config_for_ui(&config))
}

#[tauri::command]
pub(crate) fn provider_test(name: String) -> Value {
    let started = SystemTime::now();
    let payload = cli_json(&["--provider".to_string(), name.clone(), "doctor".to_string()]);
    let latency_ms = started.elapsed().unwrap_or_default().as_millis();
    let ok = payload.get("ok").and_then(Value::as_bool).unwrap_or(false);
    let message = if ok {
        "连接正常".to_string()
    } else {
        payload
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
            .or_else(|| {
                payload
                    .get("provider_selection")
                    .and_then(|selection| selection.get("error"))
                    .and_then(|error| error.get("message"))
                    .and_then(Value::as_str)
            })
            .unwrap_or("连接失败")
            .to_string()
    };
    json!({
        "ok": ok,
        "latency_ms": latency_ms,
        "message": message,
        "detail": payload,
    })
}
