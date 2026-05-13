use std::fs;
use std::path::PathBuf;

use serde_json::{Value, json};

use crate::AppError;

use super::backends::download_from_target;
use super::history::{OutputUploadRecord, list_output_upload_records};
use super::types::{PipelineMode, StorageConfig};

#[derive(Debug, Clone)]
pub struct StorageReadback {
    pub bytes: Vec<u8>,
    pub source: Value,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct StorageReadbackOptions {
    pub allow_archive_fallback: bool,
    pub rehydrate_local_cache: bool,
}

pub fn read_job_output_from_storage(
    config: &StorageConfig,
    job: &Value,
    output_index: usize,
) -> Result<StorageReadback, AppError> {
    read_job_output_from_storage_with_options(
        config,
        job,
        output_index,
        StorageReadbackOptions::default(),
    )
}

pub fn read_job_output_from_storage_with_options(
    config: &StorageConfig,
    job: &Value,
    output_index: usize,
    options: StorageReadbackOptions,
) -> Result<StorageReadback, AppError> {
    if let Some(path) = job_output_path(job, output_index) {
        let path = PathBuf::from(path);
        if path.is_file() {
            let bytes = fs::read(&path).map_err(|error| {
                AppError::new(
                    "storage_readback_local_failed",
                    "Unable to read local output.",
                )
                .with_detail(json!({
                    "path": path.display().to_string(),
                    "error": error.to_string(),
                }))
            })?;
            return Ok(StorageReadback {
                bytes,
                source: json!({
                    "kind": "local_cache",
                    "path": path.display().to_string(),
                }),
            });
        }
    }

    let pipeline = config.effective_pipeline();
    if !matches!(pipeline.mode, PipelineMode::CloudPrimary) && !options.allow_archive_fallback {
        return Err(AppError::new(
            "storage_readback_unavailable",
            "Remote readback is only available for cloud-primary storage unless archive fallback is explicitly allowed.",
        ));
    }
    let origin = pipeline
        .origin
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    if matches!(pipeline.mode, PipelineMode::CloudPrimary) && origin.is_none() {
        return Err(AppError::new(
            "storage_readback_origin_missing",
            "Cloud-primary storage has no Origin target configured.",
        ));
    }
    if let Some(origin) = origin
        && let Some(target) = config.targets.get(origin)
        && !target.can_act_as_origin()
    {
        return Err(AppError::new(
            "storage_readback_origin_unsupported",
            "Cloud-primary Origin does not support implemented readback.",
        )
        .with_detail(json!({"origin": origin})));
    }
    let job_id = job.get("id").and_then(Value::as_str).ok_or_else(|| {
        AppError::new(
            "storage_readback_job_invalid",
            "Job id is required for remote readback.",
        )
    })?;
    let uploads = list_output_upload_records(job_id)?;
    let candidates = readback_candidates(
        &uploads,
        output_index,
        origin,
        options.allow_archive_fallback,
    );
    if candidates.is_empty() {
        return Err(AppError::new(
            "storage_readback_upload_missing",
            "No completed readable upload record exists for this output.",
        )
        .with_detail(json!({
            "job_id": job_id,
            "output_index": output_index,
            "origin": origin,
            "allow_archive_fallback": options.allow_archive_fallback,
        })));
    }
    let mut failures = Vec::new();
    for (kind, record) in candidates {
        let Some(target) = config.targets.get(&record.target) else {
            failures.push(json!({
                "kind": kind,
                "target": record.target,
                "code": "storage_readback_target_missing",
                "message": "Storage target is not configured.",
            }));
            continue;
        };
        let Some(detail) = upload_readback_detail(&record.metadata) else {
            failures.push(json!({
                "kind": kind,
                "target": record.target,
                "code": "storage_readback_manifest_missing",
                "message": "Upload record is missing readback metadata.",
            }));
            continue;
        };
        match download_from_target(target, detail) {
            Ok(download) => {
                let rehydrated_path =
                    rehydrate_cache_path(job, output_index, detail, &download.bytes, options)?;
                return Ok(StorageReadback {
                    bytes: download.bytes,
                    source: json!({
                        "kind": kind,
                        "target": record.target,
                        "target_type": record.target_type,
                        "metadata": download.metadata,
                        "rehydrated_path": rehydrated_path,
                    }),
                });
            }
            Err(error) => failures.push(json!({
                "kind": kind,
                "target": record.target,
                "code": error.code,
                "message": error.message,
                "detail": error.detail,
            })),
        }
    }
    Err(AppError::new(
        "storage_readback_failed",
        "Unable to read this output from configured storage.",
    )
    .with_detail(json!({
        "job_id": job_id,
        "output_index": output_index,
        "attempts": failures,
    })))
}

fn upload_readback_detail(metadata: &Value) -> Option<&Value> {
    metadata
        .get("manifest")
        .or_else(|| metadata.get("detail"))
        .filter(|value| value.is_object())
}

fn readback_candidates<'a>(
    uploads: &'a [OutputUploadRecord],
    output_index: usize,
    origin: Option<&str>,
    allow_archive_fallback: bool,
) -> Vec<(&'static str, &'a OutputUploadRecord)> {
    let mut out = Vec::new();
    if let Some(origin) = origin
        && let Some(record) = uploads.iter().find(|record| {
            record.output_index == output_index
                && record.target == origin
                && record.status == "completed"
                && record.metadata.get("role").and_then(Value::as_str) == Some("primary")
        })
    {
        out.push(("origin", record));
    }
    if allow_archive_fallback {
        out.extend(uploads.iter().filter_map(|record| {
            let is_origin = origin.is_some_and(|origin| record.target == origin);
            if record.output_index == output_index && record.status == "completed" && !is_origin {
                Some(("archive", record))
            } else {
                None
            }
        }));
    }
    out
}

