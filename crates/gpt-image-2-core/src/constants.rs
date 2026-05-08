#![allow(unused_imports)]

use super::*;

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

pub const PRODUCT_DIR_NAME: &str = "gpt-image-2";

pub const RESULTS_DIR_NAME: &str = "results";

pub const EXPORTS_DIR_NAME: &str = "exports";

pub const KEYCHAIN_SERVICE: &str = "gpt-image-2-skill";

pub const DEFAULT_HISTORY_PAGE_LIMIT: usize = 100;

pub const MAX_HISTORY_PAGE_LIMIT: usize = 200;
