use std::fs;
use std::io::{self, BufRead, BufReader, Read};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use std::{collections::BTreeMap, process::Command};

use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use clap::{ArgAction, Args, Parser, Subcommand, ValueEnum};
use reqwest::StatusCode;
use reqwest::blocking::multipart::{Form, Part};
use reqwest::blocking::{Client, Response};
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use rusqlite::{Connection, Row, params};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use url::Url;

pub const CLI_NAME: &str = "gpt-image-2-skill";
pub const OPENAI_API_KEY_ENV: &str = "OPENAI_API_KEY";
pub const DEFAULT_CODEX_ENDPOINT: &str = "https://chatgpt.com/backend-api/codex/responses";
pub const DEFAULT_OPENAI_API_BASE: &str = "https://api.openai.com/v1";
pub const OPENAI_GENERATIONS_PATH: &str = "/images/generations";
pub const OPENAI_EDITS_PATH: &str = "/images/edits";
pub const DEFAULT_CODEX_MODEL: &str = "gpt-5.4";
pub const DEFAULT_OPENAI_MODEL: &str = "gpt-image-2";
pub const DEFAULT_INSTRUCTIONS: &str = "You are a concise assistant.";
pub const DEFAULT_BACKGROUND: &str = "auto";
pub const DEFAULT_RETRY_COUNT: usize = 3;
pub const DEFAULT_RETRY_DELAY_SECONDS: u64 = 1;
pub const DEFAULT_REQUEST_TIMEOUT: u64 = 300;
pub const DEFAULT_REFRESH_TIMEOUT: u64 = 60;
pub const ENDPOINT_CHECK_TIMEOUT: u64 = 5;
pub const IMAGE_SIZE_MAX_EDGE: u32 = 3840;
pub const IMAGE_SIZE_MIN_TOTAL_PIXELS: u32 = 655_360;
pub const IMAGE_SIZE_MAX_TOTAL_PIXELS: u32 = 8_294_400;
pub const IMAGE_SIZE_MAX_ASPECT_RATIO: f64 = 3.0;
pub const MAX_REFERENCE_IMAGES: usize = 16;
pub const REFRESH_ENDPOINT: &str = "https://auth.openai.com/oauth/token";
pub const REFRESH_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
pub const DELEGATED_IMAGE_MODEL: &str = "gpt-image-2";
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
pub const CONFIG_DIR_NAME: &str = "gpt-image-2-skill";
pub const CONFIG_FILE_NAME: &str = "config.json";
pub const HISTORY_FILE_NAME: &str = "history.sqlite";
pub const JOBS_DIR_NAME: &str = "jobs";
pub const KEYCHAIN_SERVICE: &str = "gpt-image-2-skill";

#[derive(Debug, Clone)]
pub struct AppError {
    pub code: String,
    pub message: String,
    pub detail: Option<Value>,
    pub exit_status: i32,
    pub status_code: Option<u16>,
}

impl AppError {
    fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            detail: None,
            exit_status: 1,
            status_code: None,
        }
    }

    fn with_detail(mut self, detail: Value) -> Self {
        self.detail = Some(detail);
        self
    }

    fn with_exit_status(mut self, exit_status: i32) -> Self {
        self.exit_status = exit_status;
        self
    }

    fn with_status_code(mut self, status_code: u16) -> Self {
        self.status_code = Some(status_code);
        self
    }
}

#[derive(Debug, Serialize)]
pub struct CommandOutcome {
    pub payload: Value,
    pub exit_status: i32,
}

#[derive(Debug, Clone)]
pub struct CodexAuthState {
    pub auth_path: PathBuf,
    pub auth_json: Value,
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub account_id: String,
    pub persistence: CodexAuthPersistence,
}

#[derive(Debug, Clone)]
pub enum CodexAuthPersistence {
    AuthFile,
    ConfigProvider {
        config_path: PathBuf,
        provider_name: String,
        credential_sources: BTreeMap<String, CredentialRef>,
    },
    SessionOnly,
}

#[derive(Debug, Clone)]
pub struct OpenAiAuthState {
    pub api_key: String,
    pub source: String,
}

#[derive(Debug, Clone, Eq, PartialEq)]
enum ProviderKind {
    OpenAi,
    Codex,
}

#[derive(Debug, Clone)]
struct ProviderSelection {
    requested: String,
    resolved: String,
    reason: String,
    kind: ProviderKind,
    api_base: String,
    codex_endpoint: String,
    default_model: String,
    supports_n: bool,
    edit_region_mode: String,
}

impl ProviderSelection {
    fn payload(&self) -> Value {
        json!({
            "requested": self.requested,
            "resolved": self.resolved,
            "kind": match self.kind {
                ProviderKind::OpenAi => "openai-compatible",
                ProviderKind::Codex => "codex",
            },
            "reason": self.reason,
            "supports_n": self.supports_n,
            "edit_region_mode": self.edit_region_mode,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
#[serde(tag = "source", rename_all = "lowercase")]
pub enum CredentialRef {
    File {
        value: String,
    },
    Env {
        env: String,
    },
    Keychain {
        service: Option<String>,
        account: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProviderConfig {
    #[serde(rename = "type")]
    pub provider_type: String,
    #[serde(default)]
    pub api_base: Option<String>,
    #[serde(default)]
    pub endpoint: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub credentials: BTreeMap<String, CredentialRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supports_n: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edit_region_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub version: u32,
    #[serde(default)]
    pub default_provider: Option<String>,
    #[serde(default)]
    pub providers: BTreeMap<String, ProviderConfig>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            version: 1,
            default_provider: None,
            providers: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, ValueEnum)]
pub enum Background {
    Auto,
    Transparent,
    Opaque,
}

impl Background {
    fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Transparent => "transparent",
            Self::Opaque => "opaque",
        }
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, ValueEnum)]
pub enum Quality {
    Auto,
    Low,
    Medium,
    High,
}

impl Quality {
    fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
        }
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, ValueEnum)]
pub enum OutputFormat {
    Png,
    Jpeg,
    Webp,
}

impl OutputFormat {
    fn as_str(self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Jpeg => "jpeg",
            Self::Webp => "webp",
        }
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, ValueEnum)]
pub enum Moderation {
    Auto,
    Low,
}

impl Moderation {
    fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Low => "low",
        }
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, ValueEnum)]
pub enum InputFidelity {
    High,
    Low,
}

impl InputFidelity {
    fn as_str(self) -> &'static str {
        match self {
            Self::High => "high",
            Self::Low => "low",
        }
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, ValueEnum)]
pub enum RequestOperation {
    Responses,
    Generate,
    Edit,
}

impl RequestOperation {
    fn as_str(self) -> &'static str {
        match self {
            Self::Responses => "responses",
            Self::Generate => "generate",
            Self::Edit => "edit",
        }
    }
}

#[derive(Parser, Debug)]
#[command(name = CLI_NAME, version = VERSION, about = "Agent-first GPT Image 2 CLI through OpenAI or Codex auth.")]
pub struct Cli {
    #[arg(long, action = ArgAction::SetTrue, default_value_t = true)]
    pub json: bool,
    #[arg(long, default_value = "auto")]
    pub provider: String,
    #[arg(long)]
    pub api_key: Option<String>,
    #[arg(long)]
    pub config: Option<String>,
    #[arg(long, default_value_t = default_auth_path().display().to_string())]
    pub auth_file: String,
    #[arg(long, default_value = DEFAULT_CODEX_ENDPOINT)]
    pub endpoint: String,
    #[arg(long, default_value = DEFAULT_OPENAI_API_BASE)]
    pub openai_api_base: String,
    #[arg(long, action = ArgAction::SetTrue)]
    pub json_events: bool,
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand, Debug)]
pub enum Commands {
    Doctor,
    Auth(AuthCommand),
    Config(ConfigCommand),
    Secret(SecretCommand),
    History(HistoryCommand),
    Models(ModelsCommand),
    Images(ImagesCommand),
    Request(RequestCommand),
}

#[derive(Args, Debug)]
pub struct AuthCommand {
    #[command(subcommand)]
    pub auth_command: AuthSubcommand,
}

#[derive(Subcommand, Debug)]
pub enum AuthSubcommand {
    Inspect,
}

#[derive(Args, Debug)]
pub struct ConfigCommand {
    #[command(subcommand)]
    pub config_command: ConfigSubcommand,
}

#[derive(Subcommand, Debug)]
pub enum ConfigSubcommand {
    Path,
    Inspect,
    ListProviders,
    SetDefault(SetDefaultArgs),
    AddProvider(Box<AddProviderArgs>),
    RemoveProvider(RemoveProviderArgs),
    TestProvider(TestProviderArgs),
}

#[derive(Args, Debug)]
pub struct SetDefaultArgs {
    pub name: String,
}

#[derive(Args, Debug)]
pub struct AddProviderArgs {
    #[arg(long)]
    pub name: String,
    #[arg(long = "type", default_value = "openai-compatible")]
    pub provider_type: String,
    #[arg(long)]
    pub api_base: Option<String>,
    #[arg(long)]
    pub endpoint: Option<String>,
    #[arg(long)]
    pub model: Option<String>,
    #[arg(long)]
    pub api_key: Option<String>,
    #[arg(long)]
    pub api_key_env: Option<String>,
    #[arg(long)]
    pub account_id: Option<String>,
    #[arg(long)]
    pub access_token: Option<String>,
    #[arg(long)]
    pub refresh_token: Option<String>,
    #[arg(long, action = ArgAction::SetTrue)]
    pub supports_n: bool,
    #[arg(long, action = ArgAction::SetTrue)]
    pub no_supports_n: bool,
    #[arg(long)]
    pub edit_region_mode: Option<String>,
    #[arg(long, action = ArgAction::SetTrue)]
    pub set_default: bool,
}

#[derive(Args, Debug)]
pub struct RemoveProviderArgs {
    pub name: String,
}

#[derive(Args, Debug)]
pub struct TestProviderArgs {
    pub name: String,
}

#[derive(Args, Debug)]
pub struct SecretCommand {
    #[command(subcommand)]
    pub secret_command: SecretSubcommand,
}

#[derive(Subcommand, Debug)]
pub enum SecretSubcommand {
    Set(SecretSetArgs),
    Get(SecretGetArgs),
    Delete(SecretDeleteArgs),
}

#[derive(Args, Debug)]
pub struct SecretSetArgs {
    pub provider: String,
    pub name: String,
    #[arg(long, default_value = "file")]
    pub source: String,
    #[arg(long)]
    pub value: Option<String>,
    #[arg(long)]
    pub env: Option<String>,
    #[arg(long)]
    pub account: Option<String>,
}

#[derive(Args, Debug)]
pub struct SecretGetArgs {
    pub provider: String,
    pub name: String,
    #[arg(long, action = ArgAction::SetTrue)]
    pub status: bool,
}

#[derive(Args, Debug)]
pub struct SecretDeleteArgs {
    pub provider: String,
    pub name: String,
}

#[derive(Args, Debug)]
pub struct HistoryCommand {
    #[command(subcommand)]
    pub history_command: HistorySubcommand,
}

#[derive(Subcommand, Debug)]
pub enum HistorySubcommand {
    List,
    Show(HistoryShowArgs),
    OpenOutput(HistoryShowArgs),
    Delete(HistoryShowArgs),
}

#[derive(Args, Debug)]
pub struct HistoryShowArgs {
    pub job_id: String,
}

#[derive(Args, Debug)]
pub struct ModelsCommand {
    #[command(subcommand)]
    pub models_command: ModelsSubcommand,
}

#[derive(Subcommand, Debug)]
pub enum ModelsSubcommand {
    List,
}

#[derive(Args, Debug, Clone)]
pub struct SharedImageArgs {
    #[arg(long)]
    pub prompt: String,
    #[arg(long)]
    pub out: String,
    #[arg(short = 'm', long)]
    pub model: Option<String>,
    #[arg(long, default_value = DEFAULT_INSTRUCTIONS)]
    pub instructions: String,
    #[arg(long, value_enum, default_value = DEFAULT_BACKGROUND)]
    pub background: Background,
    #[arg(long, value_parser = parse_image_size)]
    pub size: Option<String>,
    #[arg(long, value_enum)]
    pub quality: Option<Quality>,
    #[arg(long = "format", value_enum)]
    pub output_format: Option<OutputFormat>,
    #[arg(long = "compression", value_parser = clap::value_parser!(u8).range(0..=100))]
    pub output_compression: Option<u8>,
    #[arg(long, value_parser = clap::value_parser!(u8).range(1..=10))]
    pub n: Option<u8>,
    #[arg(long, value_enum)]
    pub moderation: Option<Moderation>,
}

#[derive(Args, Debug)]
pub struct ImagesCommand {
    #[command(subcommand)]
    pub images_command: ImagesSubcommand,
}

#[derive(Subcommand, Debug)]
pub enum ImagesSubcommand {
    Generate(GenerateImageArgs),
    Edit(EditImageArgs),
}

#[derive(Args, Debug, Clone)]
pub struct GenerateImageArgs {
    #[command(flatten)]
    pub shared: SharedImageArgs,
}

#[derive(Args, Debug, Clone)]
pub struct EditImageArgs {
    #[command(flatten)]
    pub shared: SharedImageArgs,
    #[arg(long = "ref-image", required = true)]
    pub ref_image: Vec<String>,
    #[arg(long)]
    pub mask: Option<String>,
    #[arg(long, value_enum)]
    pub input_fidelity: Option<InputFidelity>,
}

#[derive(Args, Debug)]
pub struct RequestCommand {
    #[command(subcommand)]
    pub request_command: RequestSubcommand,
}

#[derive(Subcommand, Debug)]
pub enum RequestSubcommand {
    Create(RequestCreateArgs),
}

#[derive(Args, Debug)]
pub struct RequestCreateArgs {
    #[arg(long)]
    pub body_file: String,
    #[arg(long, value_enum, default_value = "responses")]
    pub request_operation: RequestOperation,
    #[arg(long)]
    pub out_image: Option<String>,
    #[arg(long, action = ArgAction::SetTrue)]
    pub expect_image: bool,
}

pub struct JsonEventLogger {
    enabled: bool,
    seq: u64,
}

impl JsonEventLogger {
    pub fn new(enabled: bool) -> Self {
        Self { enabled, seq: 0 }
    }

    fn emit(&mut self, kind: &str, type_name: &str, data: Value) {
        if !self.enabled {
            return;
        }
        self.seq += 1;
        let record = json!({
            "seq": self.seq,
            "kind": kind,
            "type": type_name,
            "data": data,
        });
        eprintln!(
            "{}",
            serde_json::to_string(&record).unwrap_or_else(|_| {
                "{\"kind\":\"local\",\"type\":\"event_logger_failed\"}".to_string()
            })
        );
    }
}

pub fn parse_image_size(value: &str) -> Result<String, String> {
    let normalized = value.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return Err("Image size must be auto, 2K, 4K, or WIDTHxHEIGHT.".to_string());
    }
    if normalized == "auto" {
        return Ok("auto".to_string());
    }
    if normalized == "2k" {
        return Ok("2048x2048".to_string());
    }
    if normalized == "4k" {
        return Ok("3840x2160".to_string());
    }
    let Some((width_text, height_text)) = normalized.split_once('x') else {
        return Err("Image size must be auto, 2K, 4K, or WIDTHxHEIGHT.".to_string());
    };
    let width: u32 = width_text
        .parse()
        .map_err(|_| "Image size must be auto, 2K, 4K, or WIDTHxHEIGHT.".to_string())?;
    let height: u32 = height_text
        .parse()
        .map_err(|_| "Image size must be auto, 2K, 4K, or WIDTHxHEIGHT.".to_string())?;
    if width == 0 || height == 0 {
        return Err("Image size must use positive width and height values.".to_string());
    }
    if !width.is_multiple_of(16) || !height.is_multiple_of(16) {
        return Err(
            "Image size must use width and height values that are multiples of 16.".to_string(),
        );
    }
    if width.max(height) > IMAGE_SIZE_MAX_EDGE {
        return Err(format!(
            "Image size supports a maximum edge of {}px.",
            IMAGE_SIZE_MAX_EDGE
        ));
    }
    let total_pixels = width.saturating_mul(height);
    if total_pixels < IMAGE_SIZE_MIN_TOTAL_PIXELS {
        return Err(format!(
            "Image size supports at least {} total pixels.",
            IMAGE_SIZE_MIN_TOTAL_PIXELS
        ));
    }
    if total_pixels > IMAGE_SIZE_MAX_TOTAL_PIXELS {
        return Err(format!(
            "Image size supports up to {} total pixels.",
            IMAGE_SIZE_MAX_TOTAL_PIXELS
        ));
    }
    let aspect_ratio = width.max(height) as f64 / width.min(height) as f64;
    if aspect_ratio > IMAGE_SIZE_MAX_ASPECT_RATIO {
        return Err(format!(
            "Image size supports a maximum aspect ratio of {}:1.",
            IMAGE_SIZE_MAX_ASPECT_RATIO
        ));
    }
    Ok(format!("{width}x{height}"))
}

pub fn default_auth_path() -> PathBuf {
    resolve_codex_home().join("auth.json")
}

pub fn shared_config_dir() -> PathBuf {
    resolve_codex_home().join(CONFIG_DIR_NAME)
}

pub fn default_config_path() -> PathBuf {
    shared_config_dir().join(CONFIG_FILE_NAME)
}

pub fn history_db_path() -> PathBuf {
    shared_config_dir().join(HISTORY_FILE_NAME)
}

pub fn jobs_dir() -> PathBuf {
    shared_config_dir().join(JOBS_DIR_NAME)
}

fn cli_config_path(cli: &Cli) -> PathBuf {
    cli.config
        .as_deref()
        .map(expand_tilde)
        .unwrap_or_else(default_config_path)
}

fn resolve_codex_home() -> PathBuf {
    if let Some(value) = std::env::var_os("CODEX_HOME")
        && !value.is_empty()
    {
        return PathBuf::from(value);
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".codex")
}

