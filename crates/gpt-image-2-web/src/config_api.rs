#![allow(unused_imports)]

use super::*;

#[derive(Deserialize)]
pub(crate) struct DefaultProviderBody {
    pub(crate) name: String,
}

#[derive(Deserialize)]
pub(crate) struct QueueConcurrencyBody {
    pub(crate) max_parallel: usize,
}

#[derive(Deserialize)]
pub(crate) struct FileQuery {
    pub(crate) path: String,
}

pub(crate) async fn config_paths() -> Json<Value> {
    let config = load_config_or_default();
    let app_data_dir = product_app_data_dir(Some(&config), ProductRuntime::DockerWeb);
    let result_library_dir = product_result_library_dir(Some(&config), ProductRuntime::DockerWeb);
    let default_export_dir = product_default_export_dir(Some(&config), ProductRuntime::DockerWeb);
    let default_export_dirs = product_default_export_dirs(&config, ProductRuntime::DockerWeb)
        .into_iter()
        .map(|(mode, path)| (mode, path.display().to_string()))
        .collect::<BTreeMap<_, _>>();
    let legacy_codex_config_dir = legacy_shared_codex_dir(Some(&config));
    let legacy_jobs_dir = legacy_jobs_dir(Some(&config));
    let storage_fallback_dir =
        product_storage_fallback_dir(Some(&config), ProductRuntime::DockerWeb);
    Json(json!({
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
    }))
}

pub(crate) async fn get_config() -> ApiResult {
    load_config()
        .map(|config| Json(config_for_ui(&config)))
        .map_err(ApiError::internal)
}

pub(crate) async fn update_notifications(Json(mut body): Json<NotificationConfig>) -> ApiResult {
    let mut config = load_config().map_err(ApiError::internal)?;
    preserve_notification_secrets(&mut body, &config.notifications);
    config.notifications = body;
    save_config(&config).map_err(ApiError::internal)?;
    Ok(Json(config_for_ui(&config)))
}

pub(crate) async fn update_paths(Json(body): Json<PathConfig>) -> ApiResult {
    validate_path_config_for_save(&body).map_err(ApiError::bad_request)?;
    let mut config = load_config().map_err(ApiError::internal)?;
    config.paths = body;
    save_config(&config).map_err(ApiError::internal)?;
    Ok(Json(config_for_ui(&config)))
}

pub(crate) async fn update_storage(Json(mut body): Json<StorageConfig>) -> ApiResult {
    let mut config = load_config().map_err(ApiError::internal)?;
    preserve_storage_secrets(&mut body, &config.storage);
    config.storage = body;
    save_config(&config).map_err(ApiError::internal)?;
    Ok(Json(config_for_ui(&config)))
}

#[derive(Deserialize)]
pub(crate) struct StorageTestBody {
    #[serde(default)]
    pub(crate) target: Option<StorageTargetConfig>,
}

pub(crate) async fn test_storage(
    Path(name): Path<String>,
    Json(body): Json<StorageTestBody>,
) -> ApiResult {
    let config = load_config().map_err(ApiError::internal)?;
    let owned_target;
    let target = if let Some(target) = body.target {
        let mut storage = StorageConfig {
            targets: BTreeMap::from([(name.clone(), target)]),
            ..StorageConfig::default()
        };
        preserve_storage_secrets(&mut storage, &config.storage);
        owned_target = storage
            .targets
            .remove(&name)
            .ok_or_else(|| ApiError::bad_request(format!("Unknown storage target: {name}")))?;
        &owned_target
    } else {
        config
            .storage
            .targets
            .get(&name)
            .ok_or_else(|| ApiError::bad_request(format!("Unknown storage target: {name}")))?
    };
    let name_for_test = name.clone();
    let target_for_test = target.clone();
    let result = tokio::task::spawn_blocking(move || {
        json!(test_storage_target(&name_for_test, &target_for_test))
    })
    .await
    .map_err(|error| ApiError::internal(format!("Storage test task failed: {error}")))?;
    Ok(Json(result))
}

#[derive(Deserialize)]
pub(crate) struct NotificationTestBody {
    #[serde(default)]
    pub(crate) status: Option<String>,
}

