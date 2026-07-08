use std::{
    collections::BTreeMap,
    env, fs,
    path::{Path as FsPath, PathBuf},
    sync::{Arc, Mutex, mpsc},
    thread,
    time::SystemTime,
};

use axum::{
    Json, Router,
    body::Body,
    extract::{Path, Query, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post, put},
};
use gpt_image_2_core::{
    AppConfig, CONFIG_DIR_NAME, CredentialRef, EditRequest, GenerateRequest, HistoryListOptions,
    KEYCHAIN_SERVICE, LogLevel, LoggingConfig, NotificationConfig, PathConfig, ProductRuntime,
    ProviderConfig, ProxyConfig, StorageConfig, StorageReadbackOptions, StorageTargetConfig,
    StorageUploadOverrides, UploadFile, annotate_recovery_job_dir, append_history_job_event,
    apply_logging_config, batch_output_path, batch_recovery_job_dir, batch_recovery_job_id,
    build_recovery_descriptor, default_config_path, default_keychain_account, delete_history_job,
    dispatch_task_notifications, edit_args_with_recovery, generate_args_with_recovery,
    generation_slots_from_batch_payload, generation_slots_from_outputs, history_db_path,
    init_logging, initialize_product_runtime_paths, legacy_jobs_dir, legacy_shared_codex_dir,
    list_active_history_jobs, list_history_job_events, list_history_jobs_page, load_app_config,
    log_event, logs_dir, mark_interrupted_jobs_on_startup, materialize_openai_raw_response,
    merge_recovery_metadata, missing_generation_slot_indices, notification_status_allowed,
    output_extension, preserve_notification_secrets, preserve_storage_secrets,
    product_app_data_dir, product_default_export_dir, product_default_export_dirs,
    product_result_library_dir, product_storage_fallback_dir, raw_response_path,
    read_job_output_from_storage_with_options, read_keychain_secret, read_recent_logs,
    recovery_job_dir, redact_app_config, requested_n, run_json, save_app_config, shared_config_dir,
    show_history_job, test_fault, test_storage_target, upload_job_outputs_to_storage,
    upsert_history_job, write_batch_recovery_summary, write_keychain_secret,
};
use serde::Deserialize;
use serde_json::{Value, json};
use tower_http::services::{ServeDir, ServeFile};

mod auth;
mod config_api;
mod error;
mod file_api;
mod history_api;
mod job_execution;
mod provider_config;
mod queue_api;
mod queue_workers;
mod recovery_api;
mod retry_api;
mod server;
mod support;
mod types;

pub(crate) use auth::*;
pub(crate) use config_api::*;
pub(crate) use error::*;
pub(crate) use file_api::*;
pub(crate) use history_api::*;
pub(crate) use job_execution::*;
pub(crate) use provider_config::*;
pub(crate) use queue_api::*;
pub(crate) use queue_workers::*;
pub(crate) use recovery_api::*;
pub(crate) use retry_api::*;
pub(crate) use server::*;
pub(crate) use support::*;
pub(crate) use types::*;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let _ = initialize_product_runtime_paths(ProductRuntime::DockerWeb);
    init_logging(&load_config_or_default(), ProductRuntime::DockerWeb);
    log_event(
        LogLevel::Info,
        "local",
        "app.started",
        json!({ "runtime": "web", "version": env!("CARGO_PKG_VERSION") }),
    );
    let settings = parse_settings().map_err(std::io::Error::other)?;
    if !settings.static_dir.is_dir() {
        return Err(format!(
            "Static directory does not exist: {}",
            settings.static_dir.display()
        )
        .into());
    }
    // Refuses to bind a non-loopback host without GPT_IMAGE_2_WEB_TOKEN.
    let auth_policy = AuthPolicy::from_env(&settings.host).map_err(std::io::Error::other)?;
    if auth_policy.requires_token() {
        println!("gpt-image-2-web: access token required (GPT_IMAGE_2_WEB_TOKEN is set).");
    } else {
        println!("gpt-image-2-web: no access token set; only loopback Host headers are served.");
    }
    let _ = mark_interrupted_jobs_on_startup();
    let static_files = ServeDir::new(&settings.static_dir)
        .not_found_service(ServeFile::new(settings.static_dir.join("index.html")));
    let app = Router::new()
        .nest("/api", api_router(JobQueueState::with_auth(auth_policy)))
        .fallback_service(static_files);
    let listener =
        tokio::net::TcpListener::bind(format!("{}:{}", settings.host, settings.port)).await?;
    println!(
        "gpt-image-2-web listening on http://{}:{}",
        settings.host, settings.port
    );
    axum::serve(listener, app).await?;
    Ok(())
}