fn expand_tilde(value: &str) -> PathBuf {
    if value == "~" {
        return dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    }
    if let Some(rest) = value.strip_prefix("~/") {
        return dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(rest);
    }
    PathBuf::from(value)
}

pub fn load_app_config(path: &Path) -> Result<AppConfig, AppError> {
    if !path.is_file() {
        return Ok(AppConfig::default());
    }
    let raw = fs::read_to_string(path).map_err(|error| {
        AppError::new("config_read_failed", "Unable to read config file.").with_detail(
            json!({"config_file": path.display().to_string(), "error": error.to_string()}),
        )
    })?;
    serde_json::from_str(&raw).map_err(|error| {
        AppError::new("config_invalid_json", "Config file must be valid JSON.").with_detail(
            json!({"config_file": path.display().to_string(), "error": error.to_string()}),
        )
    })
}

pub fn save_app_config(path: &Path, config: &AppConfig) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            AppError::new("config_write_failed", "Unable to create config directory.").with_detail(
                json!({"config_file": path.display().to_string(), "error": error.to_string()}),
            )
        })?;
    }
    let mut content = serde_json::to_string_pretty(config).map_err(|error| {
        AppError::new("config_write_failed", "Unable to serialize config.")
            .with_detail(json!({"error": error.to_string()}))
    })?;
    content.push('\n');
    fs::write(path, content).map_err(|error| {
        AppError::new("config_write_failed", "Unable to write config file.").with_detail(
            json!({"config_file": path.display().to_string(), "error": error.to_string()}),
        )
    })?;
    set_private_file_permissions(path)?;
    Ok(())
}

#[cfg(unix)]
fn set_private_file_permissions(path: &Path) -> Result<(), AppError> {
    use std::os::unix::fs::PermissionsExt;
    let mut permissions = fs::metadata(path)
        .map_err(|error| {
            AppError::new(
                "config_write_failed",
                "Unable to inspect config permissions.",
            )
            .with_detail(
                json!({"config_file": path.display().to_string(), "error": error.to_string()}),
            )
        })?
        .permissions();
    permissions.set_mode(0o600);
    fs::set_permissions(path, permissions).map_err(|error| {
        AppError::new("config_write_failed", "Unable to set config permissions.").with_detail(
            json!({"config_file": path.display().to_string(), "error": error.to_string()}),
        )
    })
}

#[cfg(not(unix))]
fn set_private_file_permissions(_path: &Path) -> Result<(), AppError> {
    Ok(())
}

fn redact_credential_ref(value: &CredentialRef) -> Value {
    match value {
        CredentialRef::File { value } => json!({
            "source": "file",
            "present": !value.is_empty(),
            "value": {"_omitted": "secret"},
        }),
        CredentialRef::Env { env } => json!({
            "source": "env",
            "env": env,
            "present": std::env::var(env).map(|value| !value.trim().is_empty()).unwrap_or(false),
        }),
        CredentialRef::Keychain { service, account } => json!({
            "source": "keychain",
            "service": service.as_deref().unwrap_or(KEYCHAIN_SERVICE),
            "account": account,
            "present": read_keychain_secret(service.as_deref().unwrap_or(KEYCHAIN_SERVICE), account).is_ok(),
        }),
    }
}

pub fn redact_app_config(config: &AppConfig) -> Value {
    let providers = config
        .providers
        .iter()
        .map(|(name, provider)| {
            let credentials = provider
                .credentials
                .iter()
                .map(|(key, value)| (key.clone(), redact_credential_ref(value)))
                .collect::<Map<String, Value>>();
            (
                name.clone(),
                json!({
                    "type": provider.provider_type,
                    "api_base": provider.api_base,
                    "endpoint": provider.endpoint,
                    "model": provider.model,
                    "supports_n": provider.supports_n,
                    "credentials": credentials,
                }),
            )
        })
        .collect::<Map<String, Value>>();
    json!({
        "version": config.version,
        "default_provider": config.default_provider,
        "providers": providers,
    })
}

fn provider_is_builtin(name: &str) -> bool {
    matches!(name, "auto" | "openai" | "codex")
}

fn validate_provider_name(name: &str) -> Result<(), AppError> {
    if name.trim().is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains(char::is_whitespace)
    {
        return Err(AppError::new(
            "provider_invalid_name",
            "Provider name must be a non-empty path-safe token.",
        ));
    }
    Ok(())
}

pub fn default_keychain_account(provider: &str, secret: &str) -> String {
    format!("providers/{provider}/{secret}")
}

pub fn read_keychain_secret(service: &str, account: &str) -> Result<String, AppError> {
    let entry = keyring::Entry::new(service, account).map_err(|error| {
        AppError::new("keychain_error", "Unable to open keychain entry.").with_detail(
            json!({"service": service, "account": account, "error": error.to_string()}),
        )
    })?;
    entry.get_password().map_err(|error| {
        AppError::new("keychain_missing", "Unable to read keychain secret.").with_detail(
            json!({"service": service, "account": account, "error": error.to_string()}),
        )
    })
}

pub fn write_keychain_secret(service: &str, account: &str, value: &str) -> Result<(), AppError> {
    let entry = keyring::Entry::new(service, account).map_err(|error| {
        AppError::new("keychain_error", "Unable to open keychain entry.").with_detail(
            json!({"service": service, "account": account, "error": error.to_string()}),
        )
    })?;
    entry.set_password(value).map_err(|error| {
        AppError::new("keychain_write_failed", "Unable to write keychain secret.").with_detail(
            json!({"service": service, "account": account, "error": error.to_string()}),
        )
    })
}

fn delete_keychain_secret(service: &str, account: &str) -> Result<(), AppError> {
    let entry = keyring::Entry::new(service, account).map_err(|error| {
        AppError::new("keychain_error", "Unable to open keychain entry.").with_detail(
            json!({"service": service, "account": account, "error": error.to_string()}),
        )
    })?;
    entry.delete_credential().map_err(|error| {
        AppError::new(
            "keychain_delete_failed",
            "Unable to delete keychain secret.",
        )
        .with_detail(json!({"service": service, "account": account, "error": error.to_string()}))
    })
}

fn resolve_credential(credential: &CredentialRef) -> Result<(String, String), AppError> {
    match credential {
        CredentialRef::File { value } => {
            if value.trim().is_empty() {
                Err(AppError::new(
                    "credential_missing",
                    "File credential is empty.",
                ))
            } else {
                Ok((value.clone(), "file".to_string()))
            }
        }
        CredentialRef::Env { env } => match std::env::var(env) {
            Ok(value) if !value.trim().is_empty() => Ok((value, format!("env:{env}"))),
            _ => Err(AppError::new(
                "credential_missing",
                format!("Missing environment credential: {env}"),
            )),
        },
        CredentialRef::Keychain { service, account } => {
            let service = service.as_deref().unwrap_or(KEYCHAIN_SERVICE);
            read_keychain_secret(service, account)
                .map(|value| (value, format!("keychain:{account}")))
        }
    }
}

fn get_provider_credential(
    provider_name: &str,
    provider: &ProviderConfig,
    key: &str,
) -> Result<(String, String), AppError> {
    provider
        .credentials
        .get(key)
        .ok_or_else(|| {
            AppError::new("credential_missing", format!("Missing credential: {key}"))
                .with_detail(json!({"provider": provider_name, "credential": key}))
        })
        .and_then(resolve_credential)
}

fn build_user_agent() -> String {
    format!("{CLI_NAME}/{VERSION} local-cli")
}

fn now_iso() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    now.to_string()
}

fn emit_json(payload: &Value) {
    println!(
        "{}",
        serde_json::to_string_pretty(payload).unwrap_or_else(|_| "{\"ok\":false}".to_string())
    );
}

fn build_error_payload(error: AppError) -> (Value, i32) {
    let mut error_obj = json!({
        "code": error.code,
        "message": error.message,
    });
    if let Some(detail) = error.detail {
        error_obj["detail"] = redact_event_payload(&detail);
    }
    (
        json!({
            "ok": false,
            "error": error_obj,
        }),
        error.exit_status,
    )
}

fn json_object(value: &Value) -> Result<&Map<String, Value>, AppError> {
    value
        .as_object()
        .ok_or_else(|| AppError::new("invalid_json_shape", "Expected a JSON object."))
}

fn get_token_container(auth_json: &Value) -> &Map<String, Value> {
    auth_json
        .get("tokens")
        .and_then(Value::as_object)
        .unwrap_or_else(|| auth_json.as_object().expect("auth json should stay object"))
}

fn get_token_container_mut(auth_json: &mut Value) -> &mut Map<String, Value> {
    if auth_json.get("tokens").and_then(Value::as_object).is_some() {
        auth_json
            .get_mut("tokens")
            .and_then(Value::as_object_mut)
            .expect("tokens object should stay mutable")
    } else {
        auth_json
            .as_object_mut()
            .expect("auth json should stay object")
    }
}

fn read_auth_json(auth_path: &Path) -> Result<Value, AppError> {
    let raw = fs::read_to_string(auth_path).map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            AppError::new(
                "auth_missing",
                format!("Auth file not found: {}", auth_path.display()),
            )
            .with_detail(json!({ "auth_file": auth_path.display().to_string() }))
        } else {
            AppError::new(
                "auth_read_failed",
                format!("Unable to read auth file: {}", auth_path.display()),
            )
            .with_detail(json!({
                "auth_file": auth_path.display().to_string(),
                "error": error.to_string(),
            }))
        }
    })?;
    let parsed: Value = serde_json::from_str(&raw).map_err(|error| {
        AppError::new(
            "auth_invalid_json",
            format!("Invalid JSON in auth file: {}", auth_path.display()),
        )
        .with_detail(json!({
            "auth_file": auth_path.display().to_string(),
            "error": error.to_string(),
        }))
    })?;
    if !parsed.is_object() {
        return Err(AppError::new(
            "auth_invalid_shape",
            "auth.json must contain a JSON object.",
        )
        .with_detail(json!({ "auth_file": auth_path.display().to_string() })));
    }
    Ok(parsed)
}

fn decode_jwt_payload(token: &str) -> Result<Value, AppError> {
    let mut parts = token.split('.');
    let _header = parts.next();
    let payload = parts
        .next()
        .ok_or_else(|| AppError::new("invalid_jwt", "Invalid JWT format."))?;
    let decoded = URL_SAFE_NO_PAD
        .decode(payload)
        .or_else(|_| STANDARD.decode(payload))
        .map_err(|_| AppError::new("invalid_jwt", "Unable to decode JWT payload."))?;
    let parsed: Value = serde_json::from_slice(&decoded)
        .map_err(|_| AppError::new("invalid_jwt", "Unable to decode JWT payload."))?;
    if !parsed.is_object() {
        return Err(AppError::new(
            "invalid_jwt",
            "Decoded JWT payload is not a JSON object.",
        ));
    }
    Ok(parsed)
}

fn try_decode_jwt_payload(token: Option<&str>) -> Option<Value> {
    token.and_then(|value| decode_jwt_payload(value).ok())
}

fn resolve_account_id(access_token: &str, account_id: Option<&str>) -> Result<String, AppError> {
    if let Some(value) = account_id
        && !value.is_empty()
    {
        return Ok(value.to_string());
    }
    let payload = decode_jwt_payload(access_token)?;
    let auth_claim = payload
        .get("https://api.openai.com/auth")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            AppError::new("account_id_missing", "Missing auth claims in access token.")
        })?;
    let claim_account_id = auth_claim
        .get("chatgpt_account_id")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            AppError::new(
                "account_id_missing",
                "Missing chatgpt_account_id in token claims.",
            )
        })?;
    Ok(claim_account_id.to_string())
}

fn compute_expiry_details(exp_seconds: Option<i64>) -> Value {
    match exp_seconds {
        Some(exp) => {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64;
            json!({
                "expires_at": exp,
                "expired": exp <= now,
                "seconds_until_expiry": exp - now,
            })
        }
        None => json!({
            "expires_at": Value::Null,
            "expired": Value::Null,
            "seconds_until_expiry": Value::Null,
        }),
    }
}

fn resolve_auth_identity(payload: Option<&Value>) -> Value {
    let mut result = Map::new();
    if let Some(payload) = payload {
        if let Some(email) = payload
            .get("https://api.openai.com/profile")
            .and_then(Value::as_object)
            .and_then(|profile| profile.get("email"))
            .and_then(Value::as_str)
        {
            result.insert("email".to_string(), json!(email));
        }
        if let Some(auth_claim) = payload
            .get("https://api.openai.com/auth")
            .and_then(Value::as_object)
        {
            if let Some(plan_type) = auth_claim.get("chatgpt_plan_type").and_then(Value::as_str) {
                result.insert("plan_type".to_string(), json!(plan_type));
            }
            if let Some(chatgpt_user_id) = auth_claim.get("chatgpt_user_id").and_then(Value::as_str)
            {
                result.insert("chatgpt_user_id".to_string(), json!(chatgpt_user_id));
            }
        }
    }
    Value::Object(result)
}

pub fn inspect_codex_auth_file(auth_path: &Path) -> Value {
    let mut result = json!({
        "auth_file": auth_path.display().to_string(),
        "auth_source": "config",
        "exists": auth_path.is_file(),
        "provider": "codex",
    });

    if !auth_path.is_file() {
        result["ready"] = json!(false);
        result["parse_ok"] = json!(false);
        result["auth_source"] = json!("missing");
        result["message"] = json!("auth.json was not found.");
        return result;
    }

    let auth_json = match read_auth_json(auth_path) {
        Ok(auth_json) => auth_json,
        Err(error) => {
            result["ready"] = json!(false);
            result["parse_ok"] = json!(false);
            result["message"] = json!(error.message);
            result["error"] = json!({
                "code": error.code,
                "detail": error.detail,
            });
            return result;
        }
    };

    let tokens = get_token_container(&auth_json);
    let access_token = tokens.get("access_token").and_then(Value::as_str);
    let refresh_token = tokens.get("refresh_token").and_then(Value::as_str);
    let id_token = tokens.get("id_token").and_then(Value::as_str);
    let access_payload = try_decode_jwt_payload(access_token);
    let auth_mode = auth_json
        .get("auth_mode")
        .and_then(Value::as_str)
        .or_else(|| auth_json.get("type").and_then(Value::as_str));
    let exp_seconds = access_payload
        .as_ref()
        .and_then(|payload| payload.get("exp"))
        .and_then(Value::as_i64);
    let identity = resolve_auth_identity(access_payload.as_ref());
    let account_id = access_token.and_then(|token| {
        resolve_account_id(token, tokens.get("account_id").and_then(Value::as_str)).ok()
    });

    result["ready"] = json!(access_token.is_some());
    result["parse_ok"] = json!(true);
    result["auth_mode"] = json!(auth_mode);
    result["access_token_present"] = json!(access_token.is_some());
    result["refresh_token_present"] = json!(refresh_token.is_some());
    result["id_token_present"] = json!(id_token.is_some());
    result["account_id"] = json!(account_id);
    result["last_refresh"] = auth_json
        .get("last_refresh")
        .cloned()
        .unwrap_or(Value::Null);
    if let Some(object) = result.as_object_mut() {
        if let Some(details) = compute_expiry_details(exp_seconds).as_object() {
            for (key, value) in details {
                object.insert(key.clone(), value.clone());
            }
        }
        if let Some(identity_object) = identity.as_object() {
            for (key, value) in identity_object {
                object.insert(key.clone(), value.clone());
            }
        }
    }
    result
}

pub fn inspect_openai_auth(api_key_override: Option<&str>) -> Value {
    let (api_key, source) = resolve_openai_api_key(api_key_override);
    json!({
        "provider": "openai",
        "ready": api_key.is_some(),
        "auth_source": source,
        "api_key_present": api_key.is_some(),
        "env_var": OPENAI_API_KEY_ENV,
        "default_model": DEFAULT_OPENAI_MODEL,
    })
}

fn resolve_openai_api_key(api_key_override: Option<&str>) -> (Option<String>, &'static str) {
    if let Some(value) = api_key_override
        && !value.trim().is_empty()
    {
        return (Some(value.to_string()), "flag");
    }
    match std::env::var(OPENAI_API_KEY_ENV) {
        Ok(value) if !value.trim().is_empty() => (Some(value), "env"),
        _ => (None, "missing"),
    }
}

fn load_codex_auth_state(auth_path: &Path) -> Result<CodexAuthState, AppError> {
    let auth_json = read_auth_json(auth_path)?;
    let tokens = get_token_container(&auth_json);
    let access_token = tokens
        .get("access_token")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            AppError::new(
                "access_token_missing",
                format!("Missing access_token in {}", auth_path.display()),
            )
            .with_detail(json!({ "auth_file": auth_path.display().to_string() }))
        })?
        .to_string();
    let refresh_token = tokens
        .get("refresh_token")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let account_id = resolve_account_id(
        &access_token,
        tokens.get("account_id").and_then(Value::as_str),
    )?;
    Ok(CodexAuthState {
        auth_path: auth_path.to_path_buf(),
        auth_json,
        access_token,
        refresh_token,
        account_id,
        persistence: CodexAuthPersistence::AuthFile,
    })
}

fn load_openai_auth_state(api_key_override: Option<&str>) -> Result<OpenAiAuthState, AppError> {
    let (api_key, source) = resolve_openai_api_key(api_key_override);
    let Some(api_key) = api_key else {
        return Err(AppError::new(
            "api_key_missing",
            format!("Missing {}.", OPENAI_API_KEY_ENV),
        )
        .with_detail(json!({
            "provider": "openai",
            "env_var": OPENAI_API_KEY_ENV,
        })));
    };
    Ok(OpenAiAuthState {
        api_key,
        source: source.to_string(),
    })
}

