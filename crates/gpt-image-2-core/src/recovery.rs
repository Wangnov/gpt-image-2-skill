#![allow(unused_imports)]

use super::*;
use sha2::Digest;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

#[cfg(all(feature = "recovery-fault-injection", not(any(test, debug_assertions))))]
compile_error!("recovery-fault-injection must not be enabled in release builds");

pub const RECOVERY_ATTEMPTS_LIMIT: usize = 5;
pub const RECOVERY_STATE_FILE: &str = "recovery_state.json";
pub const REQUEST_META_FILE: &str = "request_meta.json";
pub const RAW_RESPONSE_FILE: &str = "raw_response.json";
pub const ERROR_FILE: &str = "error.json";

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecoveryStage {
    Staged,
    Submitted,
    ResponseReceived,
    Materialized,
    Uploaded,
    Completed,
}

impl RecoveryStage {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Staged => "staged",
            Self::Submitted => "submitted",
            Self::ResponseReceived => "response_received",
            Self::Materialized => "materialized",
            Self::Uploaded => "uploaded",
            Self::Completed => "completed",
        }
    }
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
pub enum Recoverability {
    #[serde(rename = "recoverable.never_dispatched")]
    NeverDispatched,
    #[serde(rename = "recoverable.local_response_cached")]
    LocalResponseCached,
    #[serde(rename = "recoverable.partial_outputs")]
    PartialOutputs,
    #[serde(rename = "recoverable.upload_failed")]
    UploadFailed,
    #[serde(rename = "recoverable.remote_in_progress")]
    RemoteInProgress,
    #[serde(rename = "ambiguous.remote_maybe_accepted")]
    RemoteMaybeAccepted,
    #[serde(rename = "terminal.local_recovery_unavailable")]
    LocalRecoveryUnavailable,
    #[serde(rename = "terminal.provider_rejected")]
    ProviderRejected,
    #[serde(rename = "terminal.user_cancelled")]
    UserCancelled,
}

impl Recoverability {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::NeverDispatched => "recoverable.never_dispatched",
            Self::LocalResponseCached => "recoverable.local_response_cached",
            Self::PartialOutputs => "recoverable.partial_outputs",
            Self::UploadFailed => "recoverable.upload_failed",
            Self::RemoteInProgress => "recoverable.remote_in_progress",
            Self::RemoteMaybeAccepted => "ambiguous.remote_maybe_accepted",
            Self::LocalRecoveryUnavailable => "terminal.local_recovery_unavailable",
            Self::ProviderRejected => "terminal.provider_rejected",
            Self::UserCancelled => "terminal.user_cancelled",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "recoverable.never_dispatched" => Some(Self::NeverDispatched),
            "recoverable.local_response_cached" => Some(Self::LocalResponseCached),
            "recoverable.partial_outputs" => Some(Self::PartialOutputs),
            "recoverable.upload_failed" => Some(Self::UploadFailed),
            "recoverable.remote_in_progress" => Some(Self::RemoteInProgress),
            "ambiguous.remote_maybe_accepted" => Some(Self::RemoteMaybeAccepted),
            "terminal.local_recovery_unavailable" => Some(Self::LocalRecoveryUnavailable),
            "terminal.provider_rejected" => Some(Self::ProviderRejected),
            "terminal.user_cancelled" => Some(Self::UserCancelled),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RecoveryAttempt {
    pub attempt_id: String,
    pub client_request_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_headers_received_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_body_completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_response_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage_at_failure: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RecoveryState {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recoverability: Option<String>,
    #[serde(default)]
    pub attempts: Vec<RecoveryAttempt>,
    #[serde(default)]
    pub attempts_truncated_count: usize,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub generation_slots: Vec<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interrupted_reason: Option<String>,
}

#[derive(Debug, Clone)]
pub struct RecoveryContext {
    pub job_id: String,
    pub job_dir: PathBuf,
    state: RecoveryState,
}

static UNIQUE_COUNTER: AtomicU64 = AtomicU64::new(1);

fn token(prefix: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let seq = UNIQUE_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{nanos:x}-{:x}-{:x}", std::process::id(), seq)
}

pub fn recovery_state_path(job_dir: &Path) -> PathBuf {
    job_dir.join(RECOVERY_STATE_FILE)
}

pub fn request_meta_path(job_dir: &Path) -> PathBuf {
    job_dir.join(REQUEST_META_FILE)
}

pub fn raw_response_path(job_dir: &Path) -> PathBuf {
    job_dir.join(RAW_RESPONSE_FILE)
}

pub fn error_json_path(job_dir: &Path) -> PathBuf {
    job_dir.join(ERROR_FILE)
}

pub fn atomic_write_json(path: &Path, value: &Value) -> Result<(), AppError> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| {
        AppError::new(
            "recovery_json_encode_failed",
            "Unable to encode recovery JSON.",
        )
        .with_detail(json!({"error": error.to_string()}))
    })?;
    atomic_write_bytes(path, &bytes)
}

