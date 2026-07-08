//! Shared job-queue execution runtime for the GPT Image 2 web and desktop
//! surfaces. Both used to carry byte-identical copies of the queue engine,
//! streaming, batch merge, and per-runner logic; this crate holds the single
//! source of truth. The only genuinely runtime-specific seam — pushing a queue
//! event out to a live client — is abstracted behind [`QueueEventSink`]: the
//! web server uses [`NoopSink`] (its SSE layer reads the in-memory queue),
//! while the desktop app emits each event to the webview.
#![allow(unused_imports)]

use std::collections::{BTreeMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Value, json};

// Re-export the core vocabulary so the job-execution modules (which use
// `use super::*`) resolve run_json, requested_n, GenerateRequest, etc.
pub use gpt_image_2_core::*;

mod batch_payloads;
mod edit_runner;
mod generate_runner;
mod job_paths;
mod job_records;
mod provider_capabilities;
mod queue_events;
mod queue_workers;
mod streaming;

pub use batch_payloads::*;
pub use edit_runner::*;
pub use generate_runner::*;
pub use job_paths::*;
pub use job_records::*;
pub use provider_capabilities::*;
pub use queue_events::*;
pub use queue_workers::*;
pub use streaming::*;

/// The surface (Docker/Web server or desktop app) that hosts the shared queue
/// engine, abstracting the handful of genuinely runtime-specific operations:
/// config/paths resolve against a different `ProductRuntime`, notifications
/// dispatch differently, and events may be pushed to a live client. Passed as
/// an `Arc<dyn RuntimeHost>` so the engine stays free of generic parameters.
pub trait RuntimeHost: Send + Sync + 'static {
    /// Load the surface's config (resolved against its `ProductRuntime`).
    fn load_config(&self) -> Result<AppConfig, String>;
    /// The surface's result-library directory.
    fn result_library_dir(&self) -> PathBuf;
    /// Fire the surface's task notifications for a finished job, returning the
    /// per-channel delivery summaries.
    fn dispatch_notifications(&self, job: &Value) -> Vec<Value>;
    /// Push a freshly-recorded queue event to a live client. Every event is
    /// also appended to [`JobQueueInner::events`] regardless; this is the extra
    /// push. The web server no-ops here (its SSE layer pulls from the queue);
    /// the desktop app emits the event to its webview.
    fn emit_event(&self, job_id: &str, event: &Value);
    /// Prefix for generated job ids (`"web"` / `"app"`), so ids stay
    /// distinguishable per surface.
    fn job_id_prefix(&self) -> &'static str;
}

/// Convert a core `AppError` into the flat `code: message` string both surfaces
/// return over their transports.
pub fn app_error(error: AppError) -> String {
    format!("{}: {}", error.code, error.message)
}

/// Pull the human message out of a JobError-shaped value.
pub fn error_message_from_value(error: &Value) -> String {
    error
        .get("message")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .unwrap_or_else(|| "Command failed".to_string())
}

/// In-memory queue shared by both surfaces.
pub struct JobQueueInner {
    pub max_parallel: usize,
    pub running: usize,
    pub queue: VecDeque<QueuedJob>,
    pub events: BTreeMap<String, Vec<Value>>,
    pub next_seq: BTreeMap<String, u64>,
}

impl Default for JobQueueInner {
    fn default() -> Self {
        Self {
            max_parallel: 2,
            running: 0,
            queue: VecDeque::new(),
            events: BTreeMap::new(),
            next_seq: BTreeMap::new(),
        }
    }
}

#[derive(Clone)]
pub enum QueuedTask {
    Generate(GenerateRequest),
    Edit(EditRequest),
}

#[derive(Clone)]
pub struct QueuedJob {
    pub id: String,
    pub command: String,
    pub provider: String,
    pub created_at: String,
    pub dir: PathBuf,
    pub metadata: Value,
    pub task: QueuedTask,
}

/// Wrap a bare error string into the `{ "message": ... }` shape the payload
/// channel uses.
pub fn error_value_from_message(message: impl Into<String>) -> Value {
    json!({ "message": message.into() })
}

/// Run the in-process CLI with `--json`, returning the payload on success or
/// the structured error value on failure.
pub fn cli_json_result(args: &[String]) -> Result<Value, Value> {
    let mut argv = vec!["gpt-image-2-skill".to_string(), "--json".to_string()];
    argv.extend(args.iter().cloned());
    let outcome = run_json(&argv);
    if outcome.exit_status == 0 {
        Ok(outcome.payload)
    } else {
        Err(outcome
            .payload
            .get("error")
            .cloned()
            .unwrap_or_else(|| error_value_from_message("Command failed")))
    }
}