fn load_openai_auth_state_for(
    cli: &Cli,
    selection: &ProviderSelection,
) -> Result<OpenAiAuthState, AppError> {
    if selection.resolved == "openai" {
        return load_openai_auth_state(cli.api_key.as_deref());
    }
    if let Some(api_key) = cli.api_key.as_deref()
        && !api_key.trim().is_empty()
    {
        return Ok(OpenAiAuthState {
            api_key: api_key.to_string(),
            source: "flag".to_string(),
        });
    }
    let config = load_app_config(&cli_config_path(cli))?;
    let provider = config.providers.get(&selection.resolved).ok_or_else(|| {
        AppError::new(
            "provider_unknown",
            format!("Unknown provider: {}", selection.resolved),
        )
    })?;
    let (api_key, source) = get_provider_credential(&selection.resolved, provider, "api_key")?;
    Ok(OpenAiAuthState { api_key, source })
}

fn load_codex_auth_state_for(
    cli: &Cli,
    selection: &ProviderSelection,
) -> Result<CodexAuthState, AppError> {
    if selection.resolved == "codex" {
        return load_codex_auth_state(Path::new(&cli.auth_file));
    }
    let config_path = cli_config_path(cli);
    let config = load_app_config(&config_path)?;
    let provider = config.providers.get(&selection.resolved).ok_or_else(|| {
        AppError::new(
            "provider_unknown",
            format!("Unknown provider: {}", selection.resolved),
        )
    })?;
    let (access_token, _) = get_provider_credential(&selection.resolved, provider, "access_token")?;
    let refresh_token = provider
        .credentials
        .get("refresh_token")
        .and_then(|credential| resolve_credential(credential).ok().map(|(value, _)| value));
    let account_id = provider
        .credentials
        .get("account_id")
        .and_then(|credential| resolve_credential(credential).ok().map(|(value, _)| value));
    let account_id = resolve_account_id(&access_token, account_id.as_deref())?;
    let auth_access_token = access_token.clone();
    let auth_refresh_token = refresh_token.clone();
    let auth_account_id = account_id.clone();
    let auth_json = json!({
        "tokens": {
            "access_token": auth_access_token,
            "refresh_token": auth_refresh_token,
            "account_id": auth_account_id,
        }
    });
    Ok(CodexAuthState {
        auth_path: config_path.clone(),
        auth_json,
        access_token,
        refresh_token,
        account_id,
        persistence: CodexAuthPersistence::ConfigProvider {
            config_path,
            provider_name: selection.resolved.clone(),
            credential_sources: provider.credentials.clone(),
        },
    })
}

fn save_auth_json(auth_state: &CodexAuthState) -> Result<(), AppError> {
    match &auth_state.persistence {
        CodexAuthPersistence::AuthFile => {
            let mut content =
                serde_json::to_string_pretty(&auth_state.auth_json).map_err(|error| {
                    AppError::new("auth_write_failed", "Unable to serialize auth.json.")
                        .with_detail(json!({"error": error.to_string()}))
                })?;
            content.push('\n');
            fs::create_dir_all(
                auth_state
                    .auth_path
                    .parent()
                    .unwrap_or_else(|| Path::new(".")),
            )
            .map_err(|error| {
                AppError::new("auth_write_failed", "Unable to create auth directory.")
                    .with_detail(json!({"error": error.to_string()}))
            })?;
            fs::write(&auth_state.auth_path, content).map_err(|error| {
                AppError::new("auth_write_failed", "Unable to save auth.json.")
                    .with_detail(json!({"error": error.to_string()}))
            })?;
            Ok(())
        }
        CodexAuthPersistence::ConfigProvider {
            config_path,
            provider_name,
            credential_sources,
        } => save_codex_config_credentials(
            config_path,
            provider_name,
            credential_sources,
            &auth_state.access_token,
            auth_state.refresh_token.as_deref(),
            &auth_state.account_id,
        ),
        CodexAuthPersistence::SessionOnly => Ok(()),
    }
}

fn save_codex_config_credentials(
    config_path: &Path,
    provider_name: &str,
    credential_sources: &BTreeMap<String, CredentialRef>,
    access_token: &str,
    refresh_token: Option<&str>,
    account_id: &str,
) -> Result<(), AppError> {
    let mut config = load_app_config(config_path)?;
    let provider = config.providers.get_mut(provider_name).ok_or_else(|| {
        AppError::new(
            "provider_unknown",
            format!("Unknown provider: {provider_name}"),
        )
    })?;
    persist_credential_value(provider, credential_sources, "access_token", access_token)?;
    persist_credential_value(provider, credential_sources, "account_id", account_id)?;
    if let Some(refresh_token) = refresh_token {
        persist_credential_value(provider, credential_sources, "refresh_token", refresh_token)?;
    }
    save_app_config(config_path, &config)
}

fn persist_credential_value(
    provider: &mut ProviderConfig,
    credential_sources: &BTreeMap<String, CredentialRef>,
    key: &str,
    value: &str,
) -> Result<(), AppError> {
    match credential_sources.get(key) {
        Some(CredentialRef::File { .. }) | None => {
            provider.credentials.insert(
                key.to_string(),
                CredentialRef::File {
                    value: value.to_string(),
                },
            );
            Ok(())
        }
        Some(CredentialRef::Keychain { service, account }) => write_keychain_secret(
            service.as_deref().unwrap_or(KEYCHAIN_SERVICE),
            account,
            value,
        ),
        Some(CredentialRef::Env { .. }) => Ok(()),
    }
}

fn make_client(timeout_seconds: u64) -> Result<Client, AppError> {
    Client::builder()
        .timeout(Duration::from_secs(timeout_seconds))
        .user_agent(build_user_agent())
        .build()
        .map_err(|error| {
            AppError::new("http_client_error", "Unable to build HTTP client.")
                .with_detail(json!({ "error": error.to_string() }))
        })
}

fn http_status_error(status: StatusCode, detail: String) -> AppError {
    AppError::new("http_error", format!("HTTP {}", status.as_u16()))
        .with_detail(json!(detail))
        .with_status_code(status.as_u16())
}

fn refresh_access_token(auth_state: &mut CodexAuthState) -> Result<Value, AppError> {
    let Some(refresh_token) = auth_state.refresh_token.clone() else {
        return Err(AppError::new(
            "refresh_token_missing",
            "Missing refresh_token in auth.json",
        ));
    };
    let client = make_client(DEFAULT_REFRESH_TIMEOUT)?;
    let response = client
        .post(REFRESH_ENDPOINT)
        .header(CONTENT_TYPE, "application/json")
        .header(ACCEPT, "application/json")
        .json(&json!({
            "client_id": REFRESH_CLIENT_ID,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        }))
        .send()
        .map_err(|error| {
            AppError::new("refresh_failed", "Refresh request failed.")
                .with_detail(json!({ "error": error.to_string() }))
        })?;
    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().unwrap_or_else(|_| String::new());
        return Err(
            http_status_error(status, detail.clone()).with_detail(json!({
                "message": "Refresh request failed.",
                "detail": detail,
            })),
        );
    }
    let payload: Value = response.json().map_err(|error| {
        AppError::new("refresh_failed", "Refresh response was not valid JSON.")
            .with_detail(json!({ "error": error.to_string() }))
    })?;
    let access_token = payload
        .get("access_token")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            AppError::new(
                "refresh_failed",
                "Refresh response did not include access_token.",
            )
        })?
        .to_string();
    let refresh_token = payload
        .get("refresh_token")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let id_token = payload
        .get("id_token")
        .and_then(Value::as_str)
        .map(ToString::to_string);

    let tokens = get_token_container_mut(&mut auth_state.auth_json);
    tokens.insert("access_token".to_string(), json!(access_token));
    if let Some(refresh_token) = refresh_token.clone() {
        tokens.insert("refresh_token".to_string(), json!(refresh_token));
    }
    if let Some(id_token) = id_token {
        tokens.insert("id_token".to_string(), json!(id_token));
    }
    let account_id = resolve_account_id(
        payload
            .get("access_token")
            .and_then(Value::as_str)
            .unwrap_or(""),
        tokens.get("account_id").and_then(Value::as_str),
    )?;
    tokens.insert("account_id".to_string(), json!(account_id));
    if let Some(root) = auth_state.auth_json.as_object_mut() {
        root.insert("last_refresh".to_string(), json!(now_iso()));
    }
    auth_state.access_token = payload
        .get("access_token")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    auth_state.refresh_token = refresh_token;
    auth_state.account_id = account_id;
    save_auth_json(auth_state)?;
    Ok(payload)
}

fn check_endpoint_reachability(endpoint: &str) -> Value {
    let url = match Url::parse(endpoint) {
        Ok(url) => url,
        Err(error) => {
            return json!({
                "endpoint": endpoint,
                "reachable": false,
                "error": error.to_string(),
            });
        }
    };
    let host = url.host_str().unwrap_or_default().to_string();
    let port = url.port_or_known_default().unwrap_or(443);
    let mut reachable = false;
    let mut dns_resolved = false;
    let mut tcp_connected = false;
    let mut addresses = Vec::<String>::new();
    let mut error_text: Option<String> = None;

    match (host.as_str(), port).to_socket_addrs() {
        Ok(iter) => {
            dns_resolved = true;
            for address in iter {
                addresses.push(address.ip().to_string());
                if TcpStream::connect_timeout(&address, Duration::from_secs(ENDPOINT_CHECK_TIMEOUT))
                    .is_ok()
                {
                    tcp_connected = true;
                    reachable = true;
                    break;
                }
            }
            if !tcp_connected {
                error_text = Some("No address accepted a TCP connection.".to_string());
            }
        }
        Err(error) => {
            error_text = Some(error.to_string());
        }
    }

    json!({
        "endpoint": endpoint,
        "host": host,
        "port": port,
        "scheme": url.scheme(),
        "dns_resolved": dns_resolved,
        "tcp_connected": tcp_connected,
        "tls_ok": if url.scheme() == "https" { Value::Bool(reachable) } else { Value::Null },
        "reachable": reachable,
        "addresses": addresses,
        "error": error_text,
    })
}

fn maybe_add_value(target: &mut Map<String, Value>, key: &str, value: Option<Value>) {
    if let Some(value) = value {
        target.insert(key.to_string(), value);
    }
}

#[allow(clippy::too_many_arguments)]
pub fn build_openai_image_body(
    operation: &str,
    prompt: &str,
    model: &str,
    ref_images: &[String],
    mask: Option<&str>,
    input_fidelity: Option<InputFidelity>,
    background: Background,
    size: Option<&str>,
    quality: Option<Quality>,
    output_format: Option<OutputFormat>,
    output_compression: Option<u8>,
    n: Option<u8>,
    moderation: Option<Moderation>,
) -> Value {
    let mut body = Map::new();
    body.insert("model".to_string(), json!(model));
    body.insert("prompt".to_string(), json!(prompt));
    body.insert("background".to_string(), json!(background.as_str()));
    maybe_add_value(&mut body, "size", size.map(|value| json!(value)));
    maybe_add_value(
        &mut body,
        "quality",
        quality.map(|value| json!(value.as_str())),
    );
    maybe_add_value(
        &mut body,
        "output_format",
        output_format.map(|value| json!(value.as_str())),
    );
    maybe_add_value(
        &mut body,
        "output_compression",
        output_compression.map(|value| json!(value)),
    );
    maybe_add_value(&mut body, "n", n.map(|value| json!(value)));
    maybe_add_value(
        &mut body,
        "moderation",
        moderation.map(|value| json!(value.as_str())),
    );
    if operation == "edit" {
        body.insert(
            "images".to_string(),
            Value::Array(
                ref_images
                    .iter()
                    .map(|image_url| json!({ "image_url": image_url }))
                    .collect(),
            ),
        );
        if let Some(mask) = mask {
            body.insert("mask".to_string(), json!({ "image_url": mask }));
        }
        maybe_add_value(
            &mut body,
            "input_fidelity",
            input_fidelity.map(|value| json!(value.as_str())),
        );
    }
    Value::Object(body)
}

#[allow(clippy::too_many_arguments)]
fn build_codex_image_body(
    prompt: &str,
    model: &str,
    instructions: &str,
    ref_images: &[String],
    background: Background,
    size: Option<&str>,
    quality: Option<Quality>,
    output_format: Option<OutputFormat>,
    output_compression: Option<u8>,
    action: &str,
) -> Value {
    let mut content = Vec::new();
    for image_url in ref_images {
        content.push(json!({"type": "input_image", "image_url": image_url}));
    }
    content.push(json!({"type": "input_text", "text": prompt}));
    let mut tool = Map::new();
    tool.insert("type".to_string(), json!("image_generation"));
    tool.insert("background".to_string(), json!(background.as_str()));
    tool.insert("action".to_string(), json!(action));
    maybe_add_value(&mut tool, "size", size.map(|value| json!(value)));
    maybe_add_value(
        &mut tool,
        "quality",
        quality.map(|value| json!(value.as_str())),
    );
    maybe_add_value(
        &mut tool,
        "output_format",
        output_format.map(|value| json!(value.as_str())),
    );
    maybe_add_value(
        &mut tool,
        "output_compression",
        output_compression.map(|value| json!(value)),
    );

    json!({
        "model": model,
        "instructions": instructions,
        "store": false,
        "stream": true,
        "input": [
            {
                "role": "user",
                "content": content,
            }
        ],
        "tools": [Value::Object(tool)],
    })
}

fn summarize_large_string(key: Option<&str>, value: &str) -> Value {
    let lowered = key.unwrap_or_default().to_ascii_lowercase();
    if value.starts_with("data:image/") {
        let (prefix, encoded) = value.split_once(',').unwrap_or((value, ""));
        return json!({
            "_omitted": "data_url",
            "prefix": prefix,
            "base64_chars": encoded.len(),
        });
    }
    if lowered == "result" || lowered.contains("partial_image") || is_probably_base64(value) {
        return json!({
            "_omitted": "base64",
            "base64_chars": value.len(),
        });
    }
    json!({
        "_omitted": "string",
        "chars": value.len(),
    })
}

fn redact_event_payload(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut redacted = Map::new();
            for (key, child) in object {
                let lowered = key.to_ascii_lowercase();
                if [
                    "access_token",
                    "refresh_token",
                    "id_token",
                    "authorization",
                    "api_key",
                ]
                .contains(&lowered.as_str())
                {
                    redacted.insert(key.clone(), json!({"_omitted": "secret"}));
                } else {
                    redacted.insert(key.clone(), redact_value_with_key(Some(key), child));
                }
            }
            Value::Object(redacted)
        }
        Value::Array(items) => Value::Array(items.iter().map(redact_event_payload).collect()),
        _ => value.clone(),
    }
}

fn redact_value_with_key(key: Option<&str>, value: &Value) -> Value {
    match value {
        Value::Object(_) | Value::Array(_) => redact_event_payload(value),
        Value::String(text) => {
            let lowered = key.unwrap_or_default().to_ascii_lowercase();
            if text.starts_with("data:image/")
                || lowered == "result"
                || lowered == "image_url"
                || lowered == "b64_json"
                || lowered.contains("partial_image")
                || (text.len() >= 512 && is_probably_base64(text))
            {
                summarize_large_string(key, text)
            } else {
                value.clone()
            }
        }
        _ => value.clone(),
    }
}

fn is_probably_base64(value: &str) -> bool {
    if value.len() < 128 {
        return false;
    }
    value
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || "+/=\n\r".contains(character))
}

fn emit_progress_event(
    logger: &mut JsonEventLogger,
    provider: &str,
    phase: &str,
    message: &str,
    status: &str,
    percent: Option<u8>,
    extra: Value,
) {
    let mut data = json!({
        "provider": provider,
        "phase": phase,
        "status": status,
        "message": message,
    });
    if let Some(percent) = percent {
        data["percent"] = json!(percent);
    }
    if let Some(object) = extra.as_object() {
        for (key, value) in object {
            data[key] = redact_value_with_key(Some(key), value);
        }
    }
    logger.emit("progress", phase, data);
}

fn emit_sse_event(logger: &mut JsonEventLogger, event: &Value) {
    let event_type = event
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    logger.emit("sse", event_type, redact_event_payload(event));
}

fn build_known_model_payloads() -> Value {
    json!({
        "openai": {
            "default_model": DEFAULT_OPENAI_MODEL,
            "model_presets": [{
                "id": DEFAULT_OPENAI_MODEL,
                "default": true,
                "source": "official_default",
                "notes": "Official API-key image generation model."
            }],
            "operations": [
                {"id": "generate", "command": "images generate", "requires_ref_image": false},
                {"id": "edit", "command": "images edit", "requires_ref_image": true}
            ],
            "supports": ["background", "size", "quality", "format", "compression", "n", "moderation", "mask", "input_fidelity"]
        },
        "codex": {
            "default_model": DEFAULT_CODEX_MODEL,
            "model_presets": [
                {"id": "gpt-5.4", "default": true, "source": "local_preset", "notes": "Validated default for the Codex responses image path."},
                {"id": "gpt-5.4-mini", "default": false, "source": "local_preset", "notes": "Pass explicitly when the account exposes this Codex model."},
                {"id": "gpt-5.4-pro", "default": false, "source": "local_preset", "notes": "Pass explicitly when the account exposes this Codex model."}
            ],
            "image_generation_tool": {
                "type": "image_generation",
                "delegated_model": DELEGATED_IMAGE_MODEL,
                "operations": [
                    {"id": "generate", "command": "images generate", "requires_ref_image": false},
                    {"id": "edit", "command": "images edit", "requires_ref_image": true}
                ],
                "supports": ["background", "size", "quality", "format", "compression", "action", "json_events", "auth_refresh"]
            }
        }
    })
}

