#![allow(unused_imports)]

use super::*;

pub(crate) fn metadata_object(job: &Value) -> Value {
    job.get("metadata")
        .cloned()
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({}))
}

pub(crate) fn string_field(metadata: &Value, key: &str) -> Option<String> {
    metadata
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

pub(crate) fn u8_field(metadata: &Value, key: &str) -> Option<u8> {
    metadata
        .get(key)
        .and_then(Value::as_u64)
        .and_then(|value| u8::try_from(value).ok())
}

pub(crate) fn upload_file_from_path(path: &FsPath) -> Result<UploadFile, String> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .map(ToString::to_string)
        .unwrap_or_else(|| "image.png".to_string());
    let bytes = fs::read(path).map_err(|error| format!("读取原始图片失败：{error}"))?;
    Ok(UploadFile { name, bytes })
}

pub(crate) fn generate_request_from_job(job: &Value) -> Result<GenerateRequest, String> {
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

pub(crate) fn sorted_ref_inputs(dir: &FsPath) -> Result<Vec<UploadFile>, String> {
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

pub(crate) fn edit_job_input_dir(job_id: &str) -> Result<(PathBuf, Vec<UploadFile>), String> {
    let config = load_config_or_default();
    let dirs = [
        product_result_library_dir(Some(&config), ProductRuntime::DockerWeb).join(job_id),
        legacy_jobs_dir(Some(&config)).join(job_id),
    ];
    let mut last_error = None;
    for dir in dirs {
        match sorted_ref_inputs(&dir) {
            Ok(refs) if !refs.is_empty() => return Ok((dir, refs)),
            Ok(_) => {}
            Err(error) => last_error = Some(error),
        }
    }
    Err(last_error.unwrap_or_else(|| "这个编辑任务缺少原始参考图，无法原样重试。".to_string()))
}

pub(crate) fn edit_request_from_job(job_id: &str, job: &Value) -> Result<EditRequest, String> {
    let metadata = metadata_object(job);
    let (dir, refs) = edit_job_input_dir(job_id)?;
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
        storage_targets: metadata.get("storage_targets").and_then(|targets| {
            targets.as_array().map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
            })
        }),
        fallback_targets: metadata.get("fallback_targets").and_then(|targets| {
            targets.as_array().map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
            })
        }),
        refs,
        mask,
        selection_hint,
    })
}

pub(crate) async fn retry_job(
    Path(job_id): Path<String>,
    State(state): State<JobQueueState>,
) -> ApiResult {
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