pub fn atomic_write_bytes(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            AppError::new(
                "recovery_write_failed",
                "Unable to create recovery directory.",
            )
            .with_detail(json!({"path": parent.display().to_string(), "error": error.to_string()}))
        })?;
    }
    let part = path.with_extension(format!(
        "{}part",
        path.extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| format!("{ext}."))
            .unwrap_or_default()
    ));
    {
        let mut file = fs::File::create(&part).map_err(|error| {
            AppError::new("recovery_write_failed", "Unable to create recovery file.").with_detail(
                json!({"path": part.display().to_string(), "error": error.to_string()}),
            )
        })?;
        file.write_all(bytes).map_err(|error| {
            AppError::new("recovery_write_failed", "Unable to write recovery file.").with_detail(
                json!({"path": part.display().to_string(), "error": error.to_string()}),
            )
        })?;
        file.sync_all().map_err(|error| {
            AppError::new("recovery_write_failed", "Unable to flush recovery file.").with_detail(
                json!({"path": part.display().to_string(), "error": error.to_string()}),
            )
        })?;
    }
    fs::rename(&part, path).map_err(|error| {
        AppError::new("recovery_write_failed", "Unable to finalize recovery file.").with_detail(
            json!({
                "from": part.display().to_string(),
                "to": path.display().to_string(),
                "error": error.to_string()
            }),
        )
    })?;
    if let Some(parent) = path.parent()
        && let Ok(dir) = fs::File::open(parent)
    {
        let _ = dir.sync_all();
    }
    Ok(())
}

pub fn load_recovery_state(job_dir: &Path) -> Option<RecoveryState> {
    fs::read_to_string(recovery_state_path(job_dir))
        .ok()
        .and_then(|raw| serde_json::from_str::<RecoveryState>(&raw).ok())
}

pub fn recovery_job_dir(metadata: &Value) -> Option<PathBuf> {
    metadata
        .get("recovery")
        .and_then(|value| value.get("job_dir"))
        .and_then(Value::as_str)
        .or_else(|| metadata.get("job_dir").and_then(Value::as_str))
        .map(PathBuf::from)
}

pub fn annotate_recovery_job_dir(mut metadata: Value, job_dir: &Path) -> Value {
    if !metadata.is_object() {
        metadata = json!({});
    }
    if let Value::Object(map) = &mut metadata {
        let mut recovery = map.get("recovery").cloned().unwrap_or_else(|| json!({}));
        if let Value::Object(recovery_map) = &mut recovery {
            recovery_map.insert("job_dir".to_string(), json!(job_dir.display().to_string()));
        }
        map.insert("recovery".to_string(), recovery);
    }
    metadata
}

pub fn merge_recovery_metadata(mut metadata: Value, job_dir: &Path) -> Value {
    metadata = annotate_recovery_job_dir(metadata, job_dir);
    let Some(mut state) = load_recovery_state(job_dir) else {
        let recoverability =
            classify_from_evidence(None, raw_response_path(job_dir).is_file(), None);
        if let Value::Object(map) = &mut metadata {
            map.insert("recoverability".to_string(), json!(recoverability.as_str()));
        }
        return metadata;
    };
    if state.recoverability.is_none() {
        state.recoverability = Some(
            classify_from_state_and_evidence(&state, raw_response_path(job_dir).is_file())
                .as_str()
                .to_string(),
        );
    }
    if let Value::Object(map) = &mut metadata {
        map.remove("attempts");
        map.remove("attempts_truncated_count");
        if !state.generation_slots.is_empty() {
            map.insert(
                "generation_slots".to_string(),
                json!(state.generation_slots),
            );
        }
        if let Some(stage) = state.stage {
            map.insert("stage".to_string(), json!(stage));
        }
        if let Some(recoverability) = state.recoverability {
            map.insert("recoverability".to_string(), json!(recoverability));
        }
        if let Some(reason) = state.interrupted_reason {
            map.insert("interrupted_reason".to_string(), json!(reason));
        }
    }
    metadata
}

pub fn classify_from_state_and_evidence(
    state: &RecoveryState,
    raw_response_present: bool,
) -> Recoverability {
    classify_from_evidence(state.attempts.last(), raw_response_present, None)
}