fn rehydrate_cache_path(
    job: &Value,
    output_index: usize,
    detail: &Value,
    bytes: &[u8],
    options: StorageReadbackOptions,
) -> Result<Value, AppError> {
    if !options.rehydrate_local_cache {
        return Ok(Value::Null);
    }
    let path = job_output_path(job, output_index)
        .map(PathBuf::from)
        .or_else(|| manifest_cache_path(detail));
    let Some(path) = path else {
        return Ok(Value::Null);
    };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            AppError::new(
                "storage_readback_cache_create_failed",
                "Unable to create local cache directory.",
            )
            .with_detail(json!({"path": parent.display().to_string(), "error": error.to_string()}))
        })?;
    }
    fs::write(&path, bytes).map_err(|error| {
        AppError::new(
            "storage_readback_cache_write_failed",
            "Unable to rehydrate local output cache.",
        )
        .with_detail(json!({"path": path.display().to_string(), "error": error.to_string()}))
    })?;
    Ok(Value::String(path.display().to_string()))
}

fn manifest_cache_path(detail: &Value) -> Option<PathBuf> {
    detail
        .get("local_cache_path")
        .or_else(|| detail.get("source_path"))
        .or_else(|| detail.get("path"))
        .and_then(Value::as_str)
        .filter(|path| !path.trim().is_empty())
        .map(PathBuf::from)
}

fn job_output_path(job: &Value, output_index: usize) -> Option<&str> {
    job.get("outputs")
        .and_then(Value::as_array)
        .and_then(|outputs| output_path_from_items(outputs, output_index))
        .or_else(|| {
            job.get("metadata")
                .and_then(|metadata| metadata.get("output"))
                .and_then(|output| output.get("files"))
                .and_then(Value::as_array)
                .and_then(|outputs| output_path_from_items(outputs, output_index))
        })
        .or_else(|| {
            job.get("metadata")
                .and_then(|metadata| metadata.get("image_output"))
                .and_then(|output| output.get("files"))
                .and_then(Value::as_array)
                .and_then(|outputs| output_path_from_items(outputs, output_index))
        })
        .or_else(|| {
            (output_index == 0)
                .then(|| job.get("output_path").and_then(Value::as_str))
                .flatten()
        })
        .filter(|path| !path.trim().is_empty())
}

fn output_path_from_items(items: &[Value], output_index: usize) -> Option<&str> {
    items
        .iter()
        .enumerate()
        .find(|(fallback_index, output)| {
            output
                .get("index")
                .and_then(Value::as_u64)
                .map(|index| index as usize)
                .unwrap_or(*fallback_index)
                == output_index
        })
        .and_then(|(_, output)| output.get("path").and_then(Value::as_str))
        .filter(|path| !path.trim().is_empty())
}