fn read_body_json(path: &str) -> Result<Value, AppError> {
    let raw = if path == "-" {
        let mut full = String::new();
        let mut stdin = io::stdin();
        stdin.read_to_string(&mut full).map_err(|error| {
            AppError::new("invalid_body_json", "Unable to read stdin body.")
                .with_detail(json!({ "error": error.to_string() }))
        })?;
        full
    } else {
        fs::read_to_string(path).map_err(|error| {
            AppError::new("invalid_body_json", "Unable to read request body.")
                .with_detail(json!({"error": error.to_string(), "body_file": path}))
        })?
    };
    let parsed: Value = serde_json::from_str(&raw).map_err(|error| {
        AppError::new("invalid_body_json", "Request body must be valid JSON.")
            .with_detail(json!({ "error": error.to_string() }))
    })?;
    if !parsed.is_object() {
        return Err(AppError::new(
            "invalid_body_json",
            "Request body must be a JSON object.",
        ));
    }
    Ok(parsed)
}

fn configured_provider_selection(
    requested: &str,
    provider: &ProviderConfig,
    reason: &str,
    api_key_override: Option<&str>,
) -> Result<ProviderSelection, AppError> {
    let edit_region_mode = provider
        .edit_region_mode
        .as_deref()
        .map(normalize_edit_region_mode)
        .transpose()?;
    match provider.provider_type.as_str() {
        "openai" | "openai-compatible" => {
            let api_base = provider
                .api_base
                .clone()
                .unwrap_or_else(|| DEFAULT_OPENAI_API_BASE.to_string());
            if api_key_override
                .map(|value| value.trim().is_empty())
                .unwrap_or(true)
            {
                let _ = get_provider_credential(requested, provider, "api_key")?;
            }
            Ok(ProviderSelection {
                requested: requested.to_string(),
                resolved: requested.to_string(),
                reason: reason.to_string(),
                kind: ProviderKind::OpenAi,
                api_base,
                codex_endpoint: DEFAULT_CODEX_ENDPOINT.to_string(),
                default_model: provider
                    .model
                    .clone()
                    .unwrap_or_else(|| DEFAULT_OPENAI_MODEL.to_string()),
                supports_n: provider
                    .supports_n
                    .unwrap_or(provider.provider_type == "openai"),
                edit_region_mode: edit_region_mode.unwrap_or_else(|| {
                    default_edit_region_mode(&provider.provider_type).to_string()
                }),
            })
        }
        "codex" => {
            let _ = get_provider_credential(requested, provider, "access_token")?;
            Ok(ProviderSelection {
                requested: requested.to_string(),
                resolved: requested.to_string(),
                reason: reason.to_string(),
                kind: ProviderKind::Codex,
                api_base: DEFAULT_OPENAI_API_BASE.to_string(),
                codex_endpoint: provider
                    .endpoint
                    .clone()
                    .unwrap_or_else(|| DEFAULT_CODEX_ENDPOINT.to_string()),
                default_model: provider
                    .model
                    .clone()
                    .unwrap_or_else(|| DEFAULT_CODEX_MODEL.to_string()),
                supports_n: false,
                edit_region_mode: edit_region_mode
                    .unwrap_or_else(|| EDIT_REGION_REFERENCE_HINT.to_string()),
            })
        }
        other => Err(AppError::new(
            "provider_kind_unsupported",
            format!("Unsupported provider type: {other}"),
        )
        .with_detail(json!({"provider": requested, "type": other}))),
    }
}

const EDIT_REGION_NATIVE_MASK: &str = "native-mask";
const EDIT_REGION_REFERENCE_HINT: &str = "reference-hint";
const EDIT_REGION_NONE: &str = "none";

fn default_edit_region_mode(provider_type: &str) -> &'static str {
    match provider_type {
        "openai" => EDIT_REGION_NATIVE_MASK,
        "codex" => EDIT_REGION_REFERENCE_HINT,
        _ => EDIT_REGION_REFERENCE_HINT,
    }
}

fn normalize_edit_region_mode(value: &str) -> Result<String, AppError> {
    match value {
        EDIT_REGION_NATIVE_MASK | EDIT_REGION_REFERENCE_HINT | EDIT_REGION_NONE => {
            Ok(value.to_string())
        }
        other => Err(AppError::new(
            "invalid_provider_config",
            format!("Unsupported edit_region_mode: {other}"),
        )
        .with_detail(json!({
            "allowed": [EDIT_REGION_NATIVE_MASK, EDIT_REGION_REFERENCE_HINT, EDIT_REGION_NONE]
        }))),
    }
}

fn select_configured_provider(
    cli: &Cli,
    requested: &str,
    reason: &str,
) -> Result<ProviderSelection, AppError> {
    let config_path = cli_config_path(cli);
    let config = load_app_config(&config_path)?;
    let provider = config.providers.get(requested).ok_or_else(|| {
        AppError::new("provider_unknown", format!("Unknown provider: {requested}"))
            .with_detail(json!({"config_file": config_path.display().to_string()}))
    })?;
    configured_provider_selection(requested, provider, reason, cli.api_key.as_deref())
}

fn select_builtin_provider(cli: &Cli, requested: &str) -> Result<ProviderSelection, AppError> {
    let auth_path = PathBuf::from(&cli.auth_file);
    let openai_ready = inspect_openai_auth(cli.api_key.as_deref())
        .get("ready")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let codex_ready = inspect_codex_auth_file(&auth_path)
        .get("ready")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    match requested {
        "openai" => {
            if !openai_ready {
                return Err(AppError::new(
                    "api_key_missing",
                    format!("Missing {}.", OPENAI_API_KEY_ENV),
                ));
            }
            Ok(ProviderSelection {
                requested: requested.to_string(),
                resolved: "openai".to_string(),
                reason: "explicit".to_string(),
                kind: ProviderKind::OpenAi,
                api_base: cli.openai_api_base.clone(),
                codex_endpoint: cli.endpoint.clone(),
                default_model: DEFAULT_OPENAI_MODEL.to_string(),
                supports_n: true,
                edit_region_mode: EDIT_REGION_NATIVE_MASK.to_string(),
            })
        }
        "codex" => {
            if !codex_ready {
                return Err(AppError::new(
                    "access_token_missing",
                    format!("Missing access_token in {}", auth_path.display()),
                ));
            }
            Ok(ProviderSelection {
                requested: requested.to_string(),
                resolved: "codex".to_string(),
                reason: "explicit".to_string(),
                kind: ProviderKind::Codex,
                api_base: cli.openai_api_base.clone(),
                codex_endpoint: cli.endpoint.clone(),
                default_model: DEFAULT_CODEX_MODEL.to_string(),
                supports_n: false,
                edit_region_mode: EDIT_REGION_REFERENCE_HINT.to_string(),
            })
        }
        "auto" => {
            let config_path = cli_config_path(cli);
            let config = load_app_config(&config_path)?;
            if let Some(default_provider) = config.default_provider.as_deref()
                && let Some(provider) = config.providers.get(default_provider)
            {
                return configured_provider_selection(
                    default_provider,
                    provider,
                    "config_default_provider",
                    cli.api_key.as_deref(),
                );
            }
            if openai_ready {
                Ok(ProviderSelection {
                    requested: "auto".to_string(),
                    resolved: "openai".to_string(),
                    reason: "auto_openai_api_key".to_string(),
                    kind: ProviderKind::OpenAi,
                    api_base: cli.openai_api_base.clone(),
                    codex_endpoint: cli.endpoint.clone(),
                    default_model: DEFAULT_OPENAI_MODEL.to_string(),
                    supports_n: true,
                    edit_region_mode: EDIT_REGION_NATIVE_MASK.to_string(),
                })
            } else if codex_ready {
                Ok(ProviderSelection {
                    requested: "auto".to_string(),
                    resolved: "codex".to_string(),
                    reason: "auto_codex_auth".to_string(),
                    kind: ProviderKind::Codex,
                    api_base: cli.openai_api_base.clone(),
                    codex_endpoint: cli.endpoint.clone(),
                    default_model: DEFAULT_CODEX_MODEL.to_string(),
                    supports_n: false,
                    edit_region_mode: EDIT_REGION_REFERENCE_HINT.to_string(),
                })
            } else {
                Err(
                    AppError::new("provider_unavailable", "No usable provider auth was found.")
                        .with_detail(json!({
                            "openai": inspect_openai_auth(cli.api_key.as_deref()),
                            "codex": inspect_codex_auth_file(&auth_path),
                            "config_file": config_path.display().to_string(),
                            "configured_providers": config.providers.keys().cloned().collect::<Vec<_>>(),
                        })),
                )
            }
        }
        _ => select_configured_provider(cli, requested, "explicit_config_provider"),
    }
}

fn select_image_provider(cli: &Cli) -> Result<ProviderSelection, AppError> {
    let requested = cli.provider.trim();
    select_builtin_provider(
        cli,
        if requested.is_empty() {
            "auto"
        } else {
            requested
        },
    )
}

fn select_request_provider(
    cli: &Cli,
    args: &RequestCreateArgs,
) -> Result<ProviderSelection, AppError> {
    let requested = cli.provider.trim();
    if requested != "auto" && !requested.is_empty() {
        return select_image_provider(cli);
    }
    let config_path = cli_config_path(cli);
    let config = load_app_config(&config_path)?;
    if let Some(default_provider) = config.default_provider.as_deref()
        && let Some(provider) = config.providers.get(default_provider)
    {
        return configured_provider_selection(
            default_provider,
            provider,
            "config_default_provider",
            cli.api_key.as_deref(),
        );
    }
    if args.request_operation == RequestOperation::Responses
        && inspect_codex_auth_file(Path::new(&cli.auth_file))
            .get("ready")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    {
        return Ok(ProviderSelection {
            requested: "auto".to_string(),
            resolved: "codex".to_string(),
            reason: "auto_request_responses".to_string(),
            kind: ProviderKind::Codex,
            api_base: cli.openai_api_base.clone(),
            codex_endpoint: cli.endpoint.clone(),
            default_model: DEFAULT_CODEX_MODEL.to_string(),
            supports_n: false,
            edit_region_mode: EDIT_REGION_REFERENCE_HINT.to_string(),
        });
    }
    if matches!(
        args.request_operation,
        RequestOperation::Generate | RequestOperation::Edit
    ) && inspect_openai_auth(cli.api_key.as_deref())
        .get("ready")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return Ok(ProviderSelection {
            requested: "auto".to_string(),
            resolved: "openai".to_string(),
            reason: "auto_request_images".to_string(),
            kind: ProviderKind::OpenAi,
            api_base: cli.openai_api_base.clone(),
            codex_endpoint: cli.endpoint.clone(),
            default_model: DEFAULT_OPENAI_MODEL.to_string(),
            supports_n: true,
            edit_region_mode: EDIT_REGION_NATIVE_MASK.to_string(),
        });
    }
    select_image_provider(cli)
}

fn validate_provider_specific_image_args(
    selection: &ProviderSelection,
    shared: &SharedImageArgs,
    mask: Option<&str>,
    input_fidelity: Option<InputFidelity>,
) -> Result<(), AppError> {
    if matches!(selection.kind, ProviderKind::Codex) {
        if shared.n.unwrap_or(1) != 1 {
            return Err(AppError::new(
                "unsupported_option",
                "--n is supported by the openai provider.",
            ));
        }
        if shared.moderation.is_some() {
            return Err(AppError::new(
                "unsupported_option",
                "--moderation is supported by the openai provider.",
            ));
        }
        if mask.is_some() {
            return Err(AppError::new(
                "unsupported_option",
                "--mask requires a provider with native-mask region editing.",
            ));
        }
        if input_fidelity.is_some() {
            return Err(AppError::new(
                "unsupported_option",
                "--input-fidelity is supported by the openai provider.",
            ));
        }
    }
    if mask.is_some() && selection.edit_region_mode != EDIT_REGION_NATIVE_MASK {
        return Err(AppError::new(
            "unsupported_option",
            "--mask requires a provider with native-mask region editing.",
        )
        .with_detail(json!({
            "provider": selection.resolved,
            "edit_region_mode": selection.edit_region_mode,
        })));
    }
    if matches!(selection.kind, ProviderKind::OpenAi) && shared.instructions != DEFAULT_INSTRUCTIONS
    {
        return Err(AppError::new(
            "unsupported_option",
            "--instructions is supported by the codex provider.",
        ));
    }
    Ok(())
}

fn validate_reference_image_count(count: usize) -> Result<(), AppError> {
    if count > MAX_REFERENCE_IMAGES {
        return Err(AppError::new(
            "ref_image_too_many",
            format!("At most {MAX_REFERENCE_IMAGES} reference images are supported."),
        )
        .with_detail(json!({
            "max": MAX_REFERENCE_IMAGES,
            "actual": count,
        })));
    }
    Ok(())
}

fn should_retry(error: &AppError) -> bool {
    if let Some(status_code) = error.status_code {
        return status_code == 429 || status_code >= 500;
    }
    matches!(
        error.code.as_str(),
        "network_error" | "request_failed" | "refresh_failed"
    )
}

fn compute_retry_delay_seconds(retry_number: usize) -> u64 {
    DEFAULT_RETRY_DELAY_SECONDS * (2_u64.pow((retry_number.saturating_sub(1)) as u32))
}

fn execute_openai_with_retry<T, F>(
    logger: &mut JsonEventLogger,
    provider: &str,
    mut run_once: F,
) -> Result<(T, usize), AppError>
where
    F: FnMut(&mut JsonEventLogger) -> Result<T, AppError>,
{
    let mut retry_count = 0;
    loop {
        match run_once(logger) {
            Ok(value) => return Ok((value, retry_count)),
            Err(error) => {
                if retry_count >= DEFAULT_RETRY_COUNT || !should_retry(&error) {
                    return Err(error);
                }
                retry_count += 1;
                let delay_seconds = compute_retry_delay_seconds(retry_count);
                emit_progress_event(
                    logger,
                    provider,
                    "retry_scheduled",
                    "Retry scheduled after transient failure.",
                    "running",
                    None,
                    json!({
                        "retry_number": retry_count,
                        "max_retries": DEFAULT_RETRY_COUNT,
                        "delay_seconds": delay_seconds,
                        "reason": error.message,
                        "status_code": error.status_code,
                    }),
                );
                std::thread::sleep(Duration::from_secs(delay_seconds));
            }
        }
    }
}

fn request_codex_with_retry(
    endpoint: &str,
    auth_state: &mut CodexAuthState,
    body: &Value,
    logger: &mut JsonEventLogger,
) -> Result<(Value, bool, usize), AppError> {
    let mut auth_refreshed = false;
    let mut retry_count = 0;
    loop {
        match request_codex_responses_once(endpoint, auth_state, body, logger) {
            Ok(value) => return Ok((value, auth_refreshed, retry_count)),
            Err(error) => {
                if error.status_code == Some(401) && !auth_refreshed {
                    emit_progress_event(
                        logger,
                        "codex",
                        "auth_refresh_started",
                        "Refreshing Codex access token.",
                        "running",
                        Some(2),
                        json!({ "endpoint": REFRESH_ENDPOINT }),
                    );
                    let payload = refresh_access_token(auth_state)?;
                    logger.emit(
                        "local",
                        "auth.refresh.completed",
                        redact_event_payload(&payload),
                    );
                    emit_progress_event(
                        logger,
                        "codex",
                        "auth_refresh_completed",
                        "Codex access token refreshed.",
                        "running",
                        Some(4),
                        json!({}),
                    );
                    auth_refreshed = true;
                    continue;
                }
                if retry_count >= DEFAULT_RETRY_COUNT || !should_retry(&error) {
                    return Err(error);
                }
                retry_count += 1;
                let delay_seconds = compute_retry_delay_seconds(retry_count);
                emit_progress_event(
                    logger,
                    "codex",
                    "retry_scheduled",
                    "Retry scheduled after transient failure.",
                    "running",
                    None,
                    json!({
                        "retry_number": retry_count,
                        "max_retries": DEFAULT_RETRY_COUNT,
                        "delay_seconds": delay_seconds,
                        "reason": error.message,
                        "status_code": error.status_code,
                    }),
                );
                std::thread::sleep(Duration::from_secs(delay_seconds));
            }
        }
    }
}

fn request_codex_responses_once(
    endpoint: &str,
    auth_state: &CodexAuthState,
    body: &Value,
    logger: &mut JsonEventLogger,
) -> Result<Value, AppError> {
    logger.emit(
        "local",
        "request.started",
        json!({"provider": "codex", "endpoint": endpoint}),
    );
    emit_progress_event(
        logger,
        "codex",
        "request_started",
        "Codex image request sent.",
        "running",
        Some(0),
        json!({ "endpoint": endpoint }),
    );
    let client = make_client(DEFAULT_REQUEST_TIMEOUT)?;
    let response = client
        .post(endpoint)
        .header(AUTHORIZATION, format!("Bearer {}", auth_state.access_token))
        .header("ChatGPT-Account-ID", auth_state.account_id.as_str())
        .header(CONTENT_TYPE, "application/json")
        .header(ACCEPT, "text/event-stream")
        .header("originator", "codex_desktop")
        .body(body.to_string())
        .send()
        .map_err(|error| {
            AppError::new("network_error", "Codex request failed.")
                .with_detail(json!({ "error": error.to_string() }))
        })?;
    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().unwrap_or_else(|_| String::new());
        return Err(http_status_error(status, detail));
    }

    let mut response_meta = json!({});
    let mut output_items: Vec<Value> = Vec::new();
    let mut response_error: Option<Value> = None;
    let reader = BufReader::new(response);
    let mut data_lines: Vec<String> = Vec::new();

    for line in reader.lines() {
        let line = line.map_err(|error| {
            AppError::new("request_failed", "Unable to read Codex SSE response.")
                .with_detail(json!({ "error": error.to_string() }))
        })?;
        if line.trim().is_empty() {
            if !data_lines.is_empty() {
                handle_sse_payload(
                    &data_lines.join(""),
                    logger,
                    &mut response_meta,
                    &mut output_items,
                    &mut response_error,
                )?;
                data_lines.clear();
            }
            continue;
        }
        if let Some(data) = line.strip_prefix("data:") {
            data_lines.push(data.trim_start().to_string());
        }
    }
    if !data_lines.is_empty() {
        handle_sse_payload(
            &data_lines.join(""),
            logger,
            &mut response_meta,
            &mut output_items,
            &mut response_error,
        )?;
    }

    let image_items = extract_codex_image_items(&output_items);
    if response_error.is_some() && image_items.is_empty() {
        let error_message = format_response_error(response_error.as_ref());
        return Err(AppError::new("request_failed", error_message));
    }
    emit_progress_event(
        logger,
        "codex",
        "request_completed",
        "Codex response payload received.",
        "running",
        Some(97),
        json!({
            "response_id": response_meta.get("id").cloned().unwrap_or(Value::Null),
            "image_count": image_items.len(),
        }),
    );
    Ok(json!({
        "response": response_meta,
        "output_items": output_items,
        "image_items": image_items,
    }))
}

