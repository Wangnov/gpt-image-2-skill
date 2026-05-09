use std::sync::mpsc;
use std::thread;

use serde_json::{Value, json};

use crate::AppError;

use super::backends::upload_to_target;
use super::history::{OutputUploadRecord, list_output_upload_records, upsert_output_upload_record};
use super::types::{StorageConfig, StorageFallbackPolicy, StorageTargetConfig};
use super::util::{
    UploadOutput, storage_error_message, storage_target_type, target_names_for_upload, upload_now,
    upload_outputs_from_job,
};

#[derive(Debug, Clone, Default)]
pub struct StorageUploadOverrides {
    pub targets: Option<Vec<String>>,
    pub fallback_targets: Option<Vec<String>>,
}

fn record_upload_attempt(
    job_id: &str,
    output: &UploadOutput,
    target_name: &str,
    target: &StorageTargetConfig,
    role: &str,
) -> Result<bool, AppError> {
    let started = OutputUploadRecord {
        job_id: job_id.to_string(),
        output_index: output.index,
        target: target_name.to_string(),
        target_type: storage_target_type(target).to_string(),
        status: "running".to_string(),
        url: None,
        error: None,
        bytes: None,
        attempts: 1,
        updated_at: upload_now(),
        metadata: json!({"role": role}),
    };
    upsert_output_upload_record(&started)?;
    let result = upload_to_target(target, job_id, output);
    let (status, url, error, bytes, metadata) = match result {
        Ok(outcome) => (
            "completed".to_string(),
            outcome.url,
            None,
            outcome.bytes,
            json!({
                "role": role,
                "detail": outcome.metadata,
            }),
        ),
        Err(error) => (
            if error.code == "storage_target_unsupported" {
                "unsupported".to_string()
            } else {
                "failed".to_string()
            },
            None,
            Some(storage_error_message(error)),
            None,
            json!({"role": role}),
        ),
    };
    let completed = status == "completed";
    let record = OutputUploadRecord {
        job_id: job_id.to_string(),
        output_index: output.index,
        target: target_name.to_string(),
        target_type: storage_target_type(target).to_string(),
        status,
        url,
        error,
        bytes,
        attempts: 1,
        updated_at: upload_now(),
        metadata,
    };
    upsert_output_upload_record(&record)?;
    Ok(completed)
}

fn record_missing_storage_target(
    job_id: &str,
    output: &UploadOutput,
    target_name: &str,
    role: &str,
) -> Result<(), AppError> {
    let record = OutputUploadRecord {
        job_id: job_id.to_string(),
        output_index: output.index,
        target: target_name.to_string(),
        target_type: "unknown".to_string(),
        status: "failed".to_string(),
        url: None,
        error: Some(format!("Unknown storage target: {target_name}")),
        bytes: None,
        attempts: 0,
        updated_at: upload_now(),
        metadata: json!({"role": role}),
    };
    upsert_output_upload_record(&record)
}

fn run_target_uploads(
    config: &StorageConfig,
    job_id: &str,
    output: &UploadOutput,
    target_names: &[String],
    role: &str,
) -> Result<bool, AppError> {
    let target_concurrency = config.target_concurrency.clamp(1, 32);
    let (tx, rx) = mpsc::channel::<Result<bool, AppError>>();
    let mut active = 0usize;
    let mut completed = false;
    let mut first_error = None;
    for target_name in target_names {
        while active >= target_concurrency {
            match rx.recv() {
                Ok(Ok(value)) => {
                    completed |= value;
                    active = active.saturating_sub(1);
                }
                Ok(Err(error)) => {
                    first_error.get_or_insert(error);
                    active = active.saturating_sub(1);
                }
                Err(_) => break,
            }
        }
        if let Some(target) = config.targets.get(target_name) {
            let tx = tx.clone();
            let job_id = job_id.to_string();
            let output = output.clone();
            let target_name = target_name.clone();
            let target = target.clone();
            let role = role.to_string();
            thread::spawn(move || {
                let result = record_upload_attempt(&job_id, &output, &target_name, &target, &role);
                let _ = tx.send(result);
            });
            active += 1;
        } else if let Err(error) = record_missing_storage_target(job_id, output, target_name, role)
        {
            first_error.get_or_insert(error);
        }
    }
    drop(tx);
    while active > 0 {
        match rx.recv() {
            Ok(Ok(value)) => {
                completed |= value;
                active -= 1;
            }
            Ok(Err(error)) => {
                first_error.get_or_insert(error);
                active -= 1;
            }
            Err(_) => break,
        }
    }
    if let Some(error) = first_error {
        Err(error)
    } else {
        Ok(completed)
    }
}

pub fn upload_job_outputs_to_storage(
    config: &StorageConfig,
    job: &Value,
    overrides: StorageUploadOverrides,
) -> Result<Vec<OutputUploadRecord>, AppError> {
    let Some(job_id) = job.get("id").and_then(Value::as_str) else {
        return Err(AppError::new(
            "storage_job_invalid",
            "Job id is required before uploading outputs.",
        ));
    };
    let outputs = upload_outputs_from_job(job);
    if outputs.is_empty() {
        return list_output_upload_records(job_id);
    }
    let (primary_names, fallback_names) = target_names_for_upload(config, &overrides);
    if primary_names.is_empty() && fallback_names.is_empty() {
        return list_output_upload_records(job_id);
    }
    let upload_concurrency = config.upload_concurrency.clamp(1, 32);
    let (tx, rx) = mpsc::channel::<Result<(), AppError>>();
    let mut active = 0usize;
    let mut first_error = None;
    for output in outputs {
        while active >= upload_concurrency {
            match rx.recv() {
                Ok(Ok(())) => {}
                Ok(Err(error)) => {
                    first_error.get_or_insert(error);
                }
                Err(_) => break,
            }
            active = active.saturating_sub(1);
        }
        let tx = tx.clone();
        let job_id = job_id.to_string();
        let config = config.clone();
        let primary_names = primary_names.clone();
        let fallback_names = fallback_names.clone();
        thread::spawn(move || {
            let primary_completed = if primary_names.is_empty() {
                false
            } else {
                match run_target_uploads(&config, &job_id, &output, &primary_names, "primary") {
                    Ok(value) => value,
                    Err(error) => {
                        let _ = tx.send(Err(error));
                        return;
                    }
                }
            };
            let should_run_fallback = match config.fallback_policy {
                StorageFallbackPolicy::Never => false,
                StorageFallbackPolicy::Always => true,
                StorageFallbackPolicy::OnFailure => primary_names.is_empty() || !primary_completed,
            };
            if should_run_fallback
                && let Err(error) =
                    run_target_uploads(&config, &job_id, &output, &fallback_names, "fallback")
            {
                let _ = tx.send(Err(error));
                return;
            }
            let _ = tx.send(Ok(()));
        });
        active += 1;
    }
    drop(tx);
    while active > 0 {
        match rx.recv() {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                first_error.get_or_insert(error);
            }
            Err(_) => break,
        }
        active -= 1;
    }
    if let Some(error) = first_error {
        return Err(error);
    }
    list_output_upload_records(job_id)
}