pub(crate) async fn test_notifications(Json(body): Json<NotificationTestBody>) -> ApiResult {
    let config = load_config().map_err(ApiError::internal)?;
    let status = body.status.as_deref().unwrap_or("completed");
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
    Ok(Json(json!({
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
    })))
}

pub(crate) async fn notification_capabilities() -> Json<Value> {
    Json(json!({
        "system": {
            "tauri_native": false,
            "browser": true,
        },
        "server": {
            "email": true,
            "webhook": true,
        }
    }))
}

pub(crate) async fn set_default_provider(Json(body): Json<DefaultProviderBody>) -> ApiResult {
    let mut config = load_config().map_err(ApiError::internal)?;
    if !matches!(body.name.as_str(), "auto" | "openai" | "codex")
        && !config.providers.contains_key(&body.name)
    {
        return Err(ApiError::bad_request(format!(
            "Unknown provider: {}",
            body.name
        )));
    }
    config.default_provider = Some(body.name);
    save_config(&config).map_err(ApiError::internal)?;
    Ok(Json(config_for_ui(&config)))
}

pub(crate) async fn upsert_provider(
    Path(name): Path<String>,
    Json(cfg): Json<ProviderInput>,
) -> ApiResult {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(ApiError::bad_request("凭证名称不能为空。"));
    }
    let mut config = load_config().map_err(ApiError::internal)?;
    let allow_overwrite = cfg.allow_overwrite;
    if name == "auto"
        || (!allow_overwrite
            && (matches!(name.as_str(), "openai" | "codex")
                || config.providers.contains_key(&name)))
    {
        return Err(ApiError::bad_request(format!(
            "凭证「{name}」已存在，已配置的凭证不能覆盖。"
        )));
    }
    let existing = config.providers.get(&name).cloned();
    let (provider, set_default) =
        convert_provider_input(&name, cfg, existing.as_ref()).map_err(ApiError::bad_request)?;
    config.providers.insert(name.clone(), provider);
    if set_default || config.default_provider.is_none() {
        config.default_provider = Some(name);
    }
    save_config(&config).map_err(ApiError::internal)?;
    Ok(Json(config_for_ui(&config)))
}

pub(crate) async fn reveal_provider_credential(
    Path((name, credential)): Path<(String, String)>,
) -> ApiResult {
    let config = load_config().map_err(ApiError::internal)?;
    let value = if let Some(provider) = config.providers.get(&name) {
        let credential_ref = provider
            .credentials
            .get(&credential)
            .ok_or_else(|| ApiError::bad_request(format!("凭证「{name}」没有 {credential}。")))?;
        match credential_ref {
            CredentialRef::File { value } => value.clone(),
            CredentialRef::Env { env } => std::env::var(env)
                .map_err(|_| ApiError::bad_request(format!("环境变量 {env} 当前不可用或为空。")))?,
            CredentialRef::Keychain { service, account } => {
                let service = service.as_deref().unwrap_or(KEYCHAIN_SERVICE);
                read_keychain_secret(service, account)
                    .map_err(app_error)
                    .map_err(ApiError::bad_request)?
            }
        }
    } else if name == "openai" && credential == "api_key" {
        std::env::var("OPENAI_API_KEY")
            .map_err(|_| ApiError::bad_request("环境变量 OPENAI_API_KEY 当前不可用或为空。"))?
    } else {
        return Err(ApiError::bad_request(format!(
            "凭证「{name}」还没有保存可查看的密钥。"
        )));
    };

    if value.trim().is_empty() {
        return Err(ApiError::bad_request(format!(
            "凭证「{name}」的 {credential} 是空的。"
        )));
    }

    Ok(Json(json!({ "value": value })))
}

pub(crate) async fn delete_provider(Path(name): Path<String>) -> ApiResult {
    let mut config = load_config().map_err(ApiError::internal)?;
    config.providers.remove(&name);
    if config.default_provider.as_deref() == Some(name.as_str()) {
        config.default_provider = None;
    }
    save_config(&config).map_err(ApiError::internal)?;
    Ok(Json(config_for_ui(&config)))
}

pub(crate) async fn provider_test(Path(name): Path<String>) -> Json<Value> {
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
    Json(json!({
        "ok": ok,
        "latency_ms": latency_ms,
        "message": message,
        "detail": payload,
    }))
}