pub fn classify_from_evidence(
    attempt: Option<&RecoveryAttempt>,
    raw_response_present: bool,
    fallback_error_code: Option<&str>,
) -> Recoverability {
    let Some(attempt) = attempt else {
        return if raw_response_present {
            Recoverability::LocalResponseCached
        } else {
            Recoverability::NeverDispatched
        };
    };
    if attempt.request_started_at.is_none() {
        return Recoverability::NeverDispatched;
    }
    if attempt.response_body_completed_at.is_some() {
        if attempt.raw_response_path.is_some() || raw_response_present {
            return Recoverability::LocalResponseCached;
        }
        return Recoverability::LocalRecoveryUnavailable;
    }
    if matches!(
        fallback_error_code.or(attempt.error_code.as_deref()),
        Some("provider_rejected")
    ) {
        return Recoverability::ProviderRejected;
    }
    Recoverability::RemoteMaybeAccepted
}

impl RecoveryContext {
    pub fn new(job_id: impl Into<String>, job_dir: impl Into<PathBuf>) -> Result<Self, AppError> {
        let job_id = job_id.into();
        let job_dir = job_dir.into();
        fs::create_dir_all(&job_dir).map_err(|error| {
            AppError::new("recovery_write_failed", "Unable to create job directory.").with_detail(
                json!({"path": job_dir.display().to_string(), "error": error.to_string()}),
            )
        })?;
        let state = load_recovery_state(&job_dir).unwrap_or_else(|| RecoveryState {
            job_id: Some(job_id.clone()),
            job_dir: Some(job_dir.display().to_string()),
            stage: Some(RecoveryStage::Staged.as_str().to_string()),
            ..RecoveryState::default()
        });
        let ctx = Self {
            job_id,
            job_dir,
            state,
        };
        ctx.persist_state()?;
        Ok(ctx)
    }

    pub fn write_request_meta(&self, request_meta: &Value) -> Result<(), AppError> {
        atomic_write_json(&request_meta_path(&self.job_dir), request_meta)
    }

    fn persist_state(&self) -> Result<(), AppError> {
        let value = serde_json::to_value(&self.state).map_err(|error| {
            AppError::new(
                "recovery_json_encode_failed",
                "Unable to encode recovery state.",
            )
            .with_detail(json!({"error": error.to_string()}))
        })?;
        atomic_write_json(&recovery_state_path(&self.job_dir), &value)
    }

    fn current_attempt_mut(&mut self) -> Option<&mut RecoveryAttempt> {
        self.state.attempts.last_mut()
    }

    pub fn begin_attempt(&mut self) -> Result<String, AppError> {
        let attempt = RecoveryAttempt {
            attempt_id: token("attempt"),
            client_request_id: token("client"),
            ..RecoveryAttempt::default()
        };
        if self.state.attempts.len() >= RECOVERY_ATTEMPTS_LIMIT {
            self.state.attempts.remove(0);
            self.state.attempts_truncated_count += 1;
        }
        let client_request_id = attempt.client_request_id.clone();
        self.state.attempts.push(attempt);
        self.state.stage = Some(RecoveryStage::Submitted.as_str().to_string());
        self.state.recoverability = Some(Recoverability::RemoteMaybeAccepted.as_str().to_string());
        self.mark_request_started()?;
        Ok(client_request_id)
    }

    pub fn mark_request_started(&mut self) -> Result<(), AppError> {
        if let Some(attempt) = self.current_attempt_mut() {
            attempt.request_started_at = Some(now_iso());
        }
        self.persist_state()?;
        test_fault::maybe_abort("request_started");
        Ok(())
    }

    pub fn mark_response_headers(&mut self, headers: &HeaderMap) -> Result<(), AppError> {
        if let Some(attempt) = self.current_attempt_mut() {
            attempt.response_headers_received_at = Some(now_iso());
            attempt.provider_request_id = normalize_provider_request_id(headers);
        }
        self.persist_state()
    }

    pub fn mark_response_body_completed(&mut self) -> Result<(), AppError> {
        if let Some(attempt) = self.current_attempt_mut() {
            attempt.response_body_completed_at = Some(now_iso());
        }
        self.persist_state()
    }

