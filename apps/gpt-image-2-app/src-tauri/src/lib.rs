use std::{
    collections::{BTreeMap, VecDeque},
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex, mpsc},
    thread,
    time::{SystemTime, UNIX_EPOCH},
};

use gpt_image_2_core::{
    AppConfig, CredentialRef, KEYCHAIN_SERVICE, ProviderConfig, default_config_path,
    default_keychain_account, delete_history_job, history_db_path, jobs_dir, list_history_jobs,
    load_app_config, read_keychain_secret, redact_app_config, run_json, save_app_config,
    shared_config_dir, show_history_job, upsert_history_job, write_keychain_secret,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::{Emitter, Manager};

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
                "supports_n": false,
                "credentials": {},
                "builtin": true,
                "supports_n": false,
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
                "supports_n": true,
                "edit_region_mode": "native-mask",
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

#[derive(Debug, Clone, Serialize)]
struct DroppedImageFile {
    name: String,
    mime: String,
    bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
struct DroppedImageFiles {
    files: Vec<DroppedImageFile>,
    ignored: usize,
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

const MAX_DROPPED_IMAGE_BYTES: u64 = 64 * 1024 * 1024;

fn image_mime_for_path(path: &Path) -> Option<&'static str> {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .as_deref()
    {
        Some("avif") => Some("image/avif"),
        Some("bmp") => Some("image/bmp"),
        Some("gif") => Some("image/gif"),
        Some("heic") => Some("image/heic"),
        Some("heif") => Some("image/heif"),
        Some("jpg") | Some("jpeg") => Some("image/jpeg"),
        Some("png") => Some("image/png"),
        Some("tif") | Some("tiff") => Some("image/tiff"),
        Some("webp") => Some("image/webp"),
        _ => None,
    }
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

fn generate_args(request: &GenerateRequest, out: &Path, include_n: bool) -> Vec<String> {
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
    mask_path: Option<&Path>,
    out: &Path,
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

fn batch_output_path(dir: &Path, format: Option<&str>, index: u8) -> PathBuf {
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

#[derive(Clone)]
struct StreamContext {
    app: tauri::AppHandle,
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
    // `output_path` is defined as the path of the index-0 output. While the
    // job is still streaming, only set it once index-0 has actually landed so
    // the front-end doesn't mistake a later slot's path for index-0.
    let first_path = sorted_outputs
        .iter()
        .find(|file| file.get("index").and_then(Value::as_u64) == Some(0))
        .and_then(|file| file.get("path"))
        .and_then(Value::as_str)
        .map(ToString::to_string);

    let parent_snapshot = job_snapshot(JobSnapshotInput {
        id: &ctx.job_id,
        command: &ctx.command,
        provider: &ctx.provider,
        status: "running",
        created_at: &ctx.created_at,
        metadata: ctx.metadata.clone(),
        output_path: first_path,
        outputs: json!(sorted_outputs),
        error: Value::Null,
    });
    let _ = persist_job(&parent_snapshot);

    let payload_path = payload
        .get("output")
        .and_then(|output| output.get("path"))
        .cloned()
        .unwrap_or(Value::Null);

    let event = {
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
        )
    };
    emit_queue_event(&ctx.app, &ctx.job_id, &event);
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
    dir: &Path,
) -> Result<(Vec<PathBuf>, Option<PathBuf>, String), String> {
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

fn append_updated_at(metadata: &mut Value) {
    if let Value::Object(object) = metadata {
        object.insert("updated_at".to_string(), json!(chrono_like_now()));
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

struct JobSnapshotInput<'a> {
    id: &'a str,
    command: &'a str,
    provider: &'a str,
    status: &'a str,
    created_at: &'a str,
    metadata: Value,
    output_path: Option<String>,
    outputs: Value,
    error: Value,
}

fn job_snapshot(input: JobSnapshotInput<'_>) -> Value {
    json!({
        "id": input.id,
        "command": input.command,
        "provider": input.provider,
        "status": input.status,
        "created_at": input.created_at,
        "updated_at": chrono_like_now(),
        "metadata": input.metadata,
        "outputs": input.outputs,
        "output_path": input.output_path,
        "error": input.error,
    })
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

fn emit_queue_event(app: &tauri::AppHandle, job_id: &str, event: &Value) {
    let _ = app.emit(
        "gpt-image-2-job-event",
        json!({
            "job_id": job_id,
            "event": event,
        }),
    );
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
fn reveal_provider_credential(name: String, credential: String) -> Result<Value, String> {
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
fn history_show(job_id: String, state: tauri::State<'_, JobQueueState>) -> Result<Value, String> {
    let events = state
        .inner
        .lock()
        .ok()
        .and_then(|inner| inner.events.get(&job_id).cloned())
        .unwrap_or_default();
    Ok(json!({
        "history_file": history_db_path().display().to_string(),
        "job": show_history_job(&job_id).map_err(app_error)?,
        "events": events,
    }))
}

#[tauri::command]
fn history_delete(job_id: String) -> Result<Value, String> {
    let deleted = delete_history_job(&job_id).map_err(app_error)?;
    Ok(json!({
        "ok": true,
        "command": "history delete",
        "job_id": job_id,
        "deleted": deleted,
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
    job_snapshot(JobSnapshotInput {
        id: &queued.id,
        command: &queued.command,
        provider,
        status: "completed",
        created_at: &queued.created_at,
        metadata: queued.metadata.clone(),
        output_path,
        outputs,
        error: Value::Null,
    })
}

fn failed_job_for_queue(queued: &QueuedJob, message: String) -> Value {
    job_snapshot(JobSnapshotInput {
        id: &queued.id,
        command: &queued.command,
        provider: &queued.provider,
        status: "failed",
        created_at: &queued.created_at,
        metadata: queued.metadata.clone(),
        output_path: None,
        outputs: json!([]),
        error: json!({"message": message}),
    })
}

fn finish_queued_job(
    app: tauri::AppHandle,
    state: JobQueueState,
    queued: QueuedJob,
    result: Result<Value, String>,
) {
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
    let event = {
        let mut inner = match state.inner.lock() {
            Ok(inner) => inner,
            Err(_) => return,
        };
        inner.running = inner.running.saturating_sub(1);
        append_queue_event(&mut inner, &queued.id, "local", event_type, event_data)
    };
    emit_queue_event(&app, &queued.id, &event);
    start_queued_jobs(app, state);
}

fn start_queued_jobs(app: tauri::AppHandle, state: JobQueueState) {
    loop {
        let (queued, event, running_job) = {
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
            let running_job = job_snapshot(JobSnapshotInput {
                id: &queued.id,
                command: &queued.command,
                provider: &queued.provider,
                status: "running",
                created_at: &queued.created_at,
                metadata: queued.metadata.clone(),
                output_path: None,
                outputs: json!([]),
                error: Value::Null,
            });
            let event = append_queue_event(
                &mut inner,
                &queued.id,
                "local",
                "job.running",
                json!({"status": "running"}),
            );
            (queued, event, running_job)
        };
        let _ = persist_job(&running_job);
        emit_queue_event(&app, &queued.id, &event);
        let worker_app = app.clone();
        let worker_state = state.clone();
        thread::spawn(move || {
            let stream = StreamContext {
                app: worker_app.clone(),
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
            finish_queued_job(worker_app, worker_state, queued, result);
        });
    }
}

fn enqueue_job(
    app: tauri::AppHandle,
    state: JobQueueState,
    queued: QueuedJob,
) -> Result<Value, String> {
    let job = job_snapshot(JobSnapshotInput {
        id: &queued.id,
        command: &queued.command,
        provider: &queued.provider,
        status: "queued",
        created_at: &queued.created_at,
        metadata: queued.metadata.clone(),
        output_path: None,
        outputs: json!([]),
        error: Value::Null,
    });
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
    emit_queue_event(&app, &job_id, &event);
    start_queued_jobs(app, state);
    Ok(json!({
        "job_id": job_id,
        "job": job,
        "events": [event],
        "queue": queue,
        "queued": true,
    }))
}

#[tauri::command]
fn queue_status(state: tauri::State<'_, JobQueueState>) -> Result<Value, String> {
    let inner = state
        .inner
        .lock()
        .map_err(|_| "Job queue lock was poisoned.".to_string())?;
    Ok(queue_snapshot_locked(&inner))
}

#[tauri::command]
fn set_queue_concurrency(
    max_parallel: usize,
    app: tauri::AppHandle,
    state: tauri::State<'_, JobQueueState>,
) -> Result<Value, String> {
    let max_parallel = max_parallel.clamp(1, 8);
    let queue_state = state.inner().clone();
    let queue = {
        let mut inner = queue_state
            .inner
            .lock()
            .map_err(|_| "Job queue lock was poisoned.".to_string())?;
        inner.max_parallel = max_parallel;
        queue_snapshot_locked(&inner)
    };
    start_queued_jobs(app, queue_state);
    Ok(queue)
}

#[tauri::command]
fn cancel_job(
    job_id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, JobQueueState>,
) -> Result<Value, String> {
    let queue_state = state.inner().clone();
    let (queued, event) = {
        let mut inner = queue_state
            .inner
            .lock()
            .map_err(|_| "Job queue lock was poisoned.".to_string())?;
        let Some(position) = inner.queue.iter().position(|job| job.id == job_id) else {
            return Err("Only queued jobs can be canceled for now.".to_string());
        };
        let queued = inner
            .queue
            .remove(position)
            .ok_or_else(|| "Queued job was not found.".to_string())?;
        let event = append_queue_event(
            &mut inner,
            &job_id,
            "local",
            "job.canceled",
            json!({"status": "canceled"}),
        );
        (queued, event)
    };
    let job = job_snapshot(JobSnapshotInput {
        id: &queued.id,
        command: &queued.command,
        provider: &queued.provider,
        status: "canceled",
        created_at: &queued.created_at,
        metadata: queued.metadata,
        output_path: None,
        outputs: json!([]),
        error: Value::Null,
    });
    persist_job(&job)?;
    emit_queue_event(&app, &job_id, &event);
    Ok(json!({
        "job_id": job_id,
        "job": job,
        "events": [event],
        "canceled": true,
    }))
}

#[tauri::command]
fn read_dropped_image_files(paths: Vec<String>) -> Result<DroppedImageFiles, String> {
    let mut files = Vec::new();
    let mut ignored = 0;

    for raw_path in paths {
        let path = PathBuf::from(&raw_path);
        let Some(mime) = image_mime_for_path(&path) else {
            ignored += 1;
            continue;
        };
        let metadata = match fs::metadata(&path) {
            Ok(metadata) if metadata.is_file() => metadata,
            _ => {
                ignored += 1;
                continue;
            }
        };
        if metadata.len() > MAX_DROPPED_IMAGE_BYTES {
            ignored += 1;
            continue;
        }

        let bytes = fs::read(&path).map_err(|error| format!("读取图片失败：{error}"))?;
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .map(ToString::to_string)
            .unwrap_or_else(|| "dropped-image".to_string());
        files.push(DroppedImageFile {
            name,
            mime: mime.to_string(),
            bytes,
        });
    }

    Ok(DroppedImageFiles { files, ignored })
}

#[tauri::command]
fn enqueue_generate_image(
    request: GenerateRequest,
    app: tauri::AppHandle,
    state: tauri::State<'_, JobQueueState>,
) -> Result<Value, String> {
    if request.prompt.trim().is_empty() {
        return Err("Prompt is required.".to_string());
    }
    requested_n(request.n)?;
    let (id, dir) = unique_job_dir()?;
    let provider = selected_provider_name(request.provider.as_deref());
    let metadata = serde_json::to_value(&request).unwrap_or_else(|_| json!({}));
    enqueue_job(
        app,
        state.inner().clone(),
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
}

#[tauri::command]
fn enqueue_edit_image(
    request: EditRequest,
    app: tauri::AppHandle,
    state: tauri::State<'_, JobQueueState>,
) -> Result<Value, String> {
    if request.prompt.trim().is_empty() {
        return Err("Prompt is required.".to_string());
    }
    if request.refs.is_empty() {
        return Err("At least one reference image is required.".to_string());
    }
    requested_n(request.n)?;
    let (id, dir) = unique_job_dir()?;
    let provider = selected_provider_name(request.provider.as_deref());
    let metadata = edit_request_metadata(&request);
    enqueue_job(
        app,
        state.inner().clone(),
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
}

#[tauri::command]
async fn generate_image(request: GenerateRequest) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (fallback_id, dir) = unique_job_dir()?;
        run_generate_request(request, fallback_id, dir, None)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn edit_image(request: EditRequest) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (fallback_id, dir) = unique_job_dir()?;
        run_edit_request(request, fallback_id, dir, None)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !path.exists() {
        return Err("文件不存在，可能已被移动或删除。".to_string());
    }
    open_system_path(&path, false)
}

#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !path.exists() {
        return Err("文件不存在，可能已被移动或删除。".to_string());
    }
    open_system_path(&path, true)
}

#[tauri::command]
fn export_files_to_downloads(paths: Vec<String>) -> Result<Vec<String>, String> {
    if paths.is_empty() {
        return Err("没有可保存的图片。".to_string());
    }
    let export_dir = downloads_export_dir()?;
    fs::create_dir_all(&export_dir).map_err(|error| format!("无法创建保存目录：{error}"))?;

    let mut saved = Vec::new();
    for path in paths {
        let source = PathBuf::from(path);
        if !source.is_file() {
            return Err("图片文件不存在，可能已被移动或删除。".to_string());
        }
        let file_name = source
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "图片文件名无效。".to_string())?;
        let destination = unique_destination(&export_dir, file_name);
        fs::copy(&source, &destination).map_err(|error| format!("保存图片失败：{error}"))?;
        saved.push(destination.display().to_string());
    }
    Ok(saved)
}

fn downloads_export_dir() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| "找不到下载目录。".to_string())?;
    Ok(home.join("Downloads").join("GPT Image 2"))
}

fn unique_destination(dir: &Path, file_name: &str) -> PathBuf {
    let original = Path::new(file_name);
    let stem = original
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("image");
    let extension = original.extension().and_then(|value| value.to_str());
    let mut candidate = dir.join(file_name);
    let mut index = 2;
    while candidate.exists() {
        let next_name = match extension {
            Some(ext) if !ext.is_empty() => format!("{stem}-{index}.{ext}"),
            _ => format!("{stem}-{index}"),
        };
        candidate = dir.join(next_name);
        index += 1;
    }
    candidate
}

fn open_system_path(path: &Path, reveal: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let status = if reveal && path.is_file() {
        Command::new("open").arg("-R").arg(path).status()
    } else {
        Command::new("open").arg(path).status()
    };

    #[cfg(target_os = "windows")]
    let status = if reveal && path.is_file() {
        Command::new("explorer")
            .arg(format!("/select,{}", path.display()))
            .status()
    } else {
        Command::new("explorer").arg(path).status()
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let status = if reveal && path.is_file() {
        let parent = path.parent().unwrap_or(path);
        Command::new("xdg-open").arg(parent).status()
    } else {
        Command::new("xdg-open").arg(path).status()
    };

    status
        .map_err(|error| format!("无法打开：{error}"))
        .and_then(|status| {
            if status.success() {
                Ok(())
            } else {
                Err("系统没有成功打开文件。".to_string())
            }
        })
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            let window = app
                .get_webview_window("main")
                .or_else(|| app.webview_windows().into_values().next());
            if let Some(window) = window {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .manage(JobQueueState::default())
        .invoke_handler(tauri::generate_handler![
            config_path,
            get_config,
            config_inspect,
            config_save,
            set_default_provider,
            upsert_provider,
            reveal_provider_credential,
            delete_provider,
            provider_test,
            history_list,
            history_show,
            history_delete,
            queue_status,
            set_queue_concurrency,
            cancel_job,
            read_dropped_image_files,
            enqueue_generate_image,
            enqueue_edit_image,
            generate_image,
            edit_image,
            open_path,
            reveal_path,
            export_files_to_downloads,
        ])
        .run(tauri::generate_context!())
        .expect("error while running gpt-image-2-app");
}
