use std::fs;
use std::path::PathBuf;

use serde_json::{Value, json};

use crate::AppError;

use super::backends::download_from_target;
use super::history::list_output_upload_records;
use super::types::{PipelineMode, StorageConfig};

#[derive(Debug, Clone)]
pub struct StorageReadback {
    pub bytes: Vec<u8>,
    pub source: Value,
}

pub fn read_job_output_from_storage(
    config: &StorageConfig,
    job: &Value,
    output_index: usize,
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
    if !matches!(pipeline.mode, PipelineMode::CloudPrimary) {
        return Err(AppError::new(
            "storage_readback_unavailable",
            "Remote readback is only available for cloud-primary storage.",
        ));
    }
    let origin = pipeline
        .origin
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            AppError::new(
                "storage_readback_origin_missing",
                "Cloud-primary storage has no Origin target configured.",
            )
        })?;
    let target = config.targets.get(origin).ok_or_else(|| {
        AppError::new(
            "storage_readback_target_missing",
            "Cloud-primary Origin target is not configured.",
        )
        .with_detail(json!({"target": origin}))
    })?;
    let job_id = job.get("id").and_then(Value::as_str).ok_or_else(|| {
        AppError::new(
            "storage_readback_job_invalid",
            "Job id is required for remote readback.",
        )
    })?;
    let uploads = list_output_upload_records(job_id)?;
    let record = uploads
        .iter()
        .find(|record| {
            record.output_index == output_index
                && record.target == origin
                && record.status == "completed"
                && record.metadata.get("role").and_then(Value::as_str) == Some("primary")
        })
        .ok_or_else(|| {
            AppError::new(
                "storage_readback_upload_missing",
                "No completed Origin upload record exists for this output.",
            )
            .with_detail(json!({"job_id": job_id, "output_index": output_index, "target": origin}))
        })?;
    let detail = upload_readback_detail(&record.metadata).ok_or_else(|| {
        AppError::new(
            "storage_readback_manifest_missing",
            "Origin upload record is missing readback metadata.",
        )
        .with_detail(json!({"job_id": job_id, "output_index": output_index, "target": origin}))
    })?;
    let download = download_from_target(target, detail)?;
    Ok(StorageReadback {
        bytes: download.bytes,
        source: json!({
            "kind": "origin",
            "target": record.target,
            "target_type": record.target_type,
            "metadata": download.metadata,
        }),
    })
}

fn upload_readback_detail(metadata: &Value) -> Option<&Value> {
    metadata
        .get("manifest")
        .or_else(|| metadata.get("detail"))
        .filter(|value| value.is_object())
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