    pub fn spool_raw_response(&mut self, raw: &str) -> Result<(), AppError> {
        let path = raw_response_path(&self.job_dir);
        let part = path.with_extension("json.part");
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                AppError::new(
                    "recovery_write_failed",
                    "Unable to create recovery directory.",
                )
                .with_detail(
                    json!({"path": parent.display().to_string(), "error": error.to_string()}),
                )
            })?;
        }
        {
            let mut file = fs::File::create(&part).map_err(|error| {
                AppError::new(
                    "recovery_write_failed",
                    "Unable to create raw response part.",
                )
                .with_detail(
                    json!({"path": part.display().to_string(), "error": error.to_string()}),
                )
            })?;
            file.write_all(raw.as_bytes()).map_err(|error| {
                AppError::new(
                    "recovery_write_failed",
                    "Unable to write raw response part.",
                )
                .with_detail(
                    json!({"path": part.display().to_string(), "error": error.to_string()}),
                )
            })?;
            file.sync_all().map_err(|error| {
                AppError::new(
                    "recovery_write_failed",
                    "Unable to flush raw response part.",
                )
                .with_detail(
                    json!({"path": part.display().to_string(), "error": error.to_string()}),
                )
            })?;
        }
        test_fault::maybe_fail("raw_spool_rename")?;
        fs::rename(&part, &path).map_err(|error| {
            AppError::new("recovery_write_failed", "Unable to finalize raw response.")
                .with_detail(json!({"from": part.display().to_string(), "to": path.display().to_string(), "error": error.to_string()}))
        })?;
        if let Some(parent) = path.parent()
            && let Ok(dir) = fs::File::open(parent)
        {
            let _ = dir.sync_all();
        }
        test_fault::maybe_abort("raw_spool_renamed");
        test_fault::maybe_fail("metadata_after_spool")?;
        if let Some(attempt) = self.current_attempt_mut() {
            attempt.raw_response_path = Some(path.display().to_string());
        }
        self.state.stage = Some(RecoveryStage::ResponseReceived.as_str().to_string());
        self.state.recoverability = Some(Recoverability::LocalResponseCached.as_str().to_string());
        self.persist_state()?;
        test_fault::maybe_abort("response_received");
        Ok(())
    }

    pub fn maybe_fail_materialize_start(&self) -> Result<(), AppError> {
        test_fault::maybe_fail("materialize_start")
    }

    pub fn mark_stage(&mut self, stage: RecoveryStage) -> Result<(), AppError> {
        self.state.stage = Some(stage.as_str().to_string());
        if stage == RecoveryStage::Completed {
            self.state.recoverability =
                Some(Recoverability::LocalResponseCached.as_str().to_string());
        }
        self.persist_state()
    }

    pub fn finish_error(&mut self, stage: RecoveryStage, error: &AppError) -> Result<(), AppError> {
        if let Some(attempt) = self.current_attempt_mut() {
            attempt.stage_at_failure = Some(stage.as_str().to_string());
            attempt.error_code = Some(error.code.clone());
        }
        if error
            .status_code
            .map(|status| (400..500).contains(&status))
            .unwrap_or(false)
        {
            self.state.recoverability = Some(Recoverability::ProviderRejected.as_str().to_string());
        } else {
            self.state.recoverability = Some(
                classify_from_state_and_evidence(
                    &self.state,
                    raw_response_path(&self.job_dir).is_file(),
                )
                .as_str()
                .to_string(),
            );
        }
        let error_value = json!({
            "failed_at_stage": stage.as_str(),
            "error_code": error.code,
            "message": error.message,
            "detail": error.detail,
        });
        let _ = atomic_write_json(&error_json_path(&self.job_dir), &error_value);
        self.persist_state()
    }
}

pub fn normalize_provider_request_id(headers: &HeaderMap) -> Option<String> {
    for name in ["x-request-id", "request-id", "openai-request-id"] {
        if let Some(value) = headers.get(name)
            && let Ok(text) = value.to_str()
            && !text.trim().is_empty()
        {
            return Some(text.trim().to_string());
        }
    }
    None
}

pub fn materialize_openai_raw_response(
    job_dir: &Path,
    output_path: &Path,
    provider_name: Option<&str>,
) -> Result<Vec<Value>, AppError> {
    let raw_path = raw_response_path(job_dir);
    let raw = fs::read_to_string(&raw_path).map_err(|error| {
        AppError::new(
            "raw_response_missing",
            "Unable to read cached raw response for recovery.",
        )
        .with_detail(json!({"path": raw_path.display().to_string(), "error": error.to_string()}))
    })?;
    let payload: Value = serde_json::from_str(&raw).map_err(|error| {
        AppError::new(
            "invalid_json_response",
            "Cached raw response is not valid JSON.",
        )
        .with_detail(json!({"path": raw_path.display().to_string(), "error": error.to_string()}))
    })?;
    let proxy = effective_proxy_for_provider(provider_name);
    let (image_bytes_list, _) = decode_openai_images(&payload, &proxy)?;
    save_images(output_path, &image_bytes_list)
}