fn handle_sse_payload(
    payload: &str,
    logger: &mut JsonEventLogger,
    response_meta: &mut Value,
    output_items: &mut Vec<Value>,
    response_error: &mut Option<Value>,
) -> Result<(), AppError> {
    if payload == "[DONE]" {
        logger.emit("sse", "done", json!({"raw": "[DONE]"}));
        return Ok(());
    }
    let event: Value = serde_json::from_str(payload).map_err(|error| {
        AppError::new("request_failed", "Unable to parse Codex SSE event.")
            .with_detail(json!({ "error": error.to_string(), "payload": payload }))
    })?;
    emit_sse_event(logger, &event);
    let event_type = event
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    match event_type {
        "response.created" => {
            if let Some(created) = event.get("response") {
                *response_meta = created.clone();
                emit_progress_event(
                    logger,
                    "codex",
                    "response_created",
                    "Codex accepted the image request.",
                    "running",
                    Some(15),
                    json!({
                        "response_id": created.get("id"),
                        "model": created.get("model"),
                    }),
                );
            }
        }
        "response.output_item.done" => {
            if let Some(item) = event.get("item") {
                merge_output_items(output_items, std::slice::from_ref(item));
                emit_progress_event(
                    logger,
                    "codex",
                    "output_item_done",
                    "Codex finished one output item.",
                    "running",
                    Some(85),
                    json!({
                        "item_id": item.get("id"),
                        "item_type": item.get("type"),
                        "item_status": item.get("status"),
                        "image_count": extract_codex_image_items(output_items).len(),
                    }),
                );
            }
        }
        "error" => {
            *response_error = event.get("error").cloned();
            emit_progress_event(
                logger,
                "codex",
                "request_failed",
                "Codex reported an image generation error.",
                "failed",
                None,
                json!({ "error": event.get("error") }),
            );
        }
        "response.failed" => {
            if let Some(failed_response) = event.get("response") {
                *response_meta = failed_response.clone();
                if let Some(output) = failed_response.get("output").and_then(Value::as_array) {
                    merge_output_items(output_items, output);
                }
                *response_error = failed_response
                    .get("error")
                    .cloned()
                    .or_else(|| response_error.clone());
                emit_progress_event(
                    logger,
                    "codex",
                    "request_failed",
                    "Codex marked the image request as failed.",
                    "failed",
                    None,
                    json!({
                        "response_id": failed_response.get("id"),
                        "error": response_error.clone(),
                    }),
                );
            }
        }
        "response.completed" => {
            if let Some(completed) = event.get("response") {
                *response_meta = completed.clone();
                emit_progress_event(
                    logger,
                    "codex",
                    "response_completed",
                    "Codex completed the server-side image response.",
                    "running",
                    Some(95),
                    json!({
                        "response_id": completed.get("id"),
                        "image_count": extract_codex_image_items(output_items).len(),
                    }),
                );
            }
        }
        _ => {}
    }
    Ok(())
}

fn merge_output_items(existing: &mut Vec<Value>, incoming: &[Value]) {
    for item in incoming {
        let item_id = item.get("id").and_then(Value::as_str);
        if let Some(item_id) = item_id
            && let Some(position) = existing
                .iter()
                .position(|candidate| candidate.get("id").and_then(Value::as_str) == Some(item_id))
        {
            existing[position] = item.clone();
            continue;
        }
        existing.push(item.clone());
    }
}

fn extract_codex_image_items(output_items: &[Value]) -> Vec<Value> {
    output_items
        .iter()
        .filter(|item| {
            item.get("type").and_then(Value::as_str) == Some("image_generation_call")
                && item.get("result").and_then(Value::as_str).is_some()
        })
        .cloned()
        .collect()
}

fn format_response_error(error: Option<&Value>) -> String {
    let Some(error) = error else {
        return "Image generation failed without structured error details.".to_string();
    };
    if let Some(object) = error.as_object() {
        let code = object
            .get("code")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let message = object
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Image generation failed");
        if !code.is_empty() {
            return format!("{code}: {message}");
        }
        return message.to_string();
    }
    "Image generation failed without structured error details.".to_string()
}

fn request_openai_images_once(
    endpoint: &str,
    auth_state: &OpenAiAuthState,
    body: &Value,
    logger: &mut JsonEventLogger,
) -> Result<Value, AppError> {
    logger.emit(
        "local",
        "request.started",
        json!({"provider": "openai", "endpoint": endpoint}),
    );
    emit_progress_event(
        logger,
        "openai",
        "request_started",
        "OpenAI image request sent.",
        "running",
        Some(0),
        json!({ "endpoint": endpoint }),
    );
    let client = make_client(DEFAULT_REQUEST_TIMEOUT)?;
    let response = client
        .post(endpoint)
        .header(AUTHORIZATION, format!("Bearer {}", auth_state.api_key))
        .header(CONTENT_TYPE, "application/json")
        .header(ACCEPT, "application/json")
        .body(body.to_string())
        .send()
        .map_err(|error| {
            AppError::new("network_error", "OpenAI request failed.")
                .with_detail(json!({ "error": error.to_string() }))
        })?;
    parse_openai_json_response(response, logger)
}

fn request_openai_edit_once(
    endpoint: &str,
    auth_state: &OpenAiAuthState,
    body: &Value,
    logger: &mut JsonEventLogger,
) -> Result<Value, AppError> {
    logger.emit(
        "local",
        "request.started",
        json!({"provider": "openai", "endpoint": endpoint, "transport": "multipart"}),
    );
    emit_progress_event(
        logger,
        "openai",
        "request_started",
        "OpenAI multipart image edit request started.",
        "running",
        Some(0),
        json!({ "endpoint": endpoint, "transport": "multipart" }),
    );
    let form = build_openai_edit_form(body)?;
    emit_progress_event(
        logger,
        "openai",
        "multipart_prepared",
        "OpenAI multipart image payload prepared.",
        "running",
        Some(10),
        json!({ "transport": "multipart" }),
    );
    let client = make_client(DEFAULT_REQUEST_TIMEOUT)?;
    let response = client
        .post(endpoint)
        .header(AUTHORIZATION, format!("Bearer {}", auth_state.api_key))
        .multipart(form)
        .send()
        .map_err(|error| {
            AppError::new("network_error", "OpenAI multipart request failed.")
                .with_detail(json!({ "error": error.to_string() }))
        })?;
    parse_openai_json_response(response, logger)
}

fn parse_openai_json_response(
    response: Response,
    logger: &mut JsonEventLogger,
) -> Result<Value, AppError> {
    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().unwrap_or_else(|_| String::new());
        return Err(http_status_error(status, detail));
    }
    let payload: Value = response.json().map_err(|error| {
        AppError::new(
            "invalid_json_response",
            "OpenAI Images API returned invalid JSON.",
        )
        .with_detail(json!({ "error": error.to_string() }))
    })?;
    if !payload.is_object() {
        return Err(AppError::new(
            "invalid_json_response",
            "OpenAI Images API returned a non-object JSON payload.",
        ));
    }
    emit_progress_event(
        logger,
        "openai",
        "request_completed",
        "OpenAI image response received.",
        "running",
        Some(95),
        json!({
            "created": payload.get("created"),
            "image_count": payload.get("data").and_then(Value::as_array).map(|items| items.len()).unwrap_or(0),
        }),
    );
    Ok(payload)
}

fn build_openai_edit_form(body: &Value) -> Result<Form, AppError> {
    let object = json_object(body)?;
    let mut form = Form::new();
    for key in [
        "model",
        "prompt",
        "size",
        "quality",
        "background",
        "output_format",
        "output_compression",
        "n",
        "moderation",
        "input_fidelity",
    ] {
        if let Some(value) = object.get(key)
            && let Some(scalar) = coerce_multipart_scalar(value)
        {
            form = form.text(key.to_string(), scalar);
        }
    }
    let images = extract_openai_edit_image_sources(body)?;
    if images.is_empty() {
        return Err(AppError::new(
            "missing_image_result",
            "OpenAI edit requests require at least one input image.",
        ));
    }
    for (index, source) in images.iter().enumerate() {
        let (mime_type, bytes, file_name) =
            load_image_source_bytes(source, &format!("image-{}", index + 1))?;
        let part = Part::bytes(bytes)
            .file_name(file_name)
            .mime_str(&mime_type)
            .map_err(|error| {
                AppError::new(
                    "ref_image_invalid",
                    "Invalid image MIME type for multipart edit.",
                )
                .with_detail(json!({ "error": error.to_string() }))
            })?;
        form = form.part("image[]", part);
    }
    if let Some(mask_source) = extract_openai_mask_source(body)? {
        let (mime_type, bytes, file_name) = load_image_source_bytes(&mask_source, "mask")?;
        let part = Part::bytes(bytes)
            .file_name(file_name)
            .mime_str(&mime_type)
            .map_err(|error| {
                AppError::new(
                    "ref_image_invalid",
                    "Invalid mask MIME type for multipart edit.",
                )
                .with_detail(json!({ "error": error.to_string() }))
            })?;
        form = form.part("mask", part);
    }
    Ok(form)
}

fn extract_openai_edit_image_sources(body: &Value) -> Result<Vec<String>, AppError> {
    let object = json_object(body)?;
    if let Some(images) = object.get("images").and_then(Value::as_array) {
        let mut result = Vec::new();
        for entry in images {
            if let Some(text) = entry.as_str() {
                result.push(text.to_string());
                continue;
            }
            if let Some(image_url) = entry
                .as_object()
                .and_then(|item| item.get("image_url"))
                .and_then(Value::as_str)
            {
                result.push(image_url.to_string());
            }
        }
        return Ok(result);
    }
    if let Some(image) = object.get("image")
        && let Some(text) = image.as_str()
    {
        return Ok(vec![text.to_string()]);
    }
    Ok(Vec::new())
}

fn extract_openai_mask_source(body: &Value) -> Result<Option<String>, AppError> {
    let object = json_object(body)?;
    if let Some(mask) = object.get("mask") {
        if let Some(text) = mask.as_str() {
            return Ok(Some(text.to_string()));
        }
        if let Some(image_url) = mask
            .as_object()
            .and_then(|item| item.get("image_url"))
            .and_then(Value::as_str)
        {
            return Ok(Some(image_url.to_string()));
        }
    }
    Ok(None)
}

fn coerce_multipart_scalar(value: &Value) -> Option<String> {
    match value {
        Value::Null => None,
        Value::Bool(value) => Some(if *value { "true" } else { "false" }.to_string()),
        Value::Number(value) => Some(value.to_string()),
        Value::String(value) => Some(value.clone()),
        _ => None,
    }
}

fn decode_base64_bytes(value: &str) -> Result<Vec<u8>, AppError> {
    let encoded = if value.starts_with("data:image/") {
        value
            .split_once(',')
            .ok_or_else(|| {
                AppError::new(
                    "invalid_base64",
                    "Image data URL did not contain a comma separator.",
                )
            })?
            .1
    } else {
        value
    };
    STANDARD.decode(encoded).map_err(|_| {
        AppError::new("invalid_base64", "Image payload was not valid base64.")
            .with_detail(json!({ "length": encoded.len() }))
    })
}

fn detect_mime_type(path: &Path, bytes: &[u8]) -> Result<String, AppError> {
    if let Some(mime) = mime_guess::from_path(path).first_raw()
        && mime.starts_with("image/")
    {
        return Ok(mime.to_string());
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Ok("image/png".to_string());
    }
    if bytes.starts_with(b"\xff\xd8\xff") {
        return Ok("image/jpeg".to_string());
    }
    if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        return Ok("image/webp".to_string());
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Ok("image/gif".to_string());
    }
    if bytes.starts_with(b"BM") {
        return Ok("image/bmp".to_string());
    }
    Err(AppError::new(
        "ref_image_invalid",
        format!(
            "Unsupported image format for reference image: {}",
            path.display()
        ),
    ))
}

fn filename_extension_for_mime_type(mime_type: &str) -> &'static str {
    match mime_type {
        "image/png" => ".png",
        "image/jpeg" => ".jpg",
        "image/webp" => ".webp",
        "image/gif" => ".gif",
        "image/bmp" => ".bmp",
        _ => ".bin",
    }
}

fn detect_extension(bytes: &[u8]) -> &'static str {
    match detect_mime_type(Path::new("file.bin"), bytes).as_deref() {
        Ok("image/png") => ".png",
        Ok("image/jpeg") => ".jpg",
        Ok("image/webp") => ".webp",
        Ok("image/gif") => ".gif",
        Ok("image/bmp") => ".bmp",
        _ => ".bin",
    }
}

fn local_path_to_data_url(path: &Path) -> Result<String, AppError> {
    if !path.is_file() {
        return Err(AppError::new(
            "ref_image_missing",
            format!("Reference image not found: {}", path.display()),
        ));
    }
    let bytes = fs::read(path).map_err(|error| {
        AppError::new("ref_image_invalid", "Unable to read reference image.")
            .with_detail(json!({ "error": error.to_string(), "path": path.display().to_string() }))
    })?;
    let mime_type = detect_mime_type(path, &bytes)?;
    let encoded = STANDARD.encode(bytes);
    Ok(format!("data:{mime_type};base64,{encoded}"))
}

fn resolve_ref_image(value: &str) -> Result<String, AppError> {
    match Url::parse(value) {
        Ok(url) => match url.scheme() {
            "http" | "https" | "data" => Ok(value.to_string()),
            "file" => {
                let path = url
                    .to_file_path()
                    .map_err(|_| AppError::new("ref_image_invalid", "Unsupported file URL."))?;
                local_path_to_data_url(&path)
            }
            _ => local_path_to_data_url(Path::new(value)),
        },
        Err(_) => local_path_to_data_url(Path::new(value)),
    }
}

fn resolve_ref_images(values: &[String]) -> Result<Vec<String>, AppError> {
    values
        .iter()
        .map(|value| resolve_ref_image(value))
        .collect()
}

fn sanitize_file_name(name: &str) -> String {
    let clean: String = name
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric() || ['-', '_', '.'].contains(character)
        })
        .collect();
    if clean.is_empty() {
        "image.bin".to_string()
    } else {
        clean
    }
}

fn parse_data_url_image(value: &str) -> Result<(String, Vec<u8>), AppError> {
    let Some((prefix, encoded)) = value.split_once(',') else {
        return Err(AppError::new(
            "invalid_data_url",
            "Image data URL must contain a base64 payload.",
        ));
    };
    if !prefix.contains(";base64") {
        return Err(AppError::new(
            "invalid_data_url",
            "Image data URL must contain a base64 payload.",
        ));
    }
    let mime_type = prefix
        .trim_start_matches("data:")
        .split(';')
        .next()
        .unwrap_or("application/octet-stream")
        .to_string();
    Ok((mime_type, decode_base64_bytes(encoded)?))
}

fn download_bytes(url: &str) -> Result<Vec<u8>, AppError> {
    let client = make_client(DEFAULT_REQUEST_TIMEOUT)?;
    let response = client.get(url).send().map_err(|error| {
        AppError::new("network_error", "Unable to download image bytes.")
            .with_detail(json!({ "error": error.to_string(), "url": url }))
    })?;
    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().unwrap_or_else(|_| String::new());
        return Err(http_status_error(status, detail));
    }
    response
        .bytes()
        .map(|bytes| bytes.to_vec())
        .map_err(|error| {
            AppError::new("network_error", "Unable to read downloaded image bytes.")
                .with_detail(json!({ "error": error.to_string(), "url": url }))
        })
}

fn load_image_source_bytes(
    source: &str,
    fallback_name: &str,
) -> Result<(String, Vec<u8>, String), AppError> {
    if source.starts_with("data:image/") {
        let (mime_type, bytes) = parse_data_url_image(source)?;
        let file_name = format!(
            "{fallback_name}{}",
            filename_extension_for_mime_type(&mime_type)
        );
        return Ok((mime_type, bytes, sanitize_file_name(&file_name)));
    }
    if let Ok(url) = Url::parse(source) {
        match url.scheme() {
            "http" | "https" => {
                let bytes = download_bytes(source)?;
                let guessed_name = Path::new(url.path())
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or(fallback_name);
                let mime_type = detect_mime_type(Path::new(guessed_name), &bytes)?;
                let file_name = format!(
                    "{}{}",
                    Path::new(guessed_name)
                        .file_stem()
                        .and_then(|stem| stem.to_str())
                        .unwrap_or(fallback_name),
                    filename_extension_for_mime_type(&mime_type)
                );
                return Ok((mime_type, bytes, sanitize_file_name(&file_name)));
            }
            "file" => {
                let path = url
                    .to_file_path()
                    .map_err(|_| AppError::new("ref_image_invalid", "Unsupported file URL."))?;
                let bytes = fs::read(&path).map_err(|error| {
                    AppError::new("ref_image_invalid", "Unable to read local file URL image.")
                        .with_detail(json!({ "error": error.to_string(), "path": path.display().to_string() }))
                })?;
                let mime_type = detect_mime_type(&path, &bytes)?;
                let file_name = path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(sanitize_file_name)
                    .unwrap_or_else(|| "image.bin".to_string());
                return Ok((mime_type, bytes, file_name));
            }
            _ => {}
        }
    }
    let path = Path::new(source);
    if path.is_file() {
        let bytes = fs::read(path).map_err(|error| {
            AppError::new("ref_image_invalid", "Unable to read local image.").with_detail(
                json!({ "error": error.to_string(), "path": path.display().to_string() }),
            )
        })?;
        let mime_type = detect_mime_type(path, &bytes)?;
        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .map(sanitize_file_name)
            .unwrap_or_else(|| "image.bin".to_string());
        return Ok((mime_type, bytes, file_name));
    }
    Err(AppError::new(
        "ref_image_invalid",
        format!("Unsupported image source for multipart edit: {source}"),
    ))
}

