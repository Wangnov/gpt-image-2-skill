use std::{
    collections::{BTreeMap, VecDeque},
    env, fs,
    path::{Path as FsPath, PathBuf},
    sync::{Arc, Mutex, mpsc},
    thread,
    time::{SystemTime, UNIX_EPOCH},
};

use axum::{
    Json, Router,
    body::Body,
    extract::{Path, Query, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post, put},
};
use gpt_image_2_core::{
    AppConfig, CONFIG_DIR_NAME, CredentialRef, HistoryListOptions, KEYCHAIN_SERVICE,
    NotificationConfig, ProviderConfig, default_config_path, default_keychain_account,
    delete_history_job, dispatch_task_notifications, history_db_path, jobs_dir,
    list_active_history_jobs, list_history_jobs_page, load_app_config, notification_status_allowed,
    preserve_notification_secrets, read_keychain_secret, redact_app_config, run_json,
    save_app_config, shared_config_dir, show_history_job, upsert_history_job,
    write_keychain_secret,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tower_http::services::{ServeDir, ServeFile};

type ApiResult<T = Value> = Result<Json<T>, ApiError>;

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
        }
    }

    fn internal(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: message.into(),
        }
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: message.into(),
        }
    }

    fn forbidden(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            message: message.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(json!({
                "error": {
                    "message": self.message,
                }
            })),
        )
            .into_response()
    }
}

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

fn dispatch_notifications_for_job(job: &Value) -> Vec<Value> {
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
    supports_n: Option<bool>,
    #[serde(default)]
    edit_region_mode: Option<String>,
    #[serde(default)]
    set_default: bool,
    #[serde(default)]
    allow_overwrite: bool,
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

#[derive(Debug, Clone, Deserialize, Serialize)]
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

#[derive(Debug, Clone, Deserialize)]
struct UploadFile {
    name: String,
    bytes: Vec<u8>,
}

#[derive(Debug, Clone, Deserialize)]
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
    #[serde(default)]
    selection_hint: Option<UploadFile>,
}

#[derive(Clone)]
struct JobQueueState {
    inner: Arc<Mutex<JobQueueInner>>,
}

impl Default for JobQueueState {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(JobQueueInner {
                max_parallel: 2,
                running: 0,
                queue: VecDeque::new(),
                events: BTreeMap::new(),
                next_seq: BTreeMap::new(),
            })),
        }
    }
}

struct JobQueueInner {
    max_parallel: usize,
    running: usize,
    queue: VecDeque<QueuedJob>,
    events: BTreeMap<String, Vec<Value>>,
    next_seq: BTreeMap<String, u64>,
}

#[derive(Clone)]
enum QueuedTask {
    Generate(GenerateRequest),
    Edit(EditRequest),
}

#[derive(Clone)]
struct QueuedJob {
    id: String,
    command: String,
    provider: String,
    created_at: String,
    dir: PathBuf,
    metadata: Value,
    task: QueuedTask,
}

fn convert_provider_input(
    name: &str,
    input: ProviderInput,
    existing: Option<&ProviderConfig>,
) -> Result<(ProviderConfig, bool), String> {
    let mut credentials = BTreeMap::new();
    for (secret, credential) in input.credentials {
        let existing_credential = existing.and_then(|provider| provider.credentials.get(&secret));
        let converted = match credential {
            CredentialInput::File { value } => {
                let next = value.unwrap_or_default();
                if next.is_empty()
                    && let Some(CredentialRef::File { value }) = existing_credential
                {
                    CredentialRef::File {
                        value: value.clone(),
                    }
                } else {
                    CredentialRef::File { value: next }
                }
            }
            CredentialInput::Env { env } => CredentialRef::Env { env },
            CredentialInput::Keychain {
                service,
                account,
                value,
            } => {
                let service = service
                    .or_else(|| {
                        if let Some(CredentialRef::Keychain { service, .. }) = existing_credential {
                            service.clone()
                        } else {
                            None
                        }
                    })
                    .unwrap_or_else(|| KEYCHAIN_SERVICE.to_string());
                let account = account
                    .or_else(|| {
                        if let Some(CredentialRef::Keychain { account, .. }) = existing_credential {
                            Some(account.clone())
                        } else {
                            None
                        }
                    })
                    .unwrap_or_else(|| default_keychain_account(name, &secret));
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
            supports_n: input.supports_n,
            edit_region_mode: input.edit_region_mode,
        },
        input.set_default,
    ))
}

fn unique_job_dir() -> Result<(String, PathBuf), String> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let id = format!("web-{millis}-{}", std::process::id());
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