pub fn raw_response_sha256(job_dir: &Path) -> Result<String, AppError> {
    let path = raw_response_path(job_dir);
    let bytes = fs::read(&path).map_err(|error| {
        AppError::new(
            "raw_response_missing",
            "Unable to read cached raw response.",
        )
        .with_detail(json!({"path": path.display().to_string(), "error": error.to_string()}))
    })?;
    let digest = sha2::Sha256::digest(&bytes);
    Ok(format!("{digest:x}"))
}

pub fn batch_recovery_job_id(parent_job_id: &str, index: u8) -> String {
    format!("{parent_job_id}-part-{}", index + 1)
}

pub fn batch_recovery_job_dir(parent_dir: &Path, index: u8) -> PathBuf {
    parent_dir.join(format!("recovery-part-{}", index + 1))
}

pub fn generation_slots_from_batch_payload(
    request_count: usize,
    payload: &Value,
    child_dirs: &[PathBuf],
) -> Vec<Value> {
    let files = payload
        .get("output")
        .and_then(|output| output.get("files"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let errors = payload
        .get("batch")
        .and_then(|batch| batch.get("errors"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    generation_slots_from_outputs(request_count, &files, &errors, child_dirs)
}

pub fn generation_slots_from_outputs(
    request_count: usize,
    files: &[Value],
    errors: &[Value],
    child_dirs: &[PathBuf],
) -> Vec<Value> {
    (0..request_count)
        .map(|index| {
            let file = files
                .iter()
                .find(|file| file.get("index").and_then(Value::as_u64) == Some(index as u64));
            let error = errors
                .iter()
                .find(|error| error.get("index").and_then(Value::as_u64) == Some(index as u64));
            let child_dir = child_dirs.get(index);
            let child_state = child_dir.and_then(|dir| load_recovery_state(dir));
            let recoverability = child_state
                .as_ref()
                .and_then(|state| state.recoverability.as_deref())
                .or_else(|| {
                    child_state.as_ref().map(|state| {
                        classify_from_state_and_evidence(
                            state,
                            child_dir.is_some_and(|dir| raw_response_path(dir).is_file()),
                        )
                        .as_str()
                    })
                })
                .unwrap_or(Recoverability::NeverDispatched.as_str());
            let status = if file.is_some() {
                "completed"
            } else if error.is_some() {
                "failed"
            } else {
                "missing"
            };
            json!({
                "index": index,
                "status": status,
                "path": file.and_then(|file| file.get("path")).cloned().unwrap_or(Value::Null),
                "bytes": file.and_then(|file| file.get("bytes")).cloned().unwrap_or(Value::Null),
                "error": error.and_then(|error| error.get("message")).cloned().unwrap_or(Value::Null),
                "recoverability": recoverability,
                "raw_response_present": child_dir.is_some_and(|dir| raw_response_path(dir).is_file()),
                "recovery_job_dir": child_dir
                    .map(|dir| json!(dir.display().to_string()))
                    .unwrap_or(Value::Null),
            })
        })
        .collect()
}

pub fn missing_generation_slot_indices(metadata: &Value) -> Vec<usize> {
    metadata
        .get("generation_slots")
        .and_then(Value::as_array)
        .map(|slots| {
            slots
                .iter()
                .filter_map(|slot| {
                    let index = slot.get("index").and_then(Value::as_u64)? as usize;
                    let status = slot
                        .get("status")
                        .and_then(Value::as_str)
                        .unwrap_or("missing");
                    if status == "completed" {
                        None
                    } else {
                        Some(index)
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

pub fn write_batch_recovery_summary(
    parent_job_id: &str,
    parent_dir: &Path,
    child_dirs: &[PathBuf],
    outputs_present: usize,
    failures: usize,
    generation_slots: Vec<Value>,
) -> Result<(), AppError> {
    let mut attempts = Vec::new();
    let mut attempts_truncated_count = 0usize;
    let mut child_recoverabilities = Vec::new();
    let mut any_body_completed = false;

    for child_dir in child_dirs {
        let Some(state) = load_recovery_state(child_dir) else {
            continue;
        };
        any_body_completed |= state
            .attempts
            .iter()
            .any(|attempt| attempt.response_body_completed_at.is_some());
        let recoverability = state
            .recoverability
            .as_deref()
            .and_then(Recoverability::parse)
            .unwrap_or_else(|| {
                classify_from_state_and_evidence(&state, raw_response_path(child_dir).is_file())
            });
        child_recoverabilities.push(recoverability);
        attempts_truncated_count += state.attempts_truncated_count;
        for attempt in state.attempts {
            if attempts.len() >= RECOVERY_ATTEMPTS_LIMIT {
                attempts.remove(0);
                attempts_truncated_count += 1;
            }
            attempts.push(attempt);
        }
    }

    if attempts.is_empty() && child_recoverabilities.is_empty() {
        return Ok(());
    }

    let recoverability = batch_recoverability(&child_recoverabilities, outputs_present, failures);
    let stage = if failures == 0 {
        RecoveryStage::Completed
    } else if outputs_present > 0 {
        RecoveryStage::Materialized
    } else if any_body_completed {
        RecoveryStage::ResponseReceived
    } else {
        RecoveryStage::Submitted
    };
    let state = RecoveryState {
        job_id: Some(parent_job_id.to_string()),
        job_dir: Some(parent_dir.display().to_string()),
        stage: Some(stage.as_str().to_string()),
        recoverability: Some(recoverability.as_str().to_string()),
        attempts,
        attempts_truncated_count,
        generation_slots,
        interrupted_reason: None,
    };
    atomic_write_json(
        &recovery_state_path(parent_dir),
        &serde_json::to_value(state).unwrap_or_else(|_| json!({})),
    )
}

fn batch_recoverability(
    child_recoverabilities: &[Recoverability],
    outputs_present: usize,
    failures: usize,
) -> Recoverability {
    if failures > 0 && outputs_present > 0 {
        return Recoverability::PartialOutputs;
    }
    if failures == 0 {
        return child_recoverabilities
            .iter()
            .find(|recoverability| matches!(recoverability, Recoverability::LocalResponseCached))
            .cloned()
            .unwrap_or(Recoverability::NeverDispatched);
    }
    if child_recoverabilities.iter().any(|recoverability| {
        matches!(
            recoverability,
            Recoverability::LocalResponseCached
                | Recoverability::RemoteMaybeAccepted
                | Recoverability::LocalRecoveryUnavailable
                | Recoverability::RemoteInProgress
        )
    }) {
        return Recoverability::RemoteMaybeAccepted;
    }
    if child_recoverabilities
        .iter()
        .any(|recoverability| matches!(recoverability, Recoverability::ProviderRejected))
    {
        return Recoverability::ProviderRejected;
    }
    Recoverability::NeverDispatched
}

pub fn recovery_attempts_from_metadata(metadata: &Value) -> (Vec<Value>, usize) {
    if let Some(job_dir) = recovery_job_dir(metadata)
        && let Some(state) = load_recovery_state(&job_dir)
    {
        return (
            state
                .attempts
                .into_iter()
                .filter_map(|attempt| serde_json::to_value(attempt).ok())
                .collect(),
            state.attempts_truncated_count,
        );
    }
    let attempts = metadata
        .get("attempts")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let truncated = metadata
        .get("attempts_truncated_count")
        .and_then(Value::as_u64)
        .unwrap_or(0) as usize;
    (attempts, truncated)
}

pub fn build_recovery_descriptor(job: &Value) -> Value {
    let metadata = job.get("metadata").cloned().unwrap_or_else(|| json!({}));
    let job_dir = recovery_job_dir(&metadata);
    let raw_present = job_dir
        .as_deref()
        .map(raw_response_path)
        .map(|path| path.is_file())
        .unwrap_or(false);
    let raw_bytes = job_dir
        .as_deref()
        .map(raw_response_path)
        .and_then(|path| fs::metadata(path).ok())
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let mut recoverability = metadata
        .get("recoverability")
        .and_then(Value::as_str)
        .and_then(Recoverability::parse)
        .unwrap_or_else(|| {
            let state = job_dir.as_deref().and_then(load_recovery_state);
            if let Some(state) = state {
                classify_from_state_and_evidence(&state, raw_present)
            } else {
                classify_from_evidence(None, raw_present, None)
            }
        });
    let job_id = job.get("id").and_then(Value::as_str).unwrap_or("");
    let outputs_present = job
        .get("outputs")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0);
    let generation_slots = metadata
        .get("generation_slots")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let outputs_expected = if generation_slots.is_empty() {
        metadata.get("n").and_then(Value::as_u64).unwrap_or(1)
    } else {
        generation_slots.len() as u64
    };
    let upload_failed = outputs_present > 0
        && job
            .get("storage_status")
            .and_then(Value::as_str)
            .map(|status| matches!(status, "failed" | "partial_failed"))
            .unwrap_or(false);
    if upload_failed
        && !matches!(recoverability, Recoverability::PartialOutputs)
        && outputs_present as u64 >= outputs_expected
    {
        recoverability = Recoverability::UploadFailed;
    }
    let is_completed = job
        .get("status")
        .and_then(Value::as_str)
        .map(|status| status == "completed")
        .unwrap_or(false)
        || metadata
            .get("stage")
            .and_then(Value::as_str)
            .map(|stage| stage == RecoveryStage::Completed.as_str())
            .unwrap_or(false);
    let (primary_action, secondary_actions) =
        if is_completed && !matches!(recoverability, Recoverability::UploadFailed) {
            (Value::Null, Vec::new())
        } else {
            recovery_actions(job_id, &recoverability)
        };
    json!({
        "job_id": job_id,
        "recoverability": recoverability.as_str(),
        "primary_action": primary_action,
        "secondary_actions": secondary_actions,
        "evidence": {
            "raw_response_present": raw_present,
            "raw_response_bytes": raw_bytes,
            "outputs_present": outputs_present,
            "outputs_expected": outputs_expected,
            "generation_slots": generation_slots
        }
    })
}

fn recovery_actions(job_id: &str, recoverability: &Recoverability) -> (Value, Vec<Value>) {
    let endpoint = format!("/jobs/{job_id}/resume");
    let continue_save = json!({
        "id": "continue_save",
        "label": "继续完成",
        "endpoint": endpoint,
        "billable": false,
        "explanation": "已收到模型响应，可在不重新生成的前提下完成本地保存。"
    });
    let resubmit = json!({
        "id": "resubmit",
        "label": "重新生成",
        "endpoint": endpoint,
        "billable": true,
        "estimated_cost_label": Value::Null,
        "warning": "将再次调用 API"
    });
    match recoverability {
        Recoverability::LocalResponseCached => (continue_save, vec![resubmit]),
        Recoverability::PartialOutputs => (
            json!({
                "id": "fill_missing",
                "label": "生成缺失的 N 张",
                "endpoint": endpoint,
                "billable": true,
                "estimated_cost_label": Value::Null,
                "warning": "只会为缺失的图片再次调用 API"
            }),
            vec![resubmit],
        ),
        Recoverability::UploadFailed => (
            json!({
                "id": "reupload",
                "label": "重新上传",
                "endpoint": endpoint,
                "billable": false,
                "explanation": "图片已在本地生成，可不重新调用 API 直接重传。"
            }),
            Vec::new(),
        ),
        Recoverability::NeverDispatched => (resubmit, Vec::new()),
        Recoverability::RemoteMaybeAccepted => (
            json!({
                "id": "resubmit",
                "label": "重新生成",
                "endpoint": endpoint,
                "billable": true,
                "estimated_cost_label": Value::Null,
                "warning": "上次请求可能已经被服务端接收；重新生成将再次调用 API"
            }),
            Vec::new(),
        ),
        Recoverability::LocalRecoveryUnavailable => (
            Value::Null,
            vec![json!({
                "id": "resubmit",
                "label": "重新生成",
                "endpoint": endpoint,
                "billable": true,
                "warning": "完整响应曾到达，但恢复源未保存成功；重新生成会再次调用 API"
            })],
        ),
        Recoverability::UserCancelled => (Value::Null, vec![resubmit]),
        _ => (Value::Null, Vec::new()),
    }
}

pub fn mark_interrupted_jobs_on_startup() -> Result<Vec<Value>, AppError> {
    let jobs = list_active_history_jobs()?;
    let mut interrupted = Vec::new();
    for mut job in jobs {
        let metadata = job.get("metadata").cloned().unwrap_or_else(|| json!({}));
        let Some(job_dir) = recovery_job_dir(&metadata) else {
            continue;
        };
        let mut merged = merge_recovery_metadata(metadata, &job_dir);
        if let Value::Object(map) = &mut merged {
            map.insert("interrupted_reason".to_string(), json!("process_killed"));
            if !map.contains_key("recoverability") {
                let state = load_recovery_state(&job_dir);
                let recoverability = state
                    .as_ref()
                    .map(|state| {
                        classify_from_state_and_evidence(
                            state,
                            raw_response_path(&job_dir).is_file(),
                        )
                    })
                    .unwrap_or_else(|| {
                        classify_from_evidence(None, raw_response_path(&job_dir).is_file(), None)
                    });
                map.insert("recoverability".to_string(), json!(recoverability.as_str()));
            }
        }
        let id = job
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let command = job
            .get("command")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let provider = job
            .get("provider")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let created_at = job
            .get("created_at")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let output_path = job
            .get("output_path")
            .and_then(Value::as_str)
            .map(ToString::to_string);
        upsert_history_job(
            &id,
            &command,
            &provider,
            "failed",
            output_path.as_deref().map(Path::new),
            Some(&created_at),
            merged.clone(),
        )?;
        job["status"] = json!("failed");
        job["metadata"] = merged;
        interrupted.push(build_recovery_descriptor(&job));
    }
    Ok(interrupted)
}

#[cfg(feature = "recovery-fault-injection")]
pub mod test_fault {
    use super::*;

    #[derive(Default)]
    struct FaultState {
        fail_at: Option<String>,
        kill_at: Option<String>,
        provider_attempts: BTreeMap<String, u64>,
    }

    static STATE: OnceLock<Mutex<FaultState>> = OnceLock::new();

    fn state() -> &'static Mutex<FaultState> {
        STATE.get_or_init(|| Mutex::new(FaultState::default()))
    }

    pub fn set_faults(fail_at: Option<String>, kill_at: Option<String>) {
        if let Ok(mut state) = state().lock() {
            state.fail_at = fail_at;
            state.kill_at = kill_at;
        }
    }

    pub fn faults_json() -> Value {
        if let Ok(state) = state().lock() {
            return json!({
                "fail_at": state.fail_at,
                "kill_at": state.kill_at,
            });
        }
        json!({})
    }

    pub fn maybe_fail(point: &str) -> Result<(), AppError> {
        let matched = state()
            .lock()
            .ok()
            .and_then(|state| state.fail_at.clone())
            .as_deref()
            == Some(point);
        if matched {
            return Err(AppError::new(
                "recovery_fault_injected",
                format!("Injected recovery failure at {point}."),
            ));
        }
        Ok(())
    }

    pub fn maybe_abort(point: &str) {
        let matched = state()
            .lock()
            .ok()
            .and_then(|state| state.kill_at.clone())
            .as_deref()
            == Some(point);
        if matched {
            std::process::abort();
        }
    }

    pub fn record_provider_http_attempt(job_id: &str) {
        if let Ok(mut state) = state().lock() {
            *state
                .provider_attempts
                .entry(job_id.to_string())
                .or_insert(0) += 1;
        }
    }

    pub fn provider_http_attempts(job_id: &str) -> u64 {
        state()
            .lock()
            .ok()
            .and_then(|state| state.provider_attempts.get(job_id).copied())
            .unwrap_or(0)
    }
}

#[cfg(not(feature = "recovery-fault-injection"))]
pub mod test_fault {
    use super::*;

    pub fn set_faults(_fail_at: Option<String>, _kill_at: Option<String>) {}
    pub fn faults_json() -> Value {
        json!({})
    }
    pub fn maybe_fail(_point: &str) -> Result<(), AppError> {
        Ok(())
    }
    pub fn maybe_abort(_point: &str) {}
    pub fn record_provider_http_attempt(_job_id: &str) {}
    pub fn provider_http_attempts(_job_id: &str) -> u64 {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn descriptor_omits_attempt_details_and_actions_for_completed_jobs() {
        let job = json!({
            "id": "job-1",
            "status": "completed",
            "outputs": [{"path": "/tmp/out.png"}],
            "metadata": {
                "stage": "completed",
                "recoverability": "recoverable.local_response_cached",
                "n": 1,
                "attempts": [{
                    "client_request_id": "client-secret",
                    "provider_request_id": "provider-secret",
                    "raw_response_path": "/tmp/raw_response.json"
                }],
                "attempts_truncated_count": 0
            }
        });

        let descriptor = build_recovery_descriptor(&job);

        assert!(descriptor.get("primary_action").is_some_and(Value::is_null));
        assert_eq!(
            descriptor
                .get("secondary_actions")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(0)
        );
        let evidence = descriptor
            .get("evidence")
            .and_then(Value::as_object)
            .unwrap();
        assert!(evidence.contains_key("raw_response_present"));
        assert!(evidence.contains_key("raw_response_bytes"));
        assert!(evidence.contains_key("outputs_present"));
        assert!(evidence.contains_key("outputs_expected"));
        assert!(!evidence.contains_key("last_attempt"));
        assert!(!evidence.contains_key("stage_reached"));
    }

    #[test]
    fn remote_maybe_accepted_resubmit_warns_about_possible_server_acceptance() {
        let job = json!({
            "id": "job-2",
            "status": "failed",
            "outputs": [],
            "metadata": {
                "recoverability": "ambiguous.remote_maybe_accepted",
                "n": 1
            }
        });

        let descriptor = build_recovery_descriptor(&job);
        let primary = descriptor.get("primary_action").unwrap();

        assert_eq!(primary.get("id").and_then(Value::as_str), Some("resubmit"));
        assert_eq!(primary.get("billable").and_then(Value::as_bool), Some(true));
        assert!(
            primary
                .get("warning")
                .and_then(Value::as_str)
                .is_some_and(|warning| warning.contains("上次请求可能已经被服务端接收"))
        );
    }
}