fn save_image(path: &Path, bytes: &[u8]) -> Result<PathBuf, AppError> {
    let final_path = if path.extension().is_none() {
        path.with_extension(detect_extension(bytes).trim_start_matches('.'))
    } else {
        path.to_path_buf()
    };
    if let Some(parent) = final_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            AppError::new("output_write_failed", "Unable to create output directory.").with_detail(
                json!({ "error": error.to_string(), "path": parent.display().to_string() }),
            )
        })?;
    }
    fs::write(&final_path, bytes).map_err(|error| {
        AppError::new("output_write_failed", "Unable to write output image.").with_detail(
            json!({ "error": error.to_string(), "path": final_path.display().to_string() }),
        )
    })?;
    Ok(final_path)
}

fn save_images(output_path: &Path, image_bytes_list: &[Vec<u8>]) -> Result<Vec<Value>, AppError> {
    if image_bytes_list.is_empty() {
        return Err(AppError::new(
            "missing_image_result",
            "No image bytes were available to save.",
        ));
    }
    if image_bytes_list.len() == 1 {
        let path = save_image(output_path, &image_bytes_list[0])?;
        return Ok(vec![json!({
            "index": 0,
            "path": path.display().to_string(),
            "bytes": image_bytes_list[0].len(),
        })]);
    }
    let mut saved = Vec::new();
    let base_name = output_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .or_else(|| output_path.file_name().and_then(|name| name.to_str()))
        .unwrap_or("image");
    let suffix = output_path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| format!(".{ext}"));
    for (index, bytes) in image_bytes_list.iter().enumerate() {
        let extension = suffix
            .clone()
            .unwrap_or_else(|| detect_extension(bytes).to_string());
        let path = output_path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join(format!("{base_name}-{}{}", index + 1, extension));
        save_image(&path, bytes)?;
        saved.push(json!({
            "index": index,
            "path": path.display().to_string(),
            "bytes": bytes.len(),
        }));
    }
    Ok(saved)
}

fn normalize_saved_output(saved_files: &[Value]) -> Value {
    if saved_files.len() == 1 {
        json!({
            "path": saved_files[0].get("path"),
            "bytes": saved_files[0].get("bytes"),
            "files": saved_files,
        })
    } else {
        let total_bytes: u64 = saved_files
            .iter()
            .filter_map(|item| item.get("bytes").and_then(Value::as_u64))
            .sum();
        json!({
            "path": Value::Null,
            "bytes": total_bytes,
            "files": saved_files,
        })
    }
}

fn primary_saved_output_path(output_path: &Path, saved_files: &[Value]) -> PathBuf {
    saved_files
        .first()
        .and_then(|file| file.get("path"))
        .and_then(Value::as_str)
        .map(PathBuf::from)
        .unwrap_or_else(|| output_path.to_path_buf())
}

fn history_image_metadata(
    operation: &str,
    selection: &ProviderSelection,
    shared: &SharedImageArgs,
    saved_files: &[Value],
) -> Value {
    json!({
        "operation": operation,
        "prompt": &shared.prompt,
        "size": shared.size.as_deref(),
        "format": shared.output_format.map(OutputFormat::as_str),
        "quality": shared.quality.map(Quality::as_str),
        "background": shared.background.as_str(),
        "n": shared.n,
        "provider_selection": selection.payload(),
        "output": normalize_saved_output(saved_files),
    })
}

type DecodedOpenAiImages = (Vec<Vec<u8>>, Vec<Option<String>>);

fn decode_openai_images(payload: &Value) -> Result<DecodedOpenAiImages, AppError> {
    let mut result = Vec::new();
    let mut revised_prompts = Vec::new();
    for item in payload
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        revised_prompts.push(
            item.get("revised_prompt")
                .and_then(Value::as_str)
                .map(ToString::to_string),
        );
        if let Some(b64_json) = item.get("b64_json").and_then(Value::as_str) {
            result.push(decode_base64_bytes(b64_json)?);
            continue;
        }
        if let Some(url) = item.get("url").and_then(Value::as_str) {
            result.push(download_bytes(url)?);
        }
    }
    Ok((result, revised_prompts))
}

fn summarize_image_request_options(
    provider: &str,
    operation: &str,
    resolved_model: &str,
    shared: &SharedImageArgs,
    ref_image_count: usize,
    mask_present: bool,
    input_fidelity: Option<InputFidelity>,
) -> Value {
    let mut summary = json!({
        "operation": operation,
        "provider": provider,
        "model": resolved_model,
        "background": shared.background.as_str(),
        "ref_image_count": ref_image_count,
    });
    if let Some(size) = &shared.size {
        summary["size"] = json!(size);
    }
    if let Some(quality) = shared.quality {
        summary["quality"] = json!(quality.as_str());
    }
    if let Some(output_format) = shared.output_format {
        summary["format"] = json!(output_format.as_str());
    }
    if let Some(output_compression) = shared.output_compression {
        summary["compression"] = json!(output_compression);
    }
    if let Some(n) = shared.n {
        summary["n"] = json!(n);
    }
    if let Some(moderation) = shared.moderation {
        summary["moderation"] = json!(moderation.as_str());
    }
    if provider == "codex" {
        summary["delegated_image_model"] = json!(DELEGATED_IMAGE_MODEL);
    }
    if mask_present {
        summary["mask_present"] = json!(true);
    }
    if let Some(input_fidelity) = input_fidelity {
        summary["input_fidelity"] = json!(input_fidelity.as_str());
    }
    summary
}

fn summarize_output_item(item: &Value) -> Value {
    let mut summary = json!({
        "id": item.get("id"),
        "type": item.get("type"),
        "status": item.get("status"),
    });
    for key in [
        "action",
        "background",
        "output_format",
        "quality",
        "size",
        "revised_prompt",
    ] {
        if let Some(value) = item.get(key) {
            summary[key] = value.clone();
        }
    }
    if let Some(result) = item.get("result").and_then(Value::as_str) {
        summary["result"] = summarize_large_string(Some("result"), result);
    }
    summary
}

fn build_openai_operation_endpoint(api_base: &str, operation: &str) -> Result<String, AppError> {
    match operation {
        "generate" => Ok(format!(
            "{}{}",
            api_base.trim_end_matches('/'),
            OPENAI_GENERATIONS_PATH
        )),
        "edit" => Ok(format!(
            "{}{}",
            api_base.trim_end_matches('/'),
            OPENAI_EDITS_PATH
        )),
        _ => Err(AppError::new(
            "invalid_operation",
            format!("Unsupported OpenAI image operation: {operation}"),
        )),
    }
}

fn run_config_command(cli: &Cli, command: &ConfigCommand) -> Result<CommandOutcome, AppError> {
    match &command.config_command {
        ConfigSubcommand::Path => Ok(CommandOutcome {
            payload: json!({
                "ok": true,
                "command": "config path",
                "config_dir": shared_config_dir().display().to_string(),
                "config_file": cli_config_path(cli).display().to_string(),
                "history_file": history_db_path().display().to_string(),
                "jobs_dir": jobs_dir().display().to_string(),
            }),
            exit_status: 0,
        }),
        ConfigSubcommand::Inspect => {
            let path = cli_config_path(cli);
            let config = load_app_config(&path)?;
            Ok(CommandOutcome {
                payload: json!({
                    "ok": true,
                    "command": "config inspect",
                    "config_file": path.display().to_string(),
                    "exists": path.is_file(),
                    "config": redact_app_config(&config),
                }),
                exit_status: 0,
            })
        }
        ConfigSubcommand::ListProviders => {
            let path = cli_config_path(cli);
            let config = load_app_config(&path)?;
            Ok(CommandOutcome {
                payload: json!({
                    "ok": true,
                    "command": "config list-providers",
                    "default_provider": config.default_provider,
                    "providers": redact_app_config(&config)["providers"].clone(),
                }),
                exit_status: 0,
            })
        }
        ConfigSubcommand::SetDefault(args) => {
            validate_provider_name(&args.name)?;
            let path = cli_config_path(cli);
            let mut config = load_app_config(&path)?;
            if !provider_is_builtin(&args.name) && !config.providers.contains_key(&args.name) {
                return Err(AppError::new(
                    "provider_unknown",
                    format!("Unknown provider: {}", args.name),
                ));
            }
            config.default_provider = Some(args.name.clone());
            save_app_config(&path, &config)?;
            Ok(CommandOutcome {
                payload: json!({
                    "ok": true,
                    "command": "config set-default",
                    "default_provider": args.name,
                    "config_file": path.display().to_string(),
                }),
                exit_status: 0,
            })
        }
        ConfigSubcommand::AddProvider(args) => run_config_add_provider(cli, args),
        ConfigSubcommand::RemoveProvider(args) => {
            let path = cli_config_path(cli);
            let mut config = load_app_config(&path)?;
            let removed = config.providers.remove(&args.name).is_some();
            if config.default_provider.as_deref() == Some(args.name.as_str()) {
                config.default_provider = None;
            }
            save_app_config(&path, &config)?;
            Ok(CommandOutcome {
                payload: json!({
                    "ok": true,
                    "command": "config remove-provider",
                    "provider": args.name,
                    "removed": removed,
                }),
                exit_status: 0,
            })
        }
        ConfigSubcommand::TestProvider(args) => {
            let selection = select_configured_provider(cli, &args.name, "config_test_provider")?;
            let endpoint = match selection.kind {
                ProviderKind::OpenAi => check_endpoint_reachability(&selection.api_base),
                ProviderKind::Codex => check_endpoint_reachability(&selection.codex_endpoint),
            };
            Ok(CommandOutcome {
                payload: json!({
                    "ok": endpoint.get("reachable").and_then(Value::as_bool).unwrap_or(false),
                    "command": "config test-provider",
                    "provider_selection": selection.payload(),
                    "endpoint": endpoint,
                }),
                exit_status: 0,
            })
        }
    }
}

fn run_config_add_provider(cli: &Cli, args: &AddProviderArgs) -> Result<CommandOutcome, AppError> {
    validate_provider_name(&args.name)?;
    let path = cli_config_path(cli);
    let mut config = load_app_config(&path)?;
    if args.supports_n && args.no_supports_n {
        return Err(AppError::new(
            "invalid_provider_config",
            "Use either --supports-n or --no-supports-n, not both.",
        ));
    }
    let edit_region_mode = args
        .edit_region_mode
        .as_deref()
        .map(normalize_edit_region_mode)
        .transpose()?;
    let mut credentials = BTreeMap::new();
    if let Some(api_key) = &args.api_key {
        credentials.insert(
            "api_key".to_string(),
            CredentialRef::File {
                value: api_key.clone(),
            },
        );
    }
    if let Some(api_key_env) = &args.api_key_env {
        credentials.insert(
            "api_key".to_string(),
            CredentialRef::Env {
                env: api_key_env.clone(),
            },
        );
    }
    if let Some(account_id) = &args.account_id {
        credentials.insert(
            "account_id".to_string(),
            CredentialRef::File {
                value: account_id.clone(),
            },
        );
    }
    if let Some(access_token) = &args.access_token {
        credentials.insert(
            "access_token".to_string(),
            CredentialRef::File {
                value: access_token.clone(),
            },
        );
    }
    if let Some(refresh_token) = &args.refresh_token {
        credentials.insert(
            "refresh_token".to_string(),
            CredentialRef::File {
                value: refresh_token.clone(),
            },
        );
    }
    let model = args
        .model
        .clone()
        .or_else(|| match args.provider_type.as_str() {
            "codex" => Some(DEFAULT_CODEX_MODEL.to_string()),
            _ => Some(DEFAULT_OPENAI_MODEL.to_string()),
        });
    let supports_n = if args.supports_n {
        Some(true)
    } else if args.no_supports_n {
        Some(false)
    } else {
        None
    };
    config.providers.insert(
        args.name.clone(),
        ProviderConfig {
            provider_type: args.provider_type.clone(),
            api_base: args.api_base.clone(),
            endpoint: args.endpoint.clone(),
            model,
            credentials,
            supports_n,
            edit_region_mode,
        },
    );
    if args.set_default || config.default_provider.is_none() {
        config.default_provider = Some(args.name.clone());
    }
    save_app_config(&path, &config)?;
    Ok(CommandOutcome {
        payload: json!({
            "ok": true,
            "command": "config add-provider",
            "provider": args.name,
            "config_file": path.display().to_string(),
            "config": redact_app_config(&config),
        }),
        exit_status: 0,
    })
}

fn run_secret_command(cli: &Cli, command: &SecretCommand) -> Result<CommandOutcome, AppError> {
    match &command.secret_command {
        SecretSubcommand::Set(args) => run_secret_set(cli, args),
        SecretSubcommand::Get(args) => run_secret_get(cli, args),
        SecretSubcommand::Delete(args) => run_secret_delete(cli, args),
    }
}

fn read_secret_value(args_value: &Option<String>) -> Result<String, AppError> {
    if let Some(value) = args_value {
        return Ok(value.clone());
    }
    let mut value = String::new();
    io::stdin().read_to_string(&mut value).map_err(|error| {
        AppError::new("secret_read_failed", "Unable to read secret from stdin.")
            .with_detail(json!({"error": error.to_string()}))
    })?;
    Ok(value.trim_end_matches(['\r', '\n']).to_string())
}

fn run_secret_set(cli: &Cli, args: &SecretSetArgs) -> Result<CommandOutcome, AppError> {
    let path = cli_config_path(cli);
    let mut config = load_app_config(&path)?;
    let provider = config.providers.get_mut(&args.provider).ok_or_else(|| {
        AppError::new(
            "provider_unknown",
            format!("Unknown provider: {}", args.provider),
        )
    })?;
    let credential = match args.source.as_str() {
        "file" => CredentialRef::File {
            value: read_secret_value(&args.value)?,
        },
        "env" => CredentialRef::Env {
            env: args.env.clone().ok_or_else(|| {
                AppError::new("secret_env_missing", "--env is required for env secrets.")
            })?,
        },
        "keychain" => {
            let account = args
                .account
                .clone()
                .unwrap_or_else(|| default_keychain_account(&args.provider, &args.name));
            let value = read_secret_value(&args.value)?;
            write_keychain_secret(KEYCHAIN_SERVICE, &account, &value)?;
            CredentialRef::Keychain {
                service: Some(KEYCHAIN_SERVICE.to_string()),
                account,
            }
        }
        other => {
            return Err(AppError::new(
                "secret_source_unsupported",
                format!("Unsupported secret source: {other}"),
            ));
        }
    };
    provider.credentials.insert(args.name.clone(), credential);
    save_app_config(&path, &config)?;
    Ok(CommandOutcome {
        payload: json!({
            "ok": true,
            "command": "secret set",
            "provider": args.provider,
            "name": args.name,
            "config_file": path.display().to_string(),
        }),
        exit_status: 0,
    })
}

fn run_secret_get(cli: &Cli, args: &SecretGetArgs) -> Result<CommandOutcome, AppError> {
    let config = load_app_config(&cli_config_path(cli))?;
    let provider = config.providers.get(&args.provider).ok_or_else(|| {
        AppError::new(
            "provider_unknown",
            format!("Unknown provider: {}", args.provider),
        )
    })?;
    let credential = provider.credentials.get(&args.name).ok_or_else(|| {
        AppError::new(
            "credential_missing",
            format!("Missing credential: {}", args.name),
        )
    })?;
    let resolved = resolve_credential(credential);
    if args.status {
        return Ok(CommandOutcome {
            payload: json!({
                "ok": true,
                "command": "secret get",
                "provider": args.provider,
                "name": args.name,
                "status": redact_credential_ref(credential),
                "ready": resolved.is_ok(),
            }),
            exit_status: 0,
        });
    }
    let (value, source) = resolved?;
    Ok(CommandOutcome {
        payload: json!({
            "ok": true,
            "command": "secret get",
            "provider": args.provider,
            "name": args.name,
            "source": source,
            "value": value,
        }),
        exit_status: 0,
    })
}

fn run_secret_delete(cli: &Cli, args: &SecretDeleteArgs) -> Result<CommandOutcome, AppError> {
    let path = cli_config_path(cli);
    let mut config = load_app_config(&path)?;
    let provider = config.providers.get_mut(&args.provider).ok_or_else(|| {
        AppError::new(
            "provider_unknown",
            format!("Unknown provider: {}", args.provider),
        )
    })?;
    let removed = provider.credentials.remove(&args.name);
    if let Some(CredentialRef::Keychain { service, account }) = &removed {
        let _ = delete_keychain_secret(service.as_deref().unwrap_or(KEYCHAIN_SERVICE), account);
    }
    save_app_config(&path, &config)?;
    Ok(CommandOutcome {
        payload: json!({
            "ok": true,
            "command": "secret delete",
            "provider": args.provider,
            "name": args.name,
            "removed": removed.is_some(),
        }),
        exit_status: 0,
    })
}

