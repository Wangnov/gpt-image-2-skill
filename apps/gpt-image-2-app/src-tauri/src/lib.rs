use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use gpt_image_2_core::{
    AppConfig, CredentialRef, KEYCHAIN_SERVICE, ProviderConfig, default_config_path,
    default_keychain_account, history_db_path, jobs_dir, list_history_jobs, load_app_config,
    redact_app_config, run_json, save_app_config, shared_config_dir, show_history_job,
    write_keychain_secret,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

fn app_error(error: gpt_image_2_core::AppError) -> String {
    format!("{}: {}", error.code, error.message)
}

fn load_config() -> Result<AppConfig, String> {
    load_app_config(&default_config_path()).map_err(app_error)
}

fn save_config(config: &AppConfig) -> Result<(), String> {
    save_app_config(&default_config_path(), config).map_err(app_error)
}

fn config_for_ui(config: &AppConfig) -> Value {
    let mut payload = redact_app_config(config);
    if let Some(providers) = payload.get_mut("providers").and_then(Value::as_object_mut) {
        providers.entry("codex".to_string()).or_insert_with(|| {
            json!({
                "type": "codex",
                "model": "gpt-5.4",
                "credentials": {},
                "builtin": true,
            })
        });
        providers.entry("openai".to_string()).or_insert_with(|| {
            json!({
                "type": "openai-compatible",
                "api_base": "https://api.openai.com/v1",
                "model": "gpt-image-2",
                "credentials": {
                    "api_key": {"source": "env", "env": "OPENAI_API_KEY"}
                },
                "builtin": true,
            })
        });
    }
    payload
}

fn cli_json(args: &[String]) -> Value {
    let mut argv = vec!["gpt-image-2-skill".to_string(), "--json".to_string()];
    argv.extend(args.iter().cloned());
    run_json(&argv).payload
}

fn cli_json_result(args: &[String]) -> Result<Value, String> {
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

#[derive(Debug, Deserialize)]
struct ProviderInput {
    #[serde(rename = "type")]
    provider_type: String,
    #[serde(default)]
    api_base: Option<String>,
    #[serde(default)]
    endpoint: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    credentials: BTreeMap<String, CredentialInput>,
    #[serde(default)]
    set_default: bool,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "source", rename_all = "lowercase")]
enum CredentialInput {
    File {
        #[serde(default)]
        value: Option<String>,
    },
    Env {
        env: String,
    },
    Keychain {
        #[serde(default)]
        service: Option<String>,
        #[serde(default)]
        account: Option<String>,
        #[serde(default)]
        value: Option<String>,
    },
}

#[derive(Debug, Deserialize, Serialize)]
struct GenerateRequest {
    prompt: String,
    #[serde(default)]
    provider: Option<String>,
    #[serde(default)]
    size: Option<String>,
    #[serde(default)]
    format: Option<String>,
    #[serde(default)]
    quality: Option<String>,
    #[serde(default)]
    background: Option<String>,
    #[serde(default)]
    n: Option<u8>,
    #[serde(default)]
    compression: Option<u8>,
    #[serde(default)]
    moderation: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UploadFile {
    name: String,
    bytes: Vec<u8>,
}

#[derive(Debug, Deserialize)]
struct EditRequest {
    prompt: String,
    #[serde(default)]
    provider: Option<String>,
    #[serde(default)]
    size: Option<String>,
    #[serde(default)]
    format: Option<String>,
    #[serde(default)]
    quality: Option<String>,
    #[serde(default)]
    background: Option<String>,
    #[serde(default)]
    n: Option<u8>,
    #[serde(default)]
    compression: Option<u8>,
    #[serde(default)]
    input_fidelity: Option<String>,
    #[serde(default)]
    moderation: Option<String>,
    refs: Vec<UploadFile>,
    #[serde(default)]
    mask: Option<UploadFile>,
}

fn convert_provider_input(
    name: &str,
    input: ProviderInput,
) -> Result<(ProviderConfig, bool), String> {
    let mut credentials = BTreeMap::new();
    for (secret, credential) in input.credentials {
        let converted = match credential {
            CredentialInput::File { value } => CredentialRef::File {
                value: value.unwrap_or_default(),
            },
            CredentialInput::Env { env } => CredentialRef::Env { env },
            CredentialInput::Keychain {
                service,
                account,
                value,
            } => {
                let service = service.unwrap_or_else(|| KEYCHAIN_SERVICE.to_string());
                let account = account.unwrap_or_else(|| default_keychain_account(name, &secret));
                if let Some(value) = value
                    && !value.is_empty()
                {
                    write_keychain_secret(&service, &account, &value).map_err(app_error)?;
                }
                CredentialRef::Keychain {
                    service: Some(service),
                    account,
                }
            }
        };
        credentials.insert(secret, converted);
    }
    Ok((
        ProviderConfig {
            provider_type: input.provider_type,
            api_base: input.api_base,
            endpoint: input.endpoint,
            model: input.model,
            credentials,
        },
        input.set_default,
    ))
}

fn unique_job_dir() -> Result<(String, PathBuf), String> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let id = format!("app-{millis}-{}", std::process::id());
    let dir = jobs_dir().join(&id);
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok((id, dir))
}

fn push_optional(args: &mut Vec<String>, flag: &str, value: Option<&str>) {
    if let Some(value) = value
        && !value.is_empty()
        && value != "auto"
    {
        args.push(flag.to_string());
        args.push(value.to_string());
    }
}

fn output_extension(format: Option<&str>) -> &str {
    match format {
        Some("jpeg") => "jpg",
        Some("webp") => "webp",
        _ => "png",
    }
}

fn provider_accepts_multiple_outputs(provider: Option<&str>) -> bool {
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
        Some(name) => config
            .as_ref()
            .and_then(|config| config.providers.get(name))
            .map(|provider| provider.provider_type != "codex")
            .unwrap_or(true),
        None => true,
    }
}

