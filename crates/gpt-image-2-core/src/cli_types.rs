#![allow(unused_imports)]

use super::*;

#[derive(Debug, Clone, Copy, Eq, PartialEq, ValueEnum)]
pub enum Background {
    Auto,
    Transparent,
    Opaque,
}

impl Background {
    pub(crate) fn as_str(self) -> &'static str {
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
    pub(crate) fn as_str(self) -> &'static str {
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
    pub(crate) fn as_str(self) -> &'static str {
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
    pub(crate) fn as_str(self) -> &'static str {
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
    pub(crate) fn as_str(self) -> &'static str {
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
    pub(crate) fn as_str(self) -> &'static str {
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
    Transparent(transparent::TransparentCommand),
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
