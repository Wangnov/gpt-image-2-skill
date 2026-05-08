#![allow(unused_imports)]

use super::*;

#[tauri::command]
pub(crate) fn read_dropped_image_files(paths: Vec<String>) -> Result<DroppedImageFiles, String> {
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
pub(crate) fn enqueue_generate_image(
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
pub(crate) fn enqueue_edit_image(
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