fn job_from_payload(payload: &Value, fallback_id: &str, command: &str, request: Value) -> Value {
    let job_id = payload
        .get("history")
        .and_then(|history| history.get("job_id"))
        .and_then(Value::as_str)
        .unwrap_or(fallback_id);
    let output = payload.get("output").cloned().unwrap_or_else(|| json!({}));
    let output_path = output.get("path").and_then(Value::as_str).or_else(|| {
        output
            .get("files")
            .and_then(Value::as_array)
            .and_then(|files| files.first())
            .and_then(|file| file.get("path"))
            .and_then(Value::as_str)
    });
    json!({
        "id": job_id,
        "command": command,
        "provider": payload.get("provider").cloned().unwrap_or(Value::Null),
        "status": if payload.get("ok").and_then(Value::as_bool).unwrap_or(false) { "completed" } else { "failed" },
        "created_at": chrono_like_now(),
        "updated_at": chrono_like_now(),
        "metadata": request,
        "outputs": output.get("files").cloned().unwrap_or_else(|| json!([])),
        "output_path": output_path,
        "error": payload.get("error").cloned(),
    })
}

fn chrono_like_now() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{secs}")
}

#[tauri::command]
fn config_path() -> Value {
    json!({
        "config_dir": shared_config_dir().display().to_string(),
        "config_file": default_config_path().display().to_string(),
        "history_file": history_db_path().display().to_string(),
        "jobs_dir": jobs_dir().display().to_string(),
    })
}

#[tauri::command]
fn get_config() -> Result<Value, String> {
    let config = load_config()?;
    Ok(config_for_ui(&config))
}

#[tauri::command]
fn config_inspect() -> Result<Value, String> {
    let path = default_config_path();
    let config = load_app_config(&path).map_err(app_error)?;
    Ok(json!({
        "config_file": path.display().to_string(),
        "exists": path.is_file(),
        "config": config_for_ui(&config),
    }))
}

#[tauri::command]
fn config_save(config: AppConfig) -> Result<Value, String> {
    save_config(&config)?;
    Ok(json!({
        "ok": true,
        "config_file": default_config_path().display().to_string(),
        "config": config_for_ui(&config),
    }))
}

