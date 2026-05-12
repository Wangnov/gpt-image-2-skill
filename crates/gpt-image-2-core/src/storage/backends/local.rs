use std::fs;
use std::path::Path;

use serde_json::json;

use super::super::util::*;
use crate::AppError;

pub(super) fn upload_to_local(
    directory: &Path,
    public_base_url: Option<&str>,
    job_id: &str,
    output: &UploadOutput,
) -> Result<StorageUploadOutcome, AppError> {
    if !output.path.is_file() {
        return Err(AppError::new(
            "storage_source_missing",
            "Generated output file is missing.",
        )
        .with_detail(json!({"path": output.path.display().to_string()})));
    }
    let key = storage_object_key(job_id, output);
    let destination = directory.join(&key);
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            AppError::new(
                "storage_local_create_failed",
                "Unable to create local storage directory.",
            )
            .with_detail(json!({"path": parent.display().to_string(), "error": error.to_string()}))
        })?;
    }
    fs::copy(&output.path, &destination).map_err(|error| {
        AppError::new(
            "storage_local_copy_failed",
            "Unable to copy output to local storage.",
        )
        .with_detail(json!({
            "source": output.path.display().to_string(),
            "destination": destination.display().to_string(),
            "error": error.to_string(),
        }))
    })?;
    Ok(StorageUploadOutcome {
        url: http_url_if_safe(public_base_url.map(|base| join_storage_url(base, &key))),
        bytes: Some(output.bytes),
        metadata: json!({
            "path": destination.display().to_string(),
            "key": key,
        }),
    })
}

pub(super) fn download_from_local(
    directory: &Path,
    detail: &serde_json::Value,
) -> Result<StorageDownloadOutcome, AppError> {
    let path = detail
        .get("path")
        .and_then(serde_json::Value::as_str)
        .map(Path::new)
        .map(Path::to_path_buf)
        .or_else(|| {
            detail
                .get("key")
                .and_then(serde_json::Value::as_str)
                .map(|key| directory.join(key))
        })
        .ok_or_else(|| {
            AppError::new(
                "storage_readback_missing_key",
                "Local storage upload record is missing a readable path.",
            )
        })?;
    let bytes = fs::read(&path).map_err(|error| {
        AppError::new(
            "storage_local_read_failed",
            "Unable to read local storage object.",
        )
        .with_detail(json!({"path": path.display().to_string(), "error": error.to_string()}))
    })?;
    Ok(StorageDownloadOutcome {
        bytes,
        metadata: json!({
            "path": path.display().to_string(),
        }),
    })
}
