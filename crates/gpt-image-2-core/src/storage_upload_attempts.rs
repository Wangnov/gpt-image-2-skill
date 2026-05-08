#![allow(unused_imports)]

use super::*;

pub(crate) fn upload_to_target(
    target: &StorageTargetConfig,
    job_id: &str,
    output: &UploadOutput,
) -> Result<StorageUploadOutcome, AppError> {
    match target {
        StorageTargetConfig::Local {
            directory,
            public_base_url,
        } => upload_to_local(directory, public_base_url.as_deref(), job_id, output),
        StorageTargetConfig::Http {
            url,
            method,
            headers,
            public_url_json_pointer,
        } => upload_to_http(
            url,
            method,
            headers,
            public_url_json_pointer.as_deref(),
            job_id,
            output,
        ),
        StorageTargetConfig::WebDav {
            url,
            username,
            password,
            public_base_url,
        } => upload_to_webdav(
            url,
            username.as_deref(),
            password.as_ref(),
            public_base_url.as_deref(),
            job_id,
            output,
        ),
        StorageTargetConfig::Sftp {
            host,
            port,
            host_key_sha256,
            username,
            password,
            private_key,
            remote_dir,
            public_base_url,
        } => upload_to_sftp(
            host,
            *port,
            host_key_sha256.as_deref(),
            username,
            password.as_ref(),
            private_key.as_ref(),
            remote_dir,
            public_base_url.as_deref(),
            job_id,
            output,
        ),
        StorageTargetConfig::S3 {
            bucket,
            region,
            endpoint,
            prefix,
            access_key_id,
            secret_access_key,
            session_token,
            public_base_url,
        } => upload_to_s3(
            bucket,
            region.as_deref(),
            endpoint.as_deref(),
            prefix.as_deref(),
            access_key_id.as_ref(),
            secret_access_key.as_ref(),
            session_token.as_ref(),
            public_base_url.as_deref(),
            job_id,
            output,
        ),
    }
}

pub(crate) fn record_upload_attempt(
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

pub(crate) fn record_missing_storage_target(
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
