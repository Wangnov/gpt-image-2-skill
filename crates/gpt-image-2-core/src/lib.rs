#![allow(unused_imports)]

use std::fs;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use std::{collections::BTreeMap, process::Command, sync::mpsc, thread};

use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use chrono::Utc;
use clap::{ArgAction, Args, Parser, Subcommand, ValueEnum};
use hmac::{Hmac, Mac};
use lettre::message::{Mailbox, header::ContentType};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{Message, SmtpTransport, Transport};
use reqwest::StatusCode;
use reqwest::blocking::multipart::{Form, Part};
use reqwest::blocking::{Client, Response};
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderName, HeaderValue};
use rusqlite::types::Value as SqlValue;
use rusqlite::{Connection, Row, params, params_from_iter};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use url::Url;

mod auth;
mod auth_types;
mod cli_types;
mod config_commands;
mod config_io;
mod config_types;
mod constants;
mod credentials;
mod errors;
mod history_commands;
mod history_db;
mod history_list;
mod image_commands;
mod image_requests;
mod json_events;
mod network_safety;
mod notifications;
mod paths;
mod provider_selection;
mod provider_types;
mod request_commands;
mod request_payloads;
mod runtime_image_args;
mod runtime_request_types;
mod storage;
mod storage_config;
mod transparent;
mod util;

pub(crate) use auth::*;
pub use auth::{inspect_codex_auth_file, inspect_openai_auth};
pub use auth_types::{CodexAuthPersistence, CodexAuthState, OpenAiAuthState};
pub use cli_types::{
    AddProviderArgs, AuthCommand, AuthSubcommand, Background, Cli, Commands, ConfigCommand,
    ConfigSubcommand, EditImageArgs, GenerateImageArgs, HistoryCommand, HistoryShowArgs,
    HistorySubcommand, ImagesCommand, ImagesSubcommand, InputFidelity, ModelsCommand,
    ModelsSubcommand, Moderation, OutputFormat, Quality, RemoveProviderArgs, RequestCommand,
    RequestCreateArgs, RequestOperation, RequestSubcommand, SecretCommand, SecretDeleteArgs,
    SecretGetArgs, SecretSetArgs, SecretSubcommand, SetDefaultArgs, SharedImageArgs,
    TestProviderArgs,
};
pub(crate) use config_commands::*;
pub(crate) use config_io::*;
pub use config_io::{load_app_config, redact_app_config, save_app_config};
pub(crate) use config_types::*;
pub use config_types::{AppConfig, CredentialRef};
pub use constants::{
    CLI_NAME, CONFIG_DIR_NAME, CONFIG_FILE_NAME, DEFAULT_BACKGROUND, DEFAULT_CODEX_ENDPOINT,
    DEFAULT_CODEX_MODEL, DEFAULT_HISTORY_PAGE_LIMIT, DEFAULT_INSTRUCTIONS, DEFAULT_OPENAI_API_BASE,
    DEFAULT_OPENAI_MODEL, DEFAULT_REFRESH_TIMEOUT, DEFAULT_REQUEST_TIMEOUT, DEFAULT_RETRY_COUNT,
    DEFAULT_RETRY_DELAY_SECONDS, DELEGATED_IMAGE_MODEL, ENDPOINT_CHECK_TIMEOUT, EXPORTS_DIR_NAME,
    HISTORY_FILE_NAME, IMAGE_SIZE_MAX_ASPECT_RATIO, IMAGE_SIZE_MAX_EDGE,
    IMAGE_SIZE_MAX_TOTAL_PIXELS, IMAGE_SIZE_MIN_TOTAL_PIXELS, JOBS_DIR_NAME, KEYCHAIN_SERVICE,
    MAX_HISTORY_PAGE_LIMIT, MAX_REFERENCE_IMAGES, OPENAI_API_KEY_ENV, OPENAI_EDITS_PATH,
    OPENAI_GENERATIONS_PATH, PRODUCT_DIR_NAME, REFRESH_CLIENT_ID, REFRESH_ENDPOINT,
    RESULTS_DIR_NAME, VERSION,
};
pub(crate) use credentials::*;
pub use credentials::{default_keychain_account, read_keychain_secret, write_keychain_secret};
pub use errors::{AppError, CommandOutcome};
pub(crate) use history_commands::*;
pub(crate) use history_db::*;
pub use history_db::{
    delete_history_job, list_expired_deleted_history_jobs, restore_deleted_history_job,
    soft_delete_history_job, upsert_history_job,
};
pub(crate) use history_list::*;
pub use history_list::{
    HistoryListOptions, HistoryListPage, list_active_history_jobs, list_history_jobs,
    list_history_jobs_page, show_history_job,
};
pub(crate) use image_commands::*;
pub(crate) use image_requests::*;
pub use json_events::JsonEventLogger;
pub(crate) use network_safety::*;
pub(crate) use notifications::*;
pub use notifications::{
    EmailNotificationConfig, EmailNotificationMessage, EmailTlsMode, NotificationConfig,
    NotificationDelivery, NotificationJob, SystemNotificationConfig, ToastNotificationConfig,
    WebhookNotificationConfig, WebhookRequest, build_email_notification_message,
    build_webhook_request, dispatch_task_notifications, notification_status_allowed,
    preserve_notification_secrets,
};
pub use paths::{
    PRODUCT_CONFIG_FILE_ENV, PRODUCT_HISTORY_FILE_ENV, ProductRuntime, default_auth_path,
    default_config_path, history_db_path, initialize_product_runtime_paths, jobs_dir,
    legacy_jobs_dir, legacy_shared_codex_dir, parse_image_size, product_app_data_dir,
    product_config_path, product_default_export_dir, product_default_export_dirs,
    product_history_db_path, product_result_library_dir, product_storage_fallback_dir,
    shared_config_dir,
};
pub(crate) use paths::{
    cli_config_path, default_legacy_shared_codex_path, default_product_app_data_dir,
    default_product_export_dir, default_storage_fallback_dir, expand_pathbuf_tilde, expand_tilde,
    resolve_codex_home, resolve_path_ref,
};
pub(crate) use provider_selection::*;
pub use provider_types::ProviderConfig;
pub(crate) use provider_types::*;
pub(crate) use request_commands::*;
pub use request_commands::{run, run_json};
pub use request_payloads::build_openai_image_body;
pub(crate) use request_payloads::*;
pub use runtime_image_args::{
    batch_output_path, edit_args, generate_args, output_extension, push_optional,
    push_provider_arg, requested_n,
};
pub use runtime_request_types::{EditRequest, GenerateRequest, UploadFile};
#[cfg(test)]
pub(crate) use storage::backends::s3_endpoint_and_host;
#[cfg(test)]
pub(crate) use storage::backends::{pan123_file_name_from_key, sftp_host_key_matches};
use storage::util::redact_url_for_log;
pub use storage::{
    BaiduNetdiskAuthMode, OutputUploadRecord, Pan123OpenAuthMode, StorageConfig,
    StorageFallbackPolicy, StorageTargetConfig, StorageTestResult, StorageUploadOverrides,
    list_output_upload_records, preserve_storage_secrets, test_storage_target,
    upload_job_outputs_to_storage, upsert_output_upload_record,
};
pub(crate) use storage::{
    enrich_outputs_with_uploads, list_output_upload_records_with_conn, redact_storage_config,
    storage_status_for_uploads,
};
pub(crate) use storage_config::*;
pub use storage_config::{
    ExportDirConfig, ExportDirMode, LegacyPathConfig, PathConfig, PathMode, PathRef,
};
pub(crate) use util::*;

#[cfg(test)]
mod tests;