fn open_history_db() -> Result<Connection, AppError> {
    let path = history_db_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            AppError::new("history_open_failed", "Unable to create history directory.").with_detail(
                json!({"history_file": path.display().to_string(), "error": error.to_string()}),
            )
        })?;
    }
    let conn = Connection::open(&path).map_err(|error| {
        AppError::new("history_open_failed", "Unable to open history database.").with_detail(
            json!({"history_file": path.display().to_string(), "error": error.to_string()}),
        )
    })?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            command TEXT NOT NULL,
            provider TEXT NOT NULL,
            status TEXT NOT NULL,
            output_path TEXT,
            created_at TEXT NOT NULL,
            metadata TEXT NOT NULL
        )",
        [],
    )
    .map_err(|error| {
        AppError::new(
            "history_migration_failed",
            "Unable to initialize history database.",
        )
        .with_detail(json!({"error": error.to_string()}))
    })?;
    Ok(conn)
}

fn record_history_job(
    command_name: &str,
    provider: &str,
    status: &str,
    output_path: Option<&Path>,
    metadata: Value,
) -> Result<String, AppError> {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let job_id = format!("job-{}-{}", unique, std::process::id());
    upsert_history_job(
        &job_id,
        command_name,
        provider,
        status,
        output_path,
        None,
        metadata,
    )?;
    Ok(job_id)
}

pub fn upsert_history_job(
    job_id: &str,
    command_name: &str,
    provider: &str,
    status: &str,
    output_path: Option<&Path>,
    created_at: Option<&str>,
    metadata: Value,
) -> Result<(), AppError> {
    let conn = open_history_db()?;
    let timestamp = created_at
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(now_iso);
    conn.execute(
        "INSERT OR REPLACE INTO jobs (id, command, provider, status, output_path, created_at, metadata)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            job_id,
            command_name,
            provider,
            status,
            output_path.map(|path| path.display().to_string()),
            timestamp,
            serde_json::to_string(&metadata).unwrap_or_else(|_| "{}".to_string()),
        ],
    )
    .map_err(|error| {
        AppError::new("history_write_failed", "Unable to record history job.")
            .with_detail(json!({"error": error.to_string()}))
    })?;
    Ok(())
}

pub fn delete_history_job(job_id: &str) -> Result<usize, AppError> {
    let conn = open_history_db()?;
    conn.execute("DELETE FROM jobs WHERE id = ?1", params![job_id])
        .map_err(|error| {
            AppError::new("history_delete_failed", "Unable to delete history job.")
                .with_detail(json!({"error": error.to_string()}))
        })
}

fn history_row_to_value(row: &Row<'_>) -> rusqlite::Result<Value> {
    let output_path = row.get::<_, Option<String>>(4)?;
    let created_at = row.get::<_, String>(5)?;
    let metadata = serde_json::from_str::<Value>(&row.get::<_, String>(6)?).unwrap_or(Value::Null);
    let output = metadata.get("output").cloned().unwrap_or_else(|| json!({}));
    let outputs = output
        .get("files")
        .cloned()
        .or_else(|| {
            metadata
                .get("image_output")
                .and_then(|value| value.get("files"))
                .cloned()
        })
        .unwrap_or_else(|| json!([]));
    let updated_at = metadata
        .get("updated_at")
        .and_then(Value::as_str)
        .unwrap_or(&created_at)
        .to_string();
    let error = metadata.get("error").cloned().unwrap_or(Value::Null);
    Ok(json!({
        "id": row.get::<_, String>(0)?,
        "command": row.get::<_, String>(1)?,
        "provider": row.get::<_, String>(2)?,
        "status": row.get::<_, String>(3)?,
        "output_path": output_path,
        "created_at": created_at,
        "updated_at": updated_at,
        "metadata": metadata,
        "outputs": outputs,
        "error": error,
    }))
}

pub fn list_history_jobs() -> Result<Vec<Value>, AppError> {
    let conn = open_history_db()?;
    let mut stmt = conn
        .prepare("SELECT id, command, provider, status, output_path, created_at, metadata FROM jobs ORDER BY created_at DESC LIMIT 100")
        .map_err(|error| AppError::new("history_query_failed", "Unable to query history.").with_detail(json!({"error": error.to_string()})))?;
    stmt.query_map([], history_row_to_value)
        .map_err(|error| {
            AppError::new("history_query_failed", "Unable to query history.")
                .with_detail(json!({"error": error.to_string()}))
        })?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| {
            AppError::new("history_query_failed", "Unable to read history rows.")
                .with_detail(json!({"error": error.to_string()}))
        })
}

pub fn show_history_job(job_id: &str) -> Result<Value, AppError> {
    let conn = open_history_db()?;
    let mut stmt = conn
        .prepare("SELECT id, command, provider, status, output_path, created_at, metadata FROM jobs WHERE id = ?1")
        .map_err(|error| AppError::new("history_query_failed", "Unable to query history.").with_detail(json!({"error": error.to_string()})))?;
    stmt.query_row(params![job_id], history_row_to_value)
        .map_err(|error| {
            AppError::new("history_not_found", "History job was not found.")
                .with_detail(json!({"job_id": job_id, "error": error.to_string()}))
        })
}

fn run_history_command(_cli: &Cli, command: &HistoryCommand) -> Result<CommandOutcome, AppError> {
    match &command.history_command {
        HistorySubcommand::List => Ok(CommandOutcome {
            payload: json!({"ok": true, "command": "history list", "jobs": list_history_jobs()?}),
            exit_status: 0,
        }),
        HistorySubcommand::Show(args) | HistorySubcommand::OpenOutput(args) => {
            let row = show_history_job(&args.job_id)?;
            let opened = if matches!(&command.history_command, HistorySubcommand::OpenOutput(_)) {
                row.get("output_path")
                    .and_then(Value::as_str)
                    .map(open_path)
                    .unwrap_or(false)
            } else {
                false
            };
            Ok(CommandOutcome {
                payload: json!({"ok": true, "command": "history show", "job": row, "opened": opened}),
                exit_status: 0,
            })
        }
        HistorySubcommand::Delete(args) => {
            let count = delete_history_job(&args.job_id)?;
            Ok(CommandOutcome {
                payload: json!({"ok": true, "command": "history delete", "job_id": args.job_id, "deleted": count}),
                exit_status: 0,
            })
        }
    }
}

fn open_path(path: &str) -> bool {
    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(path).status();
    #[cfg(target_os = "windows")]
    let status = Command::new("cmd").args(["/C", "start", "", path]).status();
    #[cfg(all(unix, not(target_os = "macos")))]
    let status = Command::new("xdg-open").arg(path).status();
    status.map(|status| status.success()).unwrap_or(false)
}

fn run_doctor(cli: &Cli) -> CommandOutcome {
    let auth_path = PathBuf::from(&cli.auth_file);
    let config_path = cli_config_path(cli);
    let config = load_app_config(&config_path).unwrap_or_default();
    let codex_auth = inspect_codex_auth_file(&auth_path);
    let openai_auth = inspect_openai_auth(cli.api_key.as_deref());
    let codex_endpoint = check_endpoint_reachability(&cli.endpoint);
    let openai_endpoint = check_endpoint_reachability(&cli.openai_api_base);

    let selection = select_image_provider(cli);
    let ready = selection
        .as_ref()
        .map(|selection| {
            let endpoint = match selection.kind {
                ProviderKind::OpenAi => check_endpoint_reachability(&selection.api_base),
                ProviderKind::Codex => check_endpoint_reachability(&selection.codex_endpoint),
            };
            endpoint
                .get("reachable")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        })
        .unwrap_or(false);

    let provider_selection = match selection {
        Ok(selection) => {
            let mut payload = selection.payload();
            payload["error"] = Value::Null;
            payload
        }
        Err(error) => json!({
            "requested": cli.provider.as_str(),
            "resolved": Value::Null,
            "reason": Value::Null,
            "error": {
                "code": error.code,
                "message": error.message,
                "detail": error.detail,
            },
        }),
    };

    CommandOutcome {
        payload: json!({
            "ok": ready,
            "command": "doctor",
            "version": VERSION,
            "provider_selection": provider_selection,
            "providers": {
                "openai": {"auth": openai_auth, "endpoint": openai_endpoint},
                "codex": {"auth": codex_auth, "endpoint": codex_endpoint},
                "configured": redact_app_config(&config)["providers"].clone(),
            },
            "defaults": {
                "provider": "auto",
                "config_file": config_path.display().to_string(),
                "default_provider": config.default_provider,
                "openai_model": DEFAULT_OPENAI_MODEL,
                "codex_model": DEFAULT_CODEX_MODEL,
                "codex_endpoint": cli.endpoint,
                "openai_api_base": cli.openai_api_base,
            },
            "retry_policy": {
                "max_retries": DEFAULT_RETRY_COUNT,
                "base_delay_seconds": DEFAULT_RETRY_DELAY_SECONDS,
            }
        }),
        exit_status: 0,
    }
}

fn run_auth_inspect(cli: &Cli) -> Result<CommandOutcome, AppError> {
    let auth_path = PathBuf::from(&cli.auth_file);
    let config = load_app_config(&cli_config_path(cli))?;
    let providers = json!({
        "openai": inspect_openai_auth(cli.api_key.as_deref()),
        "codex": inspect_codex_auth_file(&auth_path),
        "configured": redact_app_config(&config)["providers"].clone(),
    });
    if cli.provider == "openai"
        && !providers["openai"]
            .get("ready")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    {
        return Err(AppError::new(
            "api_key_missing",
            format!("Missing {}.", OPENAI_API_KEY_ENV),
        ));
    }
    if cli.provider == "codex"
        && !providers["codex"]
            .get("ready")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    {
        return Err(AppError::new(
            "access_token_missing",
            "auth.json did not contain a usable access_token.",
        ));
    }
    Ok(CommandOutcome {
        payload: json!({
            "ok": true,
            "command": "auth inspect",
            "requested_provider": cli.provider.as_str(),
            "providers": providers,
        }),
        exit_status: 0,
    })
}

fn run_models_list() -> CommandOutcome {
    CommandOutcome {
        payload: json!({
            "ok": true,
            "command": "models list",
            "providers": build_known_model_payloads(),
        }),
        exit_status: 0,
    }
}

fn run_openai_image_command(
    cli: &Cli,
    selection: &ProviderSelection,
    shared: &SharedImageArgs,
    operation: &str,
    ref_images: &[String],
    mask: Option<&str>,
    input_fidelity: Option<InputFidelity>,
) -> Result<CommandOutcome, AppError> {
    let output_path = PathBuf::from(&shared.out);
    let auth_state = load_openai_auth_state_for(cli, selection)?;
    let resolved_ref_images = resolve_ref_images(ref_images)?;
    let resolved_mask = match mask {
        Some(mask) => Some(resolve_ref_image(mask)?),
        None => None,
    };
    let resolved_model = shared
        .model
        .clone()
        .unwrap_or_else(|| selection.default_model.clone());
    let body = build_openai_image_body(
        operation,
        &shared.prompt,
        &resolved_model,
        &resolved_ref_images,
        resolved_mask.as_deref(),
        input_fidelity,
        shared.background,
        shared.size.as_deref(),
        shared.quality,
        shared.output_format,
        shared.output_compression,
        shared.n,
        shared.moderation,
    );
    let endpoint = build_openai_operation_endpoint(&selection.api_base, operation)?;
    let mut logger = JsonEventLogger::new(cli.json_events);
    let (payload, retry_count) =
        execute_openai_with_retry(&mut logger, &selection.resolved, |logger| {
            if operation == "edit" {
                request_openai_edit_once(&endpoint, &auth_state, &body, logger)
            } else {
                request_openai_images_once(&endpoint, &auth_state, &body, logger)
            }
        })?;
    let (image_bytes_list, revised_prompts) = decode_openai_images(&payload)?;
    if image_bytes_list.is_empty() {
        return Err(AppError::new(
            "missing_image_result",
            "The response did not include a generated image.",
        ));
    }
    let saved_files = save_images(&output_path, &image_bytes_list)?;
    let primary_output_path = primary_saved_output_path(&output_path, &saved_files);
    let history_job_id = record_history_job(
        &format!("images {operation}"),
        &selection.resolved,
        "completed",
        Some(&primary_output_path),
        history_image_metadata(operation, selection, shared, &saved_files),
    )
    .ok();
    emit_progress_event(
        &mut logger,
        "openai",
        "output_saved",
        "Generated image files saved.",
        "completed",
        Some(100),
        json!({
            "file_count": saved_files.len(),
            "output": normalize_saved_output(&saved_files),
        }),
    );
    Ok(CommandOutcome {
        payload: json!({
            "ok": true,
            "command": format!("images {}", operation),
            "provider": selection.resolved,
            "provider_selection": selection.payload(),
            "auth": {
                "source": auth_state.source,
                "env_var": OPENAI_API_KEY_ENV,
                "refreshed": false,
            },
            "request": summarize_image_request_options("openai", operation, &resolved_model, shared, resolved_ref_images.len(), resolved_mask.is_some(), input_fidelity),
            "response": {
                "created": payload.get("created"),
                "background": payload.get("background"),
                "output_format": payload.get("output_format"),
                "quality": payload.get("quality"),
                "size": payload.get("size"),
                "usage": payload.get("usage").map(redact_event_payload).unwrap_or(Value::Null),
                "image_count": image_bytes_list.len(),
                "revised_prompts": revised_prompts.into_iter().flatten().collect::<Vec<_>>(),
            },
            "output": normalize_saved_output(&saved_files),
            "history": {
                "job_id": history_job_id,
            },
            "retry": {
                "count": retry_count,
                "max_retries": DEFAULT_RETRY_COUNT,
            },
            "events": {
                "count": logger.seq,
            }
        }),
        exit_status: 0,
    })
}

fn run_codex_image_command(
    cli: &Cli,
    selection: &ProviderSelection,
    shared: &SharedImageArgs,
    operation: &str,
    ref_images: &[String],
) -> Result<CommandOutcome, AppError> {
    let mut auth_state = load_codex_auth_state_for(cli, selection)?;
    let output_path = PathBuf::from(&shared.out);
    let resolved_ref_images = resolve_ref_images(ref_images)?;
    let resolved_model = shared
        .model
        .clone()
        .unwrap_or_else(|| selection.default_model.clone());
    let body = build_codex_image_body(
        &shared.prompt,
        &resolved_model,
        &shared.instructions,
        &resolved_ref_images,
        shared.background,
        shared.size.as_deref(),
        shared.quality,
        shared.output_format,
        shared.output_compression,
        operation,
    );
    let mut logger = JsonEventLogger::new(cli.json_events);
    let (outcome, auth_refreshed, retry_count) = request_codex_with_retry(
        &selection.codex_endpoint,
        &mut auth_state,
        &body,
        &mut logger,
    )?;
    let output_items = outcome
        .get("output_items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let image_items = extract_codex_image_items(&output_items);
    if image_items.is_empty() {
        return Err(AppError::new(
            "missing_image_result",
            "The response did not include an image_generation_call result.",
        ));
    }
    let image_bytes_list: Vec<Vec<u8>> = image_items
        .iter()
        .filter_map(|item| item.get("result").and_then(Value::as_str))
        .map(decode_base64_bytes)
        .collect::<Result<_, _>>()?;
    let saved_files = save_images(&output_path, &image_bytes_list)?;
    let primary_output_path = primary_saved_output_path(&output_path, &saved_files);
    let history_job_id = record_history_job(
        &format!("images {operation}"),
        &selection.resolved,
        "completed",
        Some(&primary_output_path),
        history_image_metadata(operation, selection, shared, &saved_files),
    )
    .ok();
    emit_progress_event(
        &mut logger,
        "codex",
        "output_saved",
        "Generated image files saved.",
        "completed",
        Some(100),
        json!({
            "file_count": saved_files.len(),
            "output": normalize_saved_output(&saved_files),
        }),
    );
    let response_meta = outcome
        .get("response")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let revised_prompts = image_items
        .iter()
        .filter_map(|item| item.get("revised_prompt").and_then(Value::as_str))
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    Ok(CommandOutcome {
        payload: json!({
            "ok": true,
            "command": format!("images {}", operation),
            "provider": selection.resolved,
            "provider_selection": selection.payload(),
            "auth": {
                "source": match &auth_state.persistence {
                    CodexAuthPersistence::AuthFile => "auth.json",
                    CodexAuthPersistence::ConfigProvider { .. } => "config",
                    CodexAuthPersistence::SessionOnly => "session",
                },
                "auth_file": auth_state.auth_path.display().to_string(),
                "account_id": auth_state.account_id,
                "refreshed": auth_refreshed,
            },
            "request": summarize_image_request_options("codex", operation, &resolved_model, shared, resolved_ref_images.len(), false, None),
            "response": {
                "response_id": response_meta.get("id"),
                "model": response_meta.get("model"),
                "service_tier": response_meta.get("service_tier"),
                "status": response_meta.get("status"),
                "image_count": image_items.len(),
                "item_ids": image_items.iter().map(|item| item.get("id").cloned().unwrap_or(Value::Null)).collect::<Vec<_>>(),
                "revised_prompts": revised_prompts,
            },
            "output": normalize_saved_output(&saved_files),
            "history": {
                "job_id": history_job_id,
            },
            "retry": {
                "count": retry_count,
                "max_retries": DEFAULT_RETRY_COUNT,
            },
            "events": {
                "count": logger.seq,
            }
        }),
        exit_status: 0,
    })
}

fn batch_output_path(output_path: &Path, index: usize) -> String {
    let base_name = output_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .or_else(|| output_path.file_name().and_then(|name| name.to_str()))
        .unwrap_or("image");
    let suffix = output_path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| format!(".{ext}"))
        .unwrap_or_else(|| ".png".to_string());
    output_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(format!("{base_name}-{}{}", index + 1, suffix))
        .display()
        .to_string()
}

fn output_files_from_payload(payload: &Value) -> Vec<Value> {
    let output = payload.get("output").cloned().unwrap_or_else(|| json!({}));
    let mut files = output
        .get("files")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if files.is_empty()
        && let Some(path) = output.get("path").and_then(Value::as_str)
    {
        files.push(json!({
            "index": 0,
            "path": path,
            "bytes": output.get("bytes").and_then(Value::as_u64).unwrap_or(0),
        }));
    }
    files
}

