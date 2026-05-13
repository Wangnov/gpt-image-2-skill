use std::fs;
use std::path::{Path, PathBuf};

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
    let path = local_readback_path(directory, detail)?;
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

#[allow(dead_code)]
pub(super) fn head_local(
    directory: &Path,
    detail: &serde_json::Value,
) -> Result<StorageHeadOutcome, AppError> {
    let path = local_readback_path(directory, detail)?;
    let metadata = fs::metadata(&path).map_err(|error| {
        AppError::new(
            "storage_local_head_failed",
            "Unable to inspect local storage object.",
        )
        .with_detail(json!({"path": path.display().to_string(), "error": error.to_string()}))
    })?;
    Ok(StorageHeadOutcome {
        bytes: Some(metadata.len()),
        metadata: json!({
            "path": path.display().to_string(),
        }),
    })
}

fn local_readback_path(directory: &Path, detail: &serde_json::Value) -> Result<PathBuf, AppError> {
    let candidate = detail
        .get("key")
        .and_then(serde_json::Value::as_str)
        .filter(|key| !key.trim().is_empty())
        .map(|key| directory.join(key))
        .or_else(|| {
            detail
                .get("path")
                .and_then(serde_json::Value::as_str)
                .filter(|path| !path.trim().is_empty())
                .map(PathBuf::from)
        })
        .ok_or_else(|| {
            AppError::new(
                "storage_readback_missing_key",
                "Local storage upload record is missing a readable path.",
            )
        })?;
    let root = directory.canonicalize().map_err(|error| {
        AppError::new(
            "storage_readback_root_missing",
            "Local storage directory is not available for readback.",
        )
        .with_detail(
            json!({"directory": directory.display().to_string(), "error": error.to_string()}),
        )
    })?;
    let resolved = candidate.canonicalize().map_err(|error| {
        AppError::new(
            "storage_local_read_failed",
            "Unable to resolve local storage object.",
        )
        .with_detail(json!({"path": candidate.display().to_string(), "error": error.to_string()}))
    })?;
    if !resolved.starts_with(&root) {
        return Err(AppError::new(
            "storage_readback_path_outside_root",
            "Local storage readback path is outside the configured directory.",
        )
        .with_detail(json!({
            "directory": root.display().to_string(),
            "path": resolved.display().to_string(),
        })));
    }
    Ok(resolved)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_readback_prefers_key_inside_configured_root() {
        let temp_dir = tempfile::tempdir().unwrap();
        let root = temp_dir.path().join("storage");
        let object = root.join("job-1").join("out.png");
        fs::create_dir_all(object.parent().unwrap()).unwrap();
        fs::write(&object, b"ok").unwrap();
        let outside = temp_dir.path().join("outside.png");
        fs::write(&outside, b"no").unwrap();

        let path = local_readback_path(
            &root,
            &json!({
                "key": "job-1/out.png",
                "path": outside.display().to_string(),
            }),
        )
        .unwrap();

        assert_eq!(path, object.canonicalize().unwrap());
    }

    #[test]
    fn local_readback_rejects_paths_outside_configured_root() {
        let temp_dir = tempfile::tempdir().unwrap();
        let root = temp_dir.path().join("storage");
        fs::create_dir_all(&root).unwrap();
        let outside = temp_dir.path().join("outside.png");
        fs::write(&outside, b"no").unwrap();

        let error = local_readback_path(
            &root,
            &json!({
                "path": outside.display().to_string(),
            }),
        )
        .unwrap_err();

        assert_eq!(error.code, "storage_readback_path_outside_root");
    }

    #[test]
    fn local_readback_rejects_traversing_keys() {
        let temp_dir = tempfile::tempdir().unwrap();
        let root = temp_dir.path().join("storage");
        fs::create_dir_all(&root).unwrap();
        let outside = temp_dir.path().join("outside.png");
        fs::write(&outside, b"no").unwrap();

        let error = local_readback_path(
            &root,
            &json!({
                "key": "../outside.png",
            }),
        )
        .unwrap_err();

        assert_eq!(error.code, "storage_readback_path_outside_root");
    }
}