fn provider_supports_n(provider: Option<&str>) -> bool {
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

fn provider_edit_region_mode(provider: Option<&str>) -> String {
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

fn selected_provider_name(provider: Option<&str>) -> String {
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

fn requested_n(n: Option<u8>) -> Result<u8, String> {
    let requested = n.unwrap_or(1);
    if requested == 0 {
        return Err("Output count must be at least 1.".to_string());
    }
    Ok(requested.min(16))
}

fn push_provider_arg(args: &mut Vec<String>, provider: Option<&str>) {
    if let Some(provider) = provider
        && !provider.trim().is_empty()
    {
        args.push("--provider".to_string());
        args.push(provider.to_string());
    }
}

fn generate_args(request: &GenerateRequest, out: &FsPath, include_n: bool) -> Vec<String> {
    let mut args = Vec::new();
    push_provider_arg(&mut args, request.provider.as_deref());
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
    if include_n && let Some(n) = request.n {
        args.push("--n".to_string());
        args.push(n.to_string());
    }
    if let Some(compression) = request.compression {
        args.push("--compression".to_string());
        args.push(compression.to_string());
    }
    args
}

fn edit_args(
    request: &EditRequest,
    ref_paths: &[PathBuf],
    mask_path: Option<&FsPath>,
    out: &FsPath,
    include_n: bool,
) -> Vec<String> {
    let mut args = Vec::new();
    push_provider_arg(&mut args, request.provider.as_deref());
    args.extend([
        "images".to_string(),
        "edit".to_string(),
        "--prompt".to_string(),
        request.prompt.clone(),
        "--out".to_string(),
        out.display().to_string(),
    ]);
    for path in ref_paths {
        args.push("--ref-image".to_string());
        args.push(path.display().to_string());
    }
    if let Some(path) = mask_path {
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
    if include_n && let Some(n) = request.n {
        args.push("--n".to_string());
        args.push(n.to_string());
    }
    if let Some(compression) = request.compression {
        args.push("--compression".to_string());
        args.push(compression.to_string());
    }
    args
}

fn batch_output_path(dir: &FsPath, format: Option<&str>, index: u8) -> PathBuf {
    dir.join(format!("out-{}.{}", index + 1, output_extension(format)))
}

fn collect_history_ids(payload: &Value) -> Vec<String> {
    let mut ids = Vec::new();
    if let Some(id) = payload
        .get("history")
        .and_then(|history| history.get("job_id"))
        .and_then(Value::as_str)
        && !id.is_empty()
    {
        ids.push(id.to_string());
    }
    if let Some(job_ids) = payload
        .get("history")
        .and_then(|history| history.get("job_ids"))
        .and_then(Value::as_array)
    {
        for id in job_ids.iter().filter_map(Value::as_str) {
            if !id.is_empty() && !ids.iter().any(|existing| existing == id) {
                ids.push(id.to_string());
            }
        }
    }
    ids
}

fn output_files_from_payload(payload: &Value) -> Vec<Value> {
    let output = payload.get("output").cloned().unwrap_or_else(|| json!({}));
    let mut files = output
        .get("files")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if files.is_empty()
        && let Some(path) = output.get("path").and_then(Value::as_str)
    {
        files.push(json!({
            "index": 0,
            "path": path,
            "bytes": output.get("bytes").and_then(Value::as_u64).unwrap_or(0),
        }));
    }
    files
}

fn normalize_batch_output(files: Vec<Value>) -> Value {
    let indexed_files = files
        .into_iter()
        .enumerate()
        .map(|(index, mut file)| {
            if let Value::Object(object) = &mut file {
                object.insert("index".to_string(), json!(index));
            }
            file
        })
        .collect::<Vec<_>>();
    let total_bytes = indexed_files
        .iter()
        .filter_map(|file| file.get("bytes").and_then(Value::as_u64))
        .sum::<u64>();
    let primary_path = indexed_files
        .first()
        .and_then(|file| file.get("path"))
        .cloned()
        .unwrap_or(Value::Null);
    json!({
        "path": primary_path,
        "bytes": total_bytes,
        "files": indexed_files,
    })
}

fn merge_batch_payloads(command: &str, payloads: Vec<Value>) -> Value {
    let first = payloads.first().cloned().unwrap_or_else(|| json!({}));
    let files = payloads
        .iter()
        .flat_map(output_files_from_payload)
        .collect::<Vec<_>>();
    let mut history_job_ids = Vec::new();
    let mut revised_prompts = Vec::new();

    for payload in &payloads {
        history_job_ids.extend(collect_history_ids(payload));
        if let Some(prompts) = payload
            .get("response")
            .and_then(|response| response.get("revised_prompts"))
            .and_then(Value::as_array)
        {
            revised_prompts.extend(prompts.iter().cloned());
        }
    }

    history_job_ids.sort();
    history_job_ids.dedup();
    let primary_history_job_id = history_job_ids.first().cloned();
    let output = normalize_batch_output(files);
    let image_count = output
        .get("files")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0);
    let mut response = first.get("response").cloned().unwrap_or_else(|| json!({}));
    if let Value::Object(response) = &mut response {
        response.insert("image_count".to_string(), json!(image_count));
        response.insert("batch_count".to_string(), json!(payloads.len()));
        response.insert("batch_request_count".to_string(), json!(payloads.len()));
        response.insert("revised_prompts".to_string(), json!(revised_prompts));
    }

    json!({
        "ok": true,
        "command": command,
        "provider": first.get("provider").cloned().unwrap_or(Value::Null),
        "provider_selection": first.get("provider_selection").cloned().unwrap_or(Value::Null),
        "auth": first.get("auth").cloned().unwrap_or(Value::Null),
        "request": first.get("request").cloned().unwrap_or(Value::Null),
        "response": response,
        "output": output,
        "history": {
            "job_id": primary_history_job_id,
            "job_ids": history_job_ids,
        },
        "batch": {
            "mode": "parallel-single-output",
            "request_count": payloads.len(),
        },
        "events": {
            "count": payloads.len(),
        }
    })
}

fn cleanup_child_history(payload: &Value, app_job_id: &str) {
    for id in collect_history_ids(payload) {
        if id != app_job_id {
            let _ = delete_history_job(&id);
        }
    }
}

fn output_path_from_payload(payload: &Value) -> Option<String> {
    payload
        .get("output")
        .and_then(|output| output.get("path"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .or_else(|| {
            payload
                .get("output")
                .and_then(|output| output.get("files"))
                .and_then(Value::as_array)
                .and_then(|files| files.first())
                .and_then(|file| file.get("path"))
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
}

fn job_snapshot(
    id: &str,
    command: &str,
    provider: &str,
    status: &str,
    created_at: &str,
    metadata: Value,
    output_path: Option<String>,
    outputs: Value,
    error: Value,
) -> Value {
    json!({
        "id": id,
        "command": command,
        "provider": provider,
        "status": status,
        "created_at": created_at,
        "updated_at": chrono_like_now(),
        "metadata": metadata,
        "outputs": outputs,
        "output_path": output_path,
        "error": error,
    })
}

fn append_updated_at(metadata: &mut Value) {
    if let Value::Object(object) = metadata {
        object.insert("updated_at".to_string(), json!(chrono_like_now()));
    }
}

fn persist_job(job: &Value) -> Result<(), String> {
    let id = job
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "Job id is missing.".to_string())?;
    let command = job
        .get("command")
        .and_then(Value::as_str)
        .unwrap_or("images generate");
    let provider = job
        .get("provider")
        .and_then(Value::as_str)
        .unwrap_or("auto");
    let status = job
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("queued");
    let created_at = job.get("created_at").and_then(Value::as_str);
    let output_path = job
        .get("output_path")
        .and_then(Value::as_str)
        .map(PathBuf::from);
    let mut metadata = job.get("metadata").cloned().unwrap_or_else(|| json!({}));
    append_updated_at(&mut metadata);
    if let Value::Object(object) = &mut metadata {
        if let Some(outputs) = job.get("outputs")
            && !outputs.is_null()
        {
            object.insert(
                "output".to_string(),
                json!({
                    "path": job.get("output_path").cloned().unwrap_or(Value::Null),
                    "files": outputs,
                }),
            );
        }
        if let Some(error) = job.get("error")
            && !error.is_null()
        {
            object.insert("error".to_string(), error.clone());
        }
    }
    upsert_history_job(
        id,
        command,
        provider,
        status,
        output_path.as_deref(),
        created_at,
        metadata,
    )
    .map_err(app_error)
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

fn queue_snapshot_locked(inner: &JobQueueInner) -> Value {
    json!({
        "max_parallel": inner.max_parallel,
        "running": inner.running,
        "queued": inner.queue.len(),
        "queued_job_ids": inner.queue.iter().map(|job| job.id.clone()).collect::<Vec<_>>(),
    })
}

fn append_queue_event(
    inner: &mut JobQueueInner,
    job_id: &str,
    kind: &str,
    event_type: &str,
    data: Value,
) -> Value {
    let seq = inner.next_seq.entry(job_id.to_string()).or_insert(0);
    *seq += 1;
    let event = json!({
        "seq": *seq,
        "kind": kind,
        "type": event_type,
        "data": data,
    });
    let events = inner.events.entry(job_id.to_string()).or_default();
    events.push(event.clone());
    if events.len() > 200 {
        events.remove(0);
    }
    event
}

#[derive(Clone)]
struct StreamContext {
    state: JobQueueState,
    job_id: String,
    command: String,
    provider: String,
    created_at: String,
    metadata: Value,
}

fn run_payloads_concurrently_streaming(
    arg_sets: Vec<Vec<String>>,
    mut on_partial: impl FnMut(usize, &Value),
) -> Result<Vec<Value>, String> {
    let total = arg_sets.len();
    if total == 0 {
        return Ok(Vec::new());
    }
    let (tx, rx) = mpsc::channel::<(usize, Result<Value, String>)>();
    for (index, args) in arg_sets.into_iter().enumerate() {
        let tx = tx.clone();
        thread::spawn(move || {
            let result = cli_json_result(&args);
            let _ = tx.send((index, result));
        });
    }
    drop(tx);
    let mut results: Vec<Option<Value>> = (0..total).map(|_| None).collect();
    let mut errors = Vec::new();
    let mut received = 0usize;
    while received < total {
        match rx.recv() {
            Ok((index, Ok(payload))) => {
                on_partial(index, &payload);
                results[index] = Some(payload);
            }
            Ok((_, Err(error))) => errors.push(error),
            Err(_) => break,
        }
        received += 1;
    }
    if !errors.is_empty() {
        return Err(errors.join("; "));
    }
    Ok(results.into_iter().flatten().collect())
}

fn apply_partial_output(
    ctx: &StreamContext,
    partials: &mut Vec<Value>,
    batch_index: usize,
    payload: &Value,
) {
    for id in collect_history_ids(payload) {
        if id != ctx.job_id {
            let _ = delete_history_job(&id);
        }
    }

    let files = output_files_from_payload(payload);
    for mut file in files {
        if let Value::Object(map) = &mut file {
            map.insert("index".to_string(), json!(batch_index));
        }
        partials.push(file);
    }

    let mut sorted_outputs = partials.clone();
    sorted_outputs.sort_by_key(|value| {
        value
            .get("index")
            .and_then(Value::as_u64)
            .unwrap_or(u64::MAX)
    });
    let first_path = sorted_outputs
        .iter()
        .find(|file| file.get("index").and_then(Value::as_u64) == Some(0))
        .and_then(|file| file.get("path"))
        .and_then(Value::as_str)
        .map(ToString::to_string);

    let parent_snapshot = job_snapshot(
        &ctx.job_id,
        &ctx.command,
        &ctx.provider,
        "running",
        &ctx.created_at,
        ctx.metadata.clone(),
        first_path,
        json!(sorted_outputs),
        Value::Null,
    );
    let _ = persist_job(&parent_snapshot);

    let payload_path = payload
        .get("output")
        .and_then(|output| output.get("path"))
        .cloned()
        .unwrap_or(Value::Null);

    let Ok(mut inner) = ctx.state.inner.lock() else {
        return;
    };
    append_queue_event(
        &mut inner,
        &ctx.job_id,
        "local",
        "job.output_ready",
        json!({
            "index": batch_index,
            "path": payload_path,
            "job": parent_snapshot,
        }),
    );
}

fn run_generate_request(
    mut request: GenerateRequest,
    fallback_id: String,
    dir: PathBuf,
    stream: Option<StreamContext>,
) -> Result<Value, String> {
    if request.prompt.trim().is_empty() {
        return Err("Prompt is required.".to_string());
    }
    let output_count = requested_n(request.n)?;
    if request.n.is_some() {
        request.n = Some(output_count);
    }
    let provider_supports_n = provider_supports_n(request.provider.as_deref());
    let payload = if provider_supports_n || output_count == 1 {
        let out = dir.join(format!(
            "out.{}",
            output_extension(request.format.as_deref())
        ));
        cli_json_result(&generate_args(&request, &out, provider_supports_n))?
    } else {
        let arg_sets = (0..output_count)
            .map(|index| {
                generate_args(
                    &request,
                    &batch_output_path(&dir, request.format.as_deref(), index),
                    false,
                )
            })
            .collect::<Vec<_>>();
        let partials = Arc::new(Mutex::new(Vec::<Value>::new()));
        let partials_for_cb = partials.clone();
        let stream_for_cb = stream.clone();
        let payloads = run_payloads_concurrently_streaming(arg_sets, move |index, payload| {
            if let Some(ctx) = &stream_for_cb {
                let mut list = partials_for_cb
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                apply_partial_output(ctx, &mut list, index, payload);
            }
        })?;
        merge_batch_payloads("images generate", payloads)
    };
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
}

fn write_edit_inputs(
    request: &EditRequest,
    dir: &FsPath,
) -> Result<(Vec<PathBuf>, Option<PathBuf>, String), String> {
    let mut ref_paths = Vec::new();
    for (index, upload) in request.refs.iter().enumerate() {
        let ext = FsPath::new(&upload.name)
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
    let selection_hint_path = if let Some(hint) = &request.selection_hint {
        let path = dir.join("selection-hint.png");
        fs::write(&path, &hint.bytes).map_err(|error| error.to_string())?;
        Some(path)
    } else {
        None
    };
    let edit_region_mode = edit_region_mode_for_request(request);
    if edit_region_mode == "none" && (mask_path.is_some() || selection_hint_path.is_some()) {
        return Err("当前凭证不支持局部编辑。请切换到「多图参考」或更换凭证。".to_string());
    }
    if edit_region_mode == "reference-hint"
        && let Some(path) = &selection_hint_path
    {
        ref_paths.push(path.clone());
    }
    Ok((ref_paths, mask_path, edit_region_mode))
}

fn edit_region_mode_for_request(request: &EditRequest) -> String {
    if request.mask.is_some() || request.selection_hint.is_some() {
        provider_edit_region_mode(request.provider.as_deref())
    } else {
        "none".to_string()
    }
}

fn edit_request_metadata(request: &EditRequest) -> Value {
    let edit_region_mode = edit_region_mode_for_request(request);
    json!({
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
        "selection_hint": request.selection_hint.is_some(),
        "edit_region_mode": edit_region_mode,
    })
}

fn run_edit_request(
    mut request: EditRequest,
    fallback_id: String,
    dir: PathBuf,
    stream: Option<StreamContext>,
) -> Result<Value, String> {
    if request.prompt.trim().is_empty() {
        return Err("Prompt is required.".to_string());
    }
    if request.refs.is_empty() {
        return Err("At least one reference image is required.".to_string());
    }
    let output_count = requested_n(request.n)?;
    if request.n.is_some() {
        request.n = Some(output_count);
    }
    let (ref_paths, mask_path, edit_region_mode) = write_edit_inputs(&request, &dir)?;
    let provider_supports_n = provider_supports_n(request.provider.as_deref());
    let payload = if provider_supports_n || output_count == 1 {
        let out = dir.join(format!(
            "out.{}",
            output_extension(request.format.as_deref())
        ));
        cli_json_result(&edit_args(
            &request,
            &ref_paths,
            if edit_region_mode == "native-mask" {
                mask_path.as_deref()
            } else {
                None
            },
            &out,
            provider_supports_n,
        ))?
    } else {
        let arg_sets = (0..output_count)
            .map(|index| {
                edit_args(
                    &request,
                    &ref_paths,
                    if edit_region_mode == "native-mask" {
                        mask_path.as_deref()
                    } else {
                        None
                    },
                    &batch_output_path(&dir, request.format.as_deref(), index),
                    false,
                )
            })
            .collect::<Vec<_>>();
        let partials = Arc::new(Mutex::new(Vec::<Value>::new()));
        let partials_for_cb = partials.clone();
        let stream_for_cb = stream.clone();
        let payloads = run_payloads_concurrently_streaming(arg_sets, move |index, payload| {
            if let Some(ctx) = &stream_for_cb {
                let mut list = partials_for_cb
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                apply_partial_output(ctx, &mut list, index, payload);
            }
        })?;
        merge_batch_payloads("images edit", payloads)
    };
    let request_meta = edit_request_metadata(&request);
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
}

fn completed_job_for_queue(queued: &QueuedJob, response: &Value) -> Value {
    let payload = response.get("payload").unwrap_or(response);
    let provider = payload
        .get("provider")
        .and_then(Value::as_str)
        .unwrap_or(&queued.provider);
    let outputs = payload
        .get("output")
        .and_then(|output| output.get("files"))
        .cloned()
        .or_else(|| {
            response
                .get("job")
                .and_then(|job| job.get("outputs"))
                .cloned()
        })
        .unwrap_or_else(|| json!([]));
    let output_path = output_path_from_payload(payload).or_else(|| {
        response
            .get("job")
            .and_then(|job| job.get("output_path"))
            .and_then(Value::as_str)
            .map(ToString::to_string)
    });
    job_snapshot(
        &queued.id,
        &queued.command,
        provider,
        "completed",
        &queued.created_at,
        queued.metadata.clone(),
        output_path,
        outputs,
        Value::Null,
    )
}

fn failed_job_for_queue(queued: &QueuedJob, message: String) -> Value {
    job_snapshot(
        &queued.id,
        &queued.command,
        &queued.provider,
        "failed",
        &queued.created_at,
        queued.metadata.clone(),
        None,
        json!([]),
        json!({"message": message}),
    )
}

fn finish_queued_job(state: JobQueueState, queued: QueuedJob, result: Result<Value, String>) {
    let (job, event_type, event_data) = match result {
        Ok(response) => {
            let payload = response.get("payload").unwrap_or(&response);
            cleanup_child_history(payload, &queued.id);
            let job = completed_job_for_queue(&queued, &response);
            let data = json!({
                "status": "completed",
                "output": payload.get("output").cloned().unwrap_or(Value::Null),
                "job": job,
            });
            (job, "job.completed", data)
        }
        Err(message) => {
            let job = failed_job_for_queue(&queued, message.clone());
            (
                job,
                "job.failed",
                json!({
                    "status": "failed",
                    "error": {"message": message},
                }),
            )
        }
    };
    let _ = persist_job(&job);
    {
        let mut inner = match state.inner.lock() {
            Ok(inner) => inner,
            Err(_) => return,
        };
        inner.running = inner.running.saturating_sub(1);
        append_queue_event(&mut inner, &queued.id, "local", event_type, event_data);
    }
    spawn_notification_dispatch(state.clone(), queued.id, job);
    start_queued_jobs(state);
}

// Notification I/O (SMTP, webhooks) is blocking and may take seconds. Run it
// off the worker thread so it cannot occupy a queue slot or stall finalization.
fn spawn_notification_dispatch(state: JobQueueState, job_id: String, job: Value) {
    thread::spawn(move || {
        let deliveries = dispatch_notifications_for_job(&job);
        if deliveries.is_empty() {
            return;
        }
        if let Ok(mut inner) = state.inner.lock() {
            append_queue_event(
                &mut inner,
                &job_id,
                "local",
                "job.notifications",
                json!({ "deliveries": deliveries }),
            );
        }
    });
}

fn start_queued_jobs(state: JobQueueState) {
    loop {
        let (queued, running_job) = {
            let mut inner = match state.inner.lock() {
                Ok(inner) => inner,
                Err(_) => return,
            };
            if inner.running >= inner.max_parallel {
                return;
            }
            let Some(queued) = inner.queue.pop_front() else {
                return;
            };
            inner.running += 1;
            let running_job = job_snapshot(
                &queued.id,
                &queued.command,
                &queued.provider,
                "running",
                &queued.created_at,
                queued.metadata.clone(),
                None,
                json!([]),
                Value::Null,
            );
            append_queue_event(
                &mut inner,
                &queued.id,
                "local",
                "job.running",
                json!({"status": "running"}),
            );
            (queued, running_job)
        };
        let _ = persist_job(&running_job);
        let worker_state = state.clone();
        thread::spawn(move || {
            let stream = StreamContext {
                state: worker_state.clone(),
                job_id: queued.id.clone(),
                command: queued.command.clone(),
                provider: queued.provider.clone(),
                created_at: queued.created_at.clone(),
                metadata: queued.metadata.clone(),
            };
            let result = match queued.task.clone() {
                QueuedTask::Generate(request) => run_generate_request(
                    request,
                    queued.id.clone(),
                    queued.dir.clone(),
                    Some(stream),
                ),
                QueuedTask::Edit(request) => {
                    run_edit_request(request, queued.id.clone(), queued.dir.clone(), Some(stream))
                }
            };
            finish_queued_job(worker_state, queued, result);
        });
    }
}

fn enqueue_job(state: JobQueueState, queued: QueuedJob) -> Result<Value, String> {
    let job = job_snapshot(
        &queued.id,
        &queued.command,
        &queued.provider,
        "queued",
        &queued.created_at,
        queued.metadata.clone(),
        None,
        json!([]),
        Value::Null,
    );
    persist_job(&job)?;
    let job_id = queued.id.clone();
    let (event, queue) = {
        let mut inner = state
            .inner
            .lock()
            .map_err(|_| "Job queue lock was poisoned.".to_string())?;
        inner.queue.push_back(queued);
        let position = inner.queue.len();
        let event = append_queue_event(
            &mut inner,
            &job_id,
            "local",
            "job.queued",
            json!({"status": "queued", "position": position}),
        );
        let queue = queue_snapshot_locked(&inner);
        (event, queue)
    };
    start_queued_jobs(state);
    Ok(json!({
        "job_id": job_id,
        "job": job,
        "events": [event],
        "queue": queue,
        "queued": true,
    }))
}

#[derive(Deserialize)]
struct DefaultProviderBody {
    name: String,
}

#[derive(Deserialize)]
struct QueueConcurrencyBody {
    max_parallel: usize,
}

#[derive(Deserialize)]
struct FileQuery {
    path: String,
}

async fn config_paths() -> Json<Value> {
    Json(json!({
        "config_dir": shared_config_dir().display().to_string(),
        "config_file": default_config_path().display().to_string(),
        "history_file": history_db_path().display().to_string(),
        "jobs_dir": jobs_dir().display().to_string(),
    }))
}

async fn get_config() -> ApiResult {
    load_config()
        .map(|config| Json(config_for_ui(&config)))
        .map_err(ApiError::internal)
}

async fn update_notifications(Json(mut body): Json<NotificationConfig>) -> ApiResult {
    let mut config = load_config().map_err(ApiError::internal)?;
    preserve_notification_secrets(&mut body, &config.notifications);
    config.notifications = body;
    save_config(&config).map_err(ApiError::internal)?;
    Ok(Json(config_for_ui(&config)))
}

#[derive(Deserialize)]
struct NotificationTestBody {
    #[serde(default)]
    status: Option<String>,
}

async fn test_notifications(Json(body): Json<NotificationTestBody>) -> ApiResult {
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
    let deliveries = dispatch_task_notifications(&config, &job);
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

async fn notification_capabilities() -> Json<Value> {
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

async fn set_default_provider(Json(body): Json<DefaultProviderBody>) -> ApiResult {
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

async fn upsert_provider(Path(name): Path<String>, Json(cfg): Json<ProviderInput>) -> ApiResult {
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

async fn reveal_provider_credential(Path((name, credential)): Path<(String, String)>) -> ApiResult {
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

async fn delete_provider(Path(name): Path<String>) -> ApiResult {
    let mut config = load_config().map_err(ApiError::internal)?;
    config.providers.remove(&name);
    if config.default_provider.as_deref() == Some(name.as_str()) {
        config.default_provider = None;
    }
    save_config(&config).map_err(ApiError::internal)?;
    Ok(Json(config_for_ui(&config)))
}

async fn provider_test(Path(name): Path<String>) -> Json<Value> {
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

#[derive(Deserialize)]
struct HistoryListQuery {
    limit: Option<usize>,
    cursor: Option<String>,
    status: Option<String>,
    #[serde(alias = "query")]
    q: Option<String>,
}

async fn history_list(Query(query): Query<HistoryListQuery>) -> ApiResult {
    let page = list_history_jobs_page(HistoryListOptions {
        limit: query.limit,
        cursor: query.cursor,
        status: query.status,
        query: query.q,
    })
    .map_err(app_error)
    .map_err(ApiError::internal)?;
    Ok(Json(json!({
        "history_file": history_db_path().display().to_string(),
        "jobs": page.jobs,
        "next_cursor": page.next_cursor,
        "has_more": page.has_more,
        "total": page.total,
    })))
}

async fn history_active_list() -> ApiResult {
    Ok(Json(json!({
        "history_file": history_db_path().display().to_string(),
        "jobs": list_active_history_jobs().map_err(app_error).map_err(ApiError::internal)?,
    })))
}

async fn history_show(Path(job_id): Path<String>, State(state): State<JobQueueState>) -> ApiResult {
    let events = state
        .inner
        .lock()
        .ok()
        .and_then(|inner| inner.events.get(&job_id).cloned())
        .unwrap_or_default();
    Ok(Json(json!({
        "history_file": history_db_path().display().to_string(),
        "job": show_history_job(&job_id).map_err(app_error).map_err(ApiError::not_found)?,
        "events": events,
    })))
}

async fn history_delete(Path(job_id): Path<String>) -> ApiResult {
    let deleted = delete_history_job(&job_id)
        .map_err(app_error)
        .map_err(ApiError::internal)?;
    Ok(Json(json!({
        "ok": true,
        "command": "history delete",
        "job_id": job_id,
        "deleted": deleted,
    })))
}

async fn queue_status(State(state): State<JobQueueState>) -> ApiResult {
    let inner = state
        .inner
        .lock()
        .map_err(|_| ApiError::internal("Job queue lock was poisoned."))?;
    Ok(Json(queue_snapshot_locked(&inner)))
}

async fn set_queue_concurrency(
    State(state): State<JobQueueState>,
    Json(body): Json<QueueConcurrencyBody>,
) -> ApiResult {
    let max_parallel = body.max_parallel.clamp(1, 8);
    let queue = {
        let mut inner = state
            .inner
            .lock()
            .map_err(|_| ApiError::internal("Job queue lock was poisoned."))?;
        inner.max_parallel = max_parallel;
        queue_snapshot_locked(&inner)
    };
    start_queued_jobs(state);
    Ok(Json(queue))
}

async fn cancel_job(Path(job_id): Path<String>, State(state): State<JobQueueState>) -> ApiResult {
    let (queued, event) = {
        let mut inner = state
            .inner
            .lock()
            .map_err(|_| ApiError::internal("Job queue lock was poisoned."))?;
        let Some(position) = inner.queue.iter().position(|job| job.id == job_id) else {
            return Err(ApiError::bad_request(
                "Only queued jobs can be canceled for now.",
            ));
        };
        let queued = inner
            .queue
            .remove(position)
            .ok_or_else(|| ApiError::internal("Queued job was not found."))?;
        let event = append_queue_event(
            &mut inner,
            &job_id,
            "local",
            "job.canceled",
            json!({"status": "canceled"}),
        );
        (queued, event)
    };
    let job = job_snapshot(
        &queued.id,
        &queued.command,
        &queued.provider,
        "canceled",
        &queued.created_at,
        queued.metadata,
        None,
        json!([]),
        Value::Null,
    );
    persist_job(&job).map_err(ApiError::internal)?;
    let notification_deliveries = dispatch_notifications_for_job(&job);
    Ok(Json(json!({
        "job_id": job_id,
        "job": job,
        "events": [{
            "seq": event.get("seq").cloned().unwrap_or(Value::Null),
            "kind": event.get("kind").cloned().unwrap_or(Value::Null),
            "type": event.get("type").cloned().unwrap_or(Value::Null),
            "data": {
                "status": "canceled",
                "notifications": notification_deliveries,
            }
        }],
        "canceled": true,
    })))
}

async fn enqueue_generate_image(
    State(state): State<JobQueueState>,
    Json(request): Json<GenerateRequest>,
) -> ApiResult {
    if request.prompt.trim().is_empty() {
        return Err(ApiError::bad_request("Prompt is required."));
    }
    requested_n(request.n).map_err(ApiError::bad_request)?;
    let (id, dir) = unique_job_dir().map_err(ApiError::internal)?;
    let provider = selected_provider_name(request.provider.as_deref());
    let metadata = serde_json::to_value(&request).unwrap_or_else(|_| json!({}));
    enqueue_job(
        state,
        QueuedJob {
            id,
            command: "images generate".to_string(),
            provider,
            created_at: chrono_like_now(),
            dir,
            metadata,
            task: QueuedTask::Generate(request),
        },
    )
    .map(Json)
    .map_err(ApiError::internal)
}

async fn enqueue_edit_image(
    State(state): State<JobQueueState>,
    Json(request): Json<EditRequest>,
) -> ApiResult {
    if request.prompt.trim().is_empty() {
        return Err(ApiError::bad_request("Prompt is required."));
    }
    if request.refs.is_empty() {
        return Err(ApiError::bad_request(
            "At least one reference image is required.",
        ));
    }
    requested_n(request.n).map_err(ApiError::bad_request)?;
    let (id, dir) = unique_job_dir().map_err(ApiError::internal)?;
    let provider = selected_provider_name(request.provider.as_deref());
    let metadata = edit_request_metadata(&request);
    enqueue_job(
        state,
        QueuedJob {
            id,
            command: "images edit".to_string(),
            provider,
            created_at: chrono_like_now(),
            dir,
            metadata,
            task: QueuedTask::Edit(request),
        },
    )
    .map(Json)
    .map_err(ApiError::internal)
}

fn metadata_object(job: &Value) -> Value {
    job.get("metadata")
        .cloned()
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({}))
}

fn string_field(metadata: &Value, key: &str) -> Option<String> {
    metadata
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn u8_field(metadata: &Value, key: &str) -> Option<u8> {
    metadata
        .get(key)
        .and_then(Value::as_u64)
        .and_then(|value| u8::try_from(value).ok())
}

fn upload_file_from_path(path: &FsPath) -> Result<UploadFile, String> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .map(ToString::to_string)
        .unwrap_or_else(|| "image.png".to_string());
    let bytes = fs::read(path).map_err(|error| format!("读取原始图片失败：{error}"))?;
    Ok(UploadFile { name, bytes })
}

fn generate_request_from_job(job: &Value) -> Result<GenerateRequest, String> {
    let mut request: GenerateRequest =
        serde_json::from_value(metadata_object(job)).map_err(|error| error.to_string())?;
    if request.provider.is_none() {
        request.provider = job
            .get("provider")
            .and_then(Value::as_str)
            .filter(|provider| !provider.is_empty())
            .map(ToString::to_string);
    }
    if request.prompt.trim().is_empty() {
        return Err("这个生成任务缺少 prompt，无法原样重试。".to_string());
    }
    Ok(request)
}

fn sorted_ref_inputs(dir: &FsPath) -> Result<Vec<UploadFile>, String> {
    let mut paths = fs::read_dir(dir)
        .map_err(|error| format!("读取原任务目录失败：{error}"))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with("ref-"))
        })
        .collect::<Vec<_>>();
    paths.sort();
    paths
        .iter()
        .map(|path| upload_file_from_path(path))
        .collect()
}

fn edit_request_from_job(job_id: &str, job: &Value) -> Result<EditRequest, String> {
    let metadata = metadata_object(job);
    let dir = jobs_dir().join(job_id);
    let refs = sorted_ref_inputs(&dir)?;
    if refs.is_empty() {
        return Err("这个编辑任务缺少原始参考图，无法原样重试。".to_string());
    }
    let mask = {
        let path = dir.join("mask.png");
        if path.is_file() {
            Some(upload_file_from_path(&path)?)
        } else {
            None
        }
    };
    let selection_hint = {
        let path = dir.join("selection-hint.png");
        if path.is_file() {
            Some(upload_file_from_path(&path)?)
        } else {
            None
        }
    };
    Ok(EditRequest {
        prompt: string_field(&metadata, "prompt").unwrap_or_default(),
        provider: string_field(&metadata, "provider").or_else(|| {
            job.get("provider")
                .and_then(Value::as_str)
                .filter(|provider| !provider.is_empty())
                .map(ToString::to_string)
        }),
        size: string_field(&metadata, "size"),
        format: string_field(&metadata, "format"),
        quality: string_field(&metadata, "quality"),
        background: string_field(&metadata, "background"),
        n: u8_field(&metadata, "n"),
        compression: u8_field(&metadata, "compression"),
        input_fidelity: string_field(&metadata, "input_fidelity"),
        moderation: string_field(&metadata, "moderation"),
        refs,
        mask,
        selection_hint,
    })
}

async fn retry_job(Path(job_id): Path<String>, State(state): State<JobQueueState>) -> ApiResult {
    let job = show_history_job(&job_id)
        .map_err(app_error)
        .map_err(ApiError::not_found)?;
    match job.get("command").and_then(Value::as_str) {
        Some("images generate") => {
            let request = generate_request_from_job(&job).map_err(ApiError::bad_request)?;
            requested_n(request.n).map_err(ApiError::bad_request)?;
            let (id, dir) = unique_job_dir().map_err(ApiError::internal)?;
            let provider = selected_provider_name(request.provider.as_deref());
            let metadata = serde_json::to_value(&request).unwrap_or_else(|_| json!({}));
            enqueue_job(
                state,
                QueuedJob {
                    id,
                    command: "images generate".to_string(),
                    provider,
                    created_at: chrono_like_now(),
                    dir,
                    metadata,
                    task: QueuedTask::Generate(request),
                },
            )
            .map(Json)
            .map_err(ApiError::internal)
        }
        Some("images edit") => {
            let request = edit_request_from_job(&job_id, &job).map_err(ApiError::bad_request)?;
            if request.prompt.trim().is_empty() {
                return Err(ApiError::bad_request(
                    "这个编辑任务缺少 prompt，无法原样重试。",
                ));
            }
            requested_n(request.n).map_err(ApiError::bad_request)?;
            let (id, dir) = unique_job_dir().map_err(ApiError::internal)?;
            let provider = selected_provider_name(request.provider.as_deref());
            let metadata = edit_request_metadata(&request);
            enqueue_job(
                state,
                QueuedJob {
                    id,
                    command: "images edit".to_string(),
                    provider,
                    created_at: chrono_like_now(),
                    dir,
                    metadata,
                    task: QueuedTask::Edit(request),
                },
            )
            .map(Json)
            .map_err(ApiError::internal)
        }
        _ => Err(ApiError::bad_request("这个任务类型暂不支持重试。")),
    }
}

fn remap_host_codex_app_path(path: &str) -> Option<PathBuf> {
    let marker = format!("/.codex/{CONFIG_DIR_NAME}");
    let marker_index = path.find(&marker)?;
    let suffix = path[marker_index + marker.len()..].trim_start_matches(['/', '\\']);
    let base = shared_config_dir();
    Some(if suffix.is_empty() {
        base
    } else {
        base.join(suffix)
    })
}

fn safe_job_file_path(path: &str) -> Result<PathBuf, ApiError> {
    let requested = remap_host_codex_app_path(path).unwrap_or_else(|| PathBuf::from(path));
    let file = requested
        .canonicalize()
        .map_err(|_| ApiError::not_found("文件不存在，可能已被移动或删除。"))?;
    if !file.is_file() {
        return Err(ApiError::not_found("文件不存在，可能已被移动或删除。"));
    }
    fs::create_dir_all(jobs_dir()).map_err(|error| ApiError::internal(error.to_string()))?;
    let root = jobs_dir()
        .canonicalize()
        .map_err(|error| ApiError::internal(error.to_string()))?;
    if !file.starts_with(&root) {
        return Err(ApiError::forbidden("只能读取当前服务生成的任务文件。"));
    }
    Ok(file)
}

async fn file_response(Query(query): Query<FileQuery>) -> Result<Response, ApiError> {
    let path = safe_job_file_path(&query.path)?;
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|error| ApiError::not_found(error.to_string()))?;
    let mime = mime_guess::from_path(&path).first_or_octet_stream();
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("image.png");
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime.as_ref())
        .header(header::CACHE_CONTROL, "private, max-age=31536000")
        .header(
            header::CONTENT_DISPOSITION,
            format!("inline; filename=\"{file_name}\""),
        )
        .body(Body::from(bytes))
        .map_err(|error| ApiError::internal(error.to_string()))
}

#[derive(Debug)]
struct Settings {
    host: String,
    port: u16,
    static_dir: PathBuf,
}

fn default_static_dir() -> PathBuf {
    if let Ok(value) = env::var("GPT_IMAGE_2_WEB_DIST")
        && !value.trim().is_empty()
    {
        return PathBuf::from(value);
    }
    let repo_dist = PathBuf::from("apps/gpt-image-2-app/dist");
    if repo_dist.is_dir() {
        repo_dist
    } else {
        PathBuf::from("/app/public")
    }
}

fn parse_settings() -> Result<Settings, String> {
    let mut host = env::var("GPT_IMAGE_2_WEB_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let mut port = env::var("GPT_IMAGE_2_WEB_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(8787);
    let mut static_dir = default_static_dir();
    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--host" => {
                host = args
                    .next()
                    .ok_or_else(|| "--host requires a value".to_string())?;
            }
            "--port" => {
                let value = args
                    .next()
                    .ok_or_else(|| "--port requires a value".to_string())?;
                port = value
                    .parse::<u16>()
                    .map_err(|_| "--port must be a number".to_string())?;
            }
            "--static-dir" => {
                static_dir = PathBuf::from(
                    args.next()
                        .ok_or_else(|| "--static-dir requires a value".to_string())?,
                );
            }
            "--help" | "-h" => {
                println!(
                    "Usage: gpt-image-2-web [--host 127.0.0.1] [--port 8787] [--static-dir apps/gpt-image-2-app/dist]"
                );
                std::process::exit(0);
            }
            other => return Err(format!("Unknown argument: {other}")),
        }
    }
    Ok(Settings {
        host,
        port,
        static_dir,
    })
}

fn api_router(state: JobQueueState) -> Router {
    Router::new()
        .route("/config", get(get_config))
        .route("/config-paths", get(config_paths))
        .route("/notifications", put(update_notifications))
        .route("/notifications/test", post(test_notifications))
        .route(
            "/notifications/capabilities",
            get(notification_capabilities),
        )
        .route("/providers/default", post(set_default_provider))
        .route(
            "/providers/{name}",
            put(upsert_provider).delete(delete_provider),
        )
        .route(
            "/providers/{name}/credentials/{credential}",
            get(reveal_provider_credential),
        )
        .route("/providers/{name}/test", post(provider_test))
        .route("/jobs", get(history_list))
        .route("/jobs/active", get(history_active_list))
        .route("/jobs/{job_id}", get(history_show).delete(history_delete))
        .route("/jobs/{job_id}/cancel", post(cancel_job))
        .route("/jobs/{job_id}/retry", post(retry_job))
        .route("/queue", get(queue_status))
        .route("/queue/concurrency", post(set_queue_concurrency))
        .route("/images/generate", post(enqueue_generate_image))
        .route("/images/edit", post(enqueue_edit_image))
        .route("/files", get(file_response))
        .with_state(state)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let settings = parse_settings().map_err(std::io::Error::other)?;
    if !settings.static_dir.is_dir() {
        return Err(format!(
            "Static directory does not exist: {}",
            settings.static_dir.display()
        )
        .into());
    }
    let static_files = ServeDir::new(&settings.static_dir)
        .not_found_service(ServeFile::new(settings.static_dir.join("index.html")));
    let app = Router::new()
        .nest("/api", api_router(JobQueueState::default()))
        .fallback_service(static_files);
    let listener =
        tokio::net::TcpListener::bind(format!("{}:{}", settings.host, settings.port)).await?;
    println!(
        "gpt-image-2-web listening on http://{}:{}",
        settings.host, settings.port
    );
    axum::serve(listener, app).await?;
    Ok(())
}
