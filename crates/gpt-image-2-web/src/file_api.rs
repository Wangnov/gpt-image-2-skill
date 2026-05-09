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
