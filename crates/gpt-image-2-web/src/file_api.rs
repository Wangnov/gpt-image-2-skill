#![allow(unused_imports)]

use super::*;

pub(crate) fn remap_host_codex_app_path(path: &str) -> Option<PathBuf> {
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

pub(crate) fn safe_job_file_path(path: &str) -> Result<PathBuf, ApiError> {
    let requested = remap_host_codex_app_path(path).unwrap_or_else(|| PathBuf::from(path));
    let file = requested
        .canonicalize()
        .map_err(|_| ApiError::not_found("文件不存在，可能已被移动或删除。"))?;
    if !file.is_file() {
        return Err(ApiError::not_found("文件不存在，可能已被移动或删除。"));
    }
    let library = result_library_dir();
    fs::create_dir_all(&library).map_err(|error| ApiError::internal(error.to_string()))?;
    let root = library
        .canonicalize()
        .map_err(|error| ApiError::internal(error.to_string()))?;
    if file.starts_with(&root) {
        return Ok(file);
    }
    let config = load_config_or_default();
    if config.paths.legacy_shared_codex_dir.enabled_for_read {
        let legacy = legacy_jobs_dir(Some(&config));
        let legacy_root = legacy.canonicalize().ok();
        if legacy_root
            .as_ref()
            .is_some_and(|root| file.starts_with(root))
        {
            return Ok(file);
        }
    }
    Err(ApiError::forbidden("只能读取当前服务生成的任务文件。"))
}

pub(crate) async fn file_response(Query(query): Query<FileQuery>) -> Result<Response, ApiError> {
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

pub(crate) async fn job_output_response(
    Path((job_id, output_index)): Path<(String, usize)>,
) -> Result<Response, ApiError> {
    let config = load_config().map_err(ApiError::internal)?;
    let job = show_history_job(&job_id)
        .map_err(app_error)
        .map_err(ApiError::not_found)?;
    // Storage readback can pull the image back from a remote target
    // (S3/WebDAV/…) over core's blocking HTTP client, so it must run on the
    // blocking pool rather than inline on the tokio worker.
    let readback_job = job.clone();
    let readback = run_core_blocking(move || {
        read_job_output_from_storage_with_options(
            &config.storage,
            &readback_job,
            output_index,
            StorageReadbackOptions {
                allow_archive_fallback: true,
                rehydrate_local_cache: true,
                local_cache_roots: local_cache_roots_for_product(&config),
            },
        )
    })
    .await?
    .map_err(app_error)
    .map_err(ApiError::not_found)?;
    let file_name = output_file_name_from_job(&job, output_index);
    let mime = mime_guess::from_path(&file_name).first_or_octet_stream();
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime.as_ref())
        .header(header::CACHE_CONTROL, "private, max-age=31536000")
        .header(
            header::CONTENT_DISPOSITION,
            format!("inline; filename=\"{file_name}\""),
        )
        .body(Body::from(readback.bytes))
        .map_err(|error| ApiError::internal(error.to_string()))
}

/// Serve a reference *input* image (`ref-{index}.{ext}`) for an edit job.
///
/// Unlike outputs, reference images are the original source files written to
/// the job directory at submission time, so we read them straight from disk
/// rather than going through storage readback. The job directory is resolved
/// the same way as in core history serialization (recovery metadata first,
/// then the parent of a recorded output path), and the final path is funneled
/// through `safe_job_file_path` for canonicalization, managed-root checks, and
/// path-traversal protection.
pub(crate) async fn job_reference_response(
    Path((job_id, reference_index)): Path<(String, usize)>,
) -> Result<Response, ApiError> {
    let job = show_history_job(&job_id)
        .map_err(app_error)
        .map_err(ApiError::not_found)?;
    // Resolve the actual reference path from the serialized `reference_images`
    // (which honors the on-disk extension and is only populated for edit jobs),
    // then funnel it through `safe_job_file_path` for canonicalization,
    // managed-root checks, and path-traversal protection.
    let reference_path = job
        .get("reference_images")
        .and_then(Value::as_array)
        .and_then(|refs| {
            refs.iter().find(|item| {
                item.get("index").and_then(Value::as_u64) == Some(reference_index as u64)
            })
        })
        .and_then(|item| item.get("path").and_then(Value::as_str))
        .ok_or_else(|| ApiError::not_found("找不到该参考图。"))?;
    let path = safe_job_file_path(reference_path)?;
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|error| ApiError::not_found(error.to_string()))?;
    let mime = mime_guess::from_path(&path).first_or_octet_stream();
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("reference.png");
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

fn output_file_name_from_job(job: &Value, output_index: usize) -> String {
    job.get("outputs")
        .and_then(Value::as_array)
        .and_then(|outputs| {
            outputs.iter().find_map(|output| {
                let index = output
                    .get("index")
                    .and_then(Value::as_u64)
                    .map(|value| value as usize)?;
                if index == output_index {
                    output
                        .get("path")
                        .and_then(Value::as_str)
                        .and_then(|path| FsPath::new(path).file_name())
                        .and_then(|name| name.to_str())
                        .map(ToString::to_string)
                } else {
                    None
                }
            })
        })
        .unwrap_or_else(|| format!("output-{}.png", output_index + 1))
}