fn normalize_batch_saved_files(files: Vec<Value>) -> Vec<Value> {
    files
        .into_iter()
        .enumerate()
        .map(|(index, mut file)| {
            if let Value::Object(object) = &mut file {
                object.insert("index".to_string(), json!(index));
            }
            file
        })
        .collect()
}

fn run_batched_image_command(
    cli: &Cli,
    selection: &ProviderSelection,
    shared: &SharedImageArgs,
    operation: &str,
    ref_images: &[String],
    mask: Option<&str>,
    input_fidelity: Option<InputFidelity>,
) -> Result<CommandOutcome, AppError> {
    let count = shared.n.unwrap_or(1);
    let output_path = PathBuf::from(&shared.out);
    let jobs = (0..count)
        .map(|index| {
            let mut next = shared.clone();
            next.n = None;
            next.out = batch_output_path(&output_path, index as usize);
            next
        })
        .collect::<Vec<_>>();
    let outcomes = std::thread::scope(|scope| {
        let handles = jobs
            .into_iter()
            .map(|next| {
                scope.spawn(move || {
                    if matches!(selection.kind, ProviderKind::OpenAi) {
                        run_openai_image_command(
                            cli,
                            selection,
                            &next,
                            operation,
                            ref_images,
                            mask,
                            input_fidelity,
                        )
                    } else {
                        run_codex_image_command(cli, selection, &next, operation, ref_images)
                    }
                })
            })
            .collect::<Vec<_>>();
        let mut outcomes = Vec::with_capacity(handles.len());
        for handle in handles {
            outcomes.push(handle.join().map_err(|_| {
                AppError::new(
                    "batch_worker_failed",
                    "Batch image request worker panicked.",
                )
            })??);
        }
        Ok::<_, AppError>(outcomes)
    })?;
    let saved_files = normalize_batch_saved_files(
        outcomes
            .iter()
            .flat_map(|outcome| output_files_from_payload(&outcome.payload))
            .collect(),
    );
    if saved_files.is_empty() {
        return Err(AppError::new(
            "missing_image_result",
            "The batch response did not include generated images.",
        ));
    }
    let primary_output_path = primary_saved_output_path(&output_path, &saved_files);
    let history_job_id = record_history_job(
        &format!("images {operation}"),
        &selection.resolved,
        "completed",
        Some(&primary_output_path),
        history_image_metadata(operation, selection, shared, &saved_files),
    )
    .ok();
    Ok(CommandOutcome {
        payload: json!({
            "ok": true,
            "command": format!("images {}", operation),
            "provider": selection.resolved,
            "provider_selection": selection.payload(),
            "request": {
                "operation": operation,
                "provider": if matches!(selection.kind, ProviderKind::OpenAi) { "openai" } else { "codex" },
                "n": count,
                "batch_mode": "parallel-single-output",
            },
            "response": {
                "image_count": saved_files.len(),
                "batch_request_count": count,
            },
            "output": normalize_saved_output(&saved_files),
            "history": {
                "job_id": history_job_id,
            },
            "events": {
                "count": outcomes.iter().filter_map(|outcome| outcome.payload.get("events").and_then(|events| events.get("count")).and_then(Value::as_u64)).sum::<u64>(),
            }
        }),
        exit_status: 0,
    })
}

fn run_images_command(
    cli: &Cli,
    subcommand: &ImagesSubcommand,
) -> Result<CommandOutcome, AppError> {
    let selection = select_image_provider(cli)?;
    match subcommand {
        ImagesSubcommand::Generate(args) => {
            let use_batch = args.shared.n.unwrap_or(1) > 1 && !selection.supports_n;
            let mut validation_shared = args.shared.clone();
            if use_batch {
                validation_shared.n = None;
            }
            validate_provider_specific_image_args(&selection, &validation_shared, None, None)?;
            if use_batch {
                return run_batched_image_command(
                    cli,
                    &selection,
                    &args.shared,
                    "generate",
                    &[],
                    None,
                    None,
                );
            }
            if matches!(selection.kind, ProviderKind::OpenAi) {
                run_openai_image_command(cli, &selection, &args.shared, "generate", &[], None, None)
            } else {
                run_codex_image_command(cli, &selection, &args.shared, "generate", &[])
            }
        }
        ImagesSubcommand::Edit(args) => {
            validate_reference_image_count(args.ref_image.len())?;
            let use_batch = args.shared.n.unwrap_or(1) > 1 && !selection.supports_n;
            let mut validation_shared = args.shared.clone();
            if use_batch {
                validation_shared.n = None;
            }
            validate_provider_specific_image_args(
                &selection,
                &validation_shared,
                args.mask.as_deref(),
                args.input_fidelity,
            )?;
            if use_batch {
                return run_batched_image_command(
                    cli,
                    &selection,
                    &args.shared,
                    "edit",
                    &args.ref_image,
                    args.mask.as_deref(),
                    args.input_fidelity,
                );
            }
            if matches!(selection.kind, ProviderKind::OpenAi) {
                run_openai_image_command(
                    cli,
                    &selection,
                    &args.shared,
                    "edit",
                    &args.ref_image,
                    args.mask.as_deref(),
                    args.input_fidelity,
                )
            } else {
                run_codex_image_command(cli, &selection, &args.shared, "edit", &args.ref_image)
            }
        }
    }
}

fn run_request_create_codex(
    cli: &Cli,
    selection: &ProviderSelection,
    args: &RequestCreateArgs,
) -> Result<CommandOutcome, AppError> {
    if args.request_operation != RequestOperation::Responses {
        return Err(AppError::new(
            "unsupported_option",
            "Codex request create uses --request-operation responses.",
        ));
    }
    let mut auth_state = load_codex_auth_state_for(cli, selection)?;
    let body = read_body_json(&args.body_file)?;
    let mut logger = JsonEventLogger::new(cli.json_events);
    let (outcome, auth_refreshed, retry_count) = request_codex_with_retry(
        &selection.codex_endpoint,
        &mut auth_state,
        &body,
        &mut logger,
    )?;
    let response_meta = outcome
        .get("response")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let output_items = outcome
        .get("output_items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let image_items = extract_codex_image_items(&output_items);
    let image_output = if image_items.is_empty() {
        None
    } else {
        let image_bytes_list: Vec<Vec<u8>> = image_items
            .iter()
            .filter_map(|item| item.get("result").and_then(Value::as_str))
            .map(decode_base64_bytes)
            .collect::<Result<_, _>>()?;
        if let Some(out_image) = &args.out_image {
            let saved_files = save_images(Path::new(out_image), &image_bytes_list)?;
            let output = normalize_saved_output(&saved_files);
            emit_progress_event(
                &mut logger,
                "codex",
                "output_saved",
                "Generated image files saved.",
                "completed",
                Some(100),
                json!({ "file_count": saved_files.len(), "output": output }),
            );
            Some(output)
        } else {
            Some(json!({
                "available": true,
                "count": image_bytes_list.len(),
                "suggested_extension": detect_extension(&image_bytes_list[0]),
            }))
        }
    };
    if args.expect_image && image_output.is_none() {
        return Err(AppError::new(
            "missing_image_result",
            "The response did not include a generated image.",
        ));
    }
    let history_job_id = record_history_job(
        "request create",
        &selection.resolved,
        "completed",
        args.out_image.as_deref().map(Path::new),
        json!({
            "operation": "responses",
            "provider_selection": selection.payload(),
            "image_output": image_output.clone(),
        }),
    )
    .ok();
    Ok(CommandOutcome {
        payload: json!({
            "ok": true,
            "command": "request create",
            "provider": selection.resolved,
            "provider_selection": selection.payload(),
            "request": {
                "operation": "responses",
                "body_file": args.body_file,
            },
            "response": {
                "response_id": response_meta.get("id"),
                "model": response_meta.get("model"),
                "service_tier": response_meta.get("service_tier"),
                "status": response_meta.get("status"),
                "error": response_meta.get("error").map(redact_event_payload).unwrap_or(Value::Null),
            },
            "output_items": output_items.iter().map(summarize_output_item).collect::<Vec<_>>(),
            "image_output": image_output,
            "history": {
                "job_id": history_job_id,
            },
            "retry": {
                "count": retry_count,
                "max_retries": DEFAULT_RETRY_COUNT,
            },
            "auth": {
                "source": match &auth_state.persistence {
                    CodexAuthPersistence::AuthFile => "auth.json",
                    CodexAuthPersistence::ConfigProvider { .. } => "config",
                    CodexAuthPersistence::SessionOnly => "session",
                },
                "auth_file": auth_state.auth_path.display().to_string(),
                "refreshed": auth_refreshed,
            },
            "events": {
                "count": logger.seq,
            }
        }),
        exit_status: 0,
    })
}

fn run_request_create_openai(
    cli: &Cli,
    selection: &ProviderSelection,
    args: &RequestCreateArgs,
) -> Result<CommandOutcome, AppError> {
    if !matches!(
        args.request_operation,
        RequestOperation::Generate | RequestOperation::Edit
    ) {
        return Err(AppError::new(
            "unsupported_option",
            "OpenAI request create uses --request-operation generate or edit.",
        ));
    }
    let auth_state = load_openai_auth_state_for(cli, selection)?;
    let body = read_body_json(&args.body_file)?;
    let endpoint =
        build_openai_operation_endpoint(&selection.api_base, args.request_operation.as_str())?;
    let mut logger = JsonEventLogger::new(cli.json_events);
    let (payload, retry_count) =
        execute_openai_with_retry(&mut logger, &selection.resolved, |logger| {
            if args.request_operation == RequestOperation::Edit {
                request_openai_edit_once(&endpoint, &auth_state, &body, logger)
            } else {
                request_openai_images_once(&endpoint, &auth_state, &body, logger)
            }
        })?;
    let (image_bytes_list, revised_prompts) = decode_openai_images(&payload)?;
    let image_output = if image_bytes_list.is_empty() {
        None
    } else if let Some(out_image) = &args.out_image {
        let saved_files = save_images(Path::new(out_image), &image_bytes_list)?;
        let output = normalize_saved_output(&saved_files);
        emit_progress_event(
            &mut logger,
            "openai",
            "output_saved",
            "Generated image files saved.",
            "completed",
            Some(100),
            json!({ "file_count": saved_files.len(), "output": output }),
        );
        Some(output)
    } else {
        Some(json!({
            "available": true,
            "count": image_bytes_list.len(),
            "suggested_extension": detect_extension(&image_bytes_list[0]),
        }))
    };
    if args.expect_image && image_output.is_none() {
        return Err(AppError::new(
            "missing_image_result",
            "The response did not include a generated image.",
        ));
    }
    let history_job_id = record_history_job(
        "request create",
        &selection.resolved,
        "completed",
        args.out_image.as_deref().map(Path::new),
        json!({
            "operation": args.request_operation.as_str(),
            "provider_selection": selection.payload(),
            "image_output": image_output.clone(),
        }),
    )
    .ok();
    Ok(CommandOutcome {
        payload: json!({
            "ok": true,
            "command": "request create",
            "provider": selection.resolved,
            "provider_selection": selection.payload(),
            "request": {
                "operation": args.request_operation.as_str(),
                "body_file": args.body_file,
                "model": body.get("model"),
            },
            "response": {
                "created": payload.get("created"),
                "background": payload.get("background"),
                "output_format": payload.get("output_format"),
                "quality": payload.get("quality"),
                "size": payload.get("size"),
                "usage": payload.get("usage").map(redact_event_payload).unwrap_or(Value::Null),
                "revised_prompts": revised_prompts.into_iter().flatten().collect::<Vec<_>>(),
            },
            "image_output": image_output,
            "history": {
                "job_id": history_job_id,
            },
            "retry": {
                "count": retry_count,
                "max_retries": DEFAULT_RETRY_COUNT,
            },
            "auth": {
                "source": auth_state.source,
                "env_var": OPENAI_API_KEY_ENV,
                "refreshed": false,
            },
            "events": {
                "count": logger.seq,
            }
        }),
        exit_status: 0,
    })
}

fn run_request_create(cli: &Cli, args: &RequestCreateArgs) -> Result<CommandOutcome, AppError> {
    let selection = select_request_provider(cli, args)?;
    if matches!(selection.kind, ProviderKind::OpenAi) {
        run_request_create_openai(cli, &selection, args)
    } else {
        run_request_create_codex(cli, &selection, args)
    }
}

fn dispatch(cli: &Cli) -> Result<CommandOutcome, AppError> {
    match &cli.command {
        Commands::Doctor => Ok(run_doctor(cli)),
        Commands::Auth(command) => match command.auth_command {
            AuthSubcommand::Inspect => run_auth_inspect(cli),
        },
        Commands::Config(command) => run_config_command(cli, command),
        Commands::Secret(command) => run_secret_command(cli, command),
        Commands::History(command) => run_history_command(cli, command),
        Commands::Models(command) => match command.models_command {
            ModelsSubcommand::List => Ok(run_models_list()),
        },
        Commands::Images(command) => run_images_command(cli, &command.images_command),
        Commands::Request(command) => match &command.request_command {
            RequestSubcommand::Create(args) => run_request_create(cli, args),
        },
    }
}

pub fn run(argv: &[String]) -> i32 {
    let outcome = run_json(argv);
    emit_json(&outcome.payload);
    outcome.exit_status
}

pub fn run_json(argv: &[String]) -> CommandOutcome {
    match Cli::try_parse_from(argv) {
        Ok(cli) => match dispatch(&cli) {
            Ok(outcome) => outcome,
            Err(error) => {
                let (payload, exit_status) = build_error_payload(error);
                CommandOutcome {
                    payload,
                    exit_status,
                }
            }
        },
        Err(error) => {
            let app_error = AppError::new("invalid_command", error.to_string()).with_exit_status(2);
            let (payload, exit_status) = build_error_payload(app_error);
            CommandOutcome {
                payload,
                exit_status,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_image_size_accepts_aliases() {
        assert_eq!(parse_image_size("2K").unwrap(), "2048x2048");
        assert_eq!(parse_image_size("4k").unwrap(), "3840x2160");
    }

    #[test]
    fn parse_image_size_accepts_valid_dimensions() {
        assert_eq!(parse_image_size("1024x640").unwrap(), "1024x640");
        assert_eq!(parse_image_size("2880x2880").unwrap(), "2880x2880");
        assert_eq!(parse_image_size("2160x3840").unwrap(), "2160x3840");
    }

    #[test]
    fn parse_image_size_rejects_oversized_square() {
        assert!(parse_image_size("4096x4096").is_err());
    }

    #[test]
    fn parse_image_size_rejects_too_few_pixels() {
        assert!(parse_image_size("512x512").is_err());
    }

    #[test]
    fn build_openai_image_body_for_edit_includes_mask_and_images() {
        let body = build_openai_image_body(
            "edit",
            "edit this image",
            "gpt-image-2",
            &["data:image/png;base64,AAAA".to_string()],
            Some("data:image/png;base64,BBBB"),
            Some(InputFidelity::High),
            Background::Auto,
            Some("1024x1024"),
            Some(Quality::High),
            Some(OutputFormat::Png),
            None,
            Some(1),
            Some(Moderation::Auto),
        );
        assert_eq!(body["images"][0]["image_url"], "data:image/png;base64,AAAA");
        assert_eq!(body["mask"]["image_url"], "data:image/png;base64,BBBB");
        assert_eq!(body["input_fidelity"], "high");
        assert_eq!(body["model"], "gpt-image-2");
    }

    #[test]
    fn build_openai_edit_form_contains_required_parts() {
        let body = json!({
            "model": "gpt-image-2",
            "prompt": "Edit this image",
            "images": [{"image_url": "data:image/png;base64,YWJjZA=="}],
            "mask": {"image_url": "data:image/png;base64,YWJjZA=="},
            "size": "1024x1024",
        });
        assert!(build_openai_edit_form(&body).is_ok());
    }

    #[test]
    fn app_config_round_trips_with_file_secret() {
        let temp_dir = tempfile::tempdir().unwrap();
        let config_path = temp_dir.path().join("config.json");
        let mut config = AppConfig {
            default_provider: Some("local".to_string()),
            ..Default::default()
        };
        config.providers.insert(
            "local".to_string(),
            ProviderConfig {
                provider_type: "openai-compatible".to_string(),
                api_base: Some("https://example.com/v1".to_string()),
                endpoint: None,
                model: Some(DEFAULT_OPENAI_MODEL.to_string()),
                credentials: BTreeMap::from([(
                    "api_key".to_string(),
                    CredentialRef::File {
                        value: "sk-test".to_string(),
                    },
                )]),
                supports_n: Some(false),
                edit_region_mode: Some(EDIT_REGION_REFERENCE_HINT.to_string()),
            },
        );
        save_app_config(&config_path, &config).unwrap();
        let loaded = load_app_config(&config_path).unwrap();
        assert_eq!(loaded.default_provider.as_deref(), Some("local"));
        assert_eq!(
            redact_app_config(&loaded)["providers"]["local"]["credentials"]["api_key"]["value"]["_omitted"],
            "secret"
        );
    }

    #[test]
    fn configured_openai_provider_resolves_with_file_secret() {
        let provider = ProviderConfig {
            provider_type: "openai-compatible".to_string(),
            api_base: Some("https://example.com/v1".to_string()),
            endpoint: None,
            model: None,
            credentials: BTreeMap::from([(
                "api_key".to_string(),
                CredentialRef::File {
                    value: "sk-test".to_string(),
                },
            )]),
            supports_n: Some(true),
            edit_region_mode: None,
        };
        let selection = configured_provider_selection("local", &provider, "test", None).unwrap();
        assert_eq!(selection.resolved, "local");
        assert_eq!(selection.api_base, "https://example.com/v1");
        assert!(matches!(selection.kind, ProviderKind::OpenAi));
        assert_eq!(selection.edit_region_mode, EDIT_REGION_REFERENCE_HINT);
    }
}
