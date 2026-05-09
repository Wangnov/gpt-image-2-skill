use std::{
    collections::{BTreeMap, VecDeque},
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex, mpsc},
    thread,
    time::{SystemTime, UNIX_EPOCH},
};

use gpt_image_2_core::{
    AppConfig, CredentialRef, EditRequest, GenerateRequest, HistoryListOptions, KEYCHAIN_SERVICE,
    NotificationConfig, PathConfig, ProductRuntime, ProviderConfig, StorageConfig,
    StorageTargetConfig, StorageUploadOverrides, UploadFile, batch_output_path,
    default_config_path, default_keychain_account, delete_history_job, dispatch_task_notifications,
    edit_args, generate_args, history_db_path, initialize_product_runtime_paths, legacy_jobs_dir,
    legacy_shared_codex_dir, list_active_history_jobs, list_expired_deleted_history_jobs,
    list_history_jobs_page, load_app_config, notification_status_allowed, output_extension,
    preserve_notification_secrets, preserve_storage_secrets, product_app_data_dir,
    product_default_export_dir, product_default_export_dirs, product_result_library_dir,
    product_storage_fallback_dir, read_keychain_secret, redact_app_config, requested_n,
    restore_deleted_history_job, run_json, save_app_config, shared_config_dir, show_history_job,
    soft_delete_history_job, upload_job_outputs_to_storage, upsert_history_job,
    write_keychain_secret,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::{Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

mod direct_commands;
mod dropped_files;
mod export_commands;
mod export_names;
mod file_access;
mod history_commands;
mod job_commands;
mod job_execution;
mod provider_config;
mod queue_commands;
mod queue_workers;
mod retry_commands;
mod settings_commands;
mod support;
mod types;

pub(crate) use direct_commands::*;
pub(crate) use dropped_files::*;
pub(crate) use export_commands::*;
pub(crate) use export_names::*;
pub(crate) use file_access::*;
pub(crate) use history_commands::*;
pub(crate) use job_commands::*;
pub(crate) use job_execution::*;
pub(crate) use provider_config::*;
pub(crate) use queue_commands::*;
pub(crate) use queue_workers::*;
pub(crate) use retry_commands::*;
pub(crate) use settings_commands::*;
pub(crate) use support::*;
pub(crate) use types::*;

#[cfg(test)]
mod tests;

pub fn run() {
    let _ = initialize_product_runtime_paths(ProductRuntime::Tauri);
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_drag::init())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            let window = app
                .get_webview_window("main")
                .or_else(|| app.webview_windows().into_values().next());
            if let Some(window) = window {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|_app| {
            // Off-thread so a slow filesystem walk can't delay startup, and
            // periodic so undo windows that elapse mid-session still get
            // finalized without waiting for the next app launch.
            spawn_trash_cleanup_worker();
            Ok(())
        })
        .manage(JobQueueState::default())
        .invoke_handler(tauri::generate_handler![
            config_path,
            get_config,
            update_notifications,
            update_paths,
            update_storage,
            test_notifications,
            test_storage_target,
            notification_capabilities,
            config_inspect,
            config_save,
            set_default_provider,
            upsert_provider,
            reveal_provider_credential,
            delete_provider,
            provider_test,
            history_list,
            history_active_list,
            history_show,
            history_delete,
            queue_status,
            set_queue_concurrency,
            cancel_job,
            retry_job,
            read_dropped_image_files,
            enqueue_generate_image,
            enqueue_edit_image,
            generate_image,
            edit_image,
            open_path,
            reveal_path,
            export_files_to_downloads,
            export_job_to_downloads,
            export_files_to_configured_folder,
            export_job_to_configured_folder,
            read_image_bytes,
            copy_image_to_clipboard,
            soft_delete_job,
            restore_deleted_job,
            hard_delete_job,
        ])
        .run(tauri::generate_context!())
        .expect("error while running gpt-image-2-app");
}