#[tauri::command]
fn set_default_provider(name: String) -> Result<Value, String> {
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
fn upsert_provider(name: String, cfg: ProviderInput) -> Result<Value, String> {
    let (provider, set_default) = convert_provider_input(&name, cfg)?;
    let mut config = load_config()?;
    config.providers.insert(name.clone(), provider);
    if set_default || config.default_provider.is_none() {
        config.default_provider = Some(name);
    }
    save_config(&config)?;
    Ok(config_for_ui(&config))
}

#[tauri::command]
fn delete_provider(name: String) -> Result<Value, String> {
    let mut config = load_config()?;
    config.providers.remove(&name);
    if config.default_provider.as_deref() == Some(name.as_str()) {
        config.default_provider = None;
    }
    save_config(&config)?;
    Ok(config_for_ui(&config))
}

#[tauri::command]
fn provider_test(name: String) -> Value {
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

#[tauri::command]
fn history_list() -> Result<Value, String> {
    Ok(json!({
        "history_file": history_db_path().display().to_string(),
        "jobs": list_history_jobs().map_err(app_error)?,
    }))
}

#[tauri::command]
fn history_show(job_id: String) -> Result<Value, String> {
    Ok(json!({
        "history_file": history_db_path().display().to_string(),
        "job": show_history_job(&job_id).map_err(app_error)?,
        "events": [],
    }))
}

#[tauri::command]
fn history_delete(job_id: String) -> Result<Value, String> {
    cli_json_result(&["history".to_string(), "delete".to_string(), job_id])
}

#[tauri::command]
async fn generate_image(request: GenerateRequest) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if request.prompt.trim().is_empty() {
            return Err("Prompt is required.".to_string());
        }
        let (fallback_id, dir) = unique_job_dir()?;
        let out = dir.join(format!(
            "out.{}",
            output_extension(request.format.as_deref())
        ));
        let mut args = Vec::new();
        if let Some(provider) = request.provider.as_deref()
            && !provider.is_empty()
        {
            args.push("--provider".to_string());
            args.push(provider.to_string());
        }
        args.extend([
            "images".to_string(),
            "generate".to_string(),
            "--prompt".to_string(),
            request.prompt.clone(),
            "--out".to_string(),
            out.display().to_string(),
        ]);
        push_optional(&mut args, "--size", request.size.as_deref());
        push_optional(&mut args, "--format", request.format.as_deref());
        push_optional(&mut args, "--quality", request.quality.as_deref());
        push_optional(&mut args, "--background", request.background.as_deref());
        push_optional(&mut args, "--moderation", request.moderation.as_deref());
        if provider_accepts_multiple_outputs(request.provider.as_deref())
            && let Some(n) = request.n
        {
            args.push("--n".to_string());
            args.push(n.to_string());
        }
        if let Some(compression) = request.compression {
            args.push("--compression".to_string());
            args.push(compression.to_string());
        }
        let payload = cli_json_result(&args)?;
        let request_meta = serde_json::to_value(&request).unwrap_or_else(|_| json!({}));
        let job = job_from_payload(&payload, &fallback_id, "images generate", request_meta);
        Ok(json!({
            "job_id": job.get("id").cloned().unwrap_or(Value::Null),
            "job": job,
            "events": [{
                "seq": 1,
                "kind": "local",
                "type": "job.completed",
                "data": {"status": "completed", "output": payload.get("output")}
            }],
            "payload": payload,
        }))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn edit_image(request: EditRequest) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if request.prompt.trim().is_empty() {
            return Err("Prompt is required.".to_string());
        }
        if request.refs.is_empty() {
            return Err("At least one reference image is required.".to_string());
        }
        let (fallback_id, dir) = unique_job_dir()?;
        let out = dir.join(format!(
            "out.{}",
            output_extension(request.format.as_deref())
        ));
        let mut ref_paths = Vec::new();
        for (index, upload) in request.refs.iter().enumerate() {
            let ext = Path::new(&upload.name)
                .extension()
                .and_then(|ext| ext.to_str())
                .unwrap_or("png");
            let path = dir.join(format!("ref-{index}.{ext}"));
            fs::write(&path, &upload.bytes).map_err(|error| error.to_string())?;
            ref_paths.push(path);
        }
        let mask_path = if let Some(mask) = &request.mask {
            let path = dir.join("mask.png");
            fs::write(&path, &mask.bytes).map_err(|error| error.to_string())?;
            Some(path)
        } else {
            None
        };
        let mut args = Vec::new();
        if let Some(provider) = request.provider.as_deref()
            && !provider.is_empty()
        {
            args.push("--provider".to_string());
            args.push(provider.to_string());
        }
        args.extend([
            "images".to_string(),
            "edit".to_string(),
            "--prompt".to_string(),
            request.prompt.clone(),
            "--out".to_string(),
            out.display().to_string(),
        ]);
        for path in &ref_paths {
            args.push("--ref-image".to_string());
            args.push(path.display().to_string());
        }
        if let Some(path) = &mask_path {
            args.push("--mask".to_string());
            args.push(path.display().to_string());
        }
        push_optional(&mut args, "--size", request.size.as_deref());
        push_optional(&mut args, "--format", request.format.as_deref());
        push_optional(&mut args, "--quality", request.quality.as_deref());
        push_optional(&mut args, "--background", request.background.as_deref());
        push_optional(
            &mut args,
            "--input-fidelity",
            request.input_fidelity.as_deref(),
        );
        push_optional(&mut args, "--moderation", request.moderation.as_deref());
        if provider_accepts_multiple_outputs(request.provider.as_deref())
            && let Some(n) = request.n
        {
            args.push("--n".to_string());
            args.push(n.to_string());
        }
        if let Some(compression) = request.compression {
            args.push("--compression".to_string());
            args.push(compression.to_string());
        }
        let payload = cli_json_result(&args)?;
        let request_meta = json!({
            "prompt": request.prompt,
            "provider": request.provider,
            "size": request.size,
            "format": request.format,
            "quality": request.quality,
            "background": request.background,
            "n": request.n,
            "compression": request.compression,
            "input_fidelity": request.input_fidelity,
            "moderation": request.moderation,
            "ref_count": request.refs.len(),
            "has_mask": request.mask.is_some(),
        });
        let job = job_from_payload(&payload, &fallback_id, "images edit", request_meta);
        Ok(json!({
            "job_id": job.get("id").cloned().unwrap_or(Value::Null),
            "job": job,
            "events": [{
                "seq": 1,
                "kind": "local",
                "type": "job.completed",
                "data": {"status": "completed", "output": payload.get("output")}
            }],
            "payload": payload,
        }))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn reveal_path(path: String) -> bool {
    Path::new(&path).exists()
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            config_path,
            get_config,
            config_inspect,
            config_save,
            set_default_provider,
            upsert_provider,
            delete_provider,
            provider_test,
            history_list,
            history_show,
            history_delete,
            generate_image,
            edit_image,
            reveal_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running gpt-image-2-app");
}
