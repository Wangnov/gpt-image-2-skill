#![allow(unused_imports)]

use super::*;
pub(crate) use gpt_image_2_runtime::{JobQueueInner, QueuedJob, QueuedTask};

#[derive(Debug, Deserialize)]
pub(crate) struct ProviderInput {
    #[serde(rename = "type")]
    pub(crate) provider_type: String,
    #[serde(default)]
    pub(crate) api_base: Option<String>,
    #[serde(default)]
    pub(crate) endpoint: Option<String>,
    #[serde(default)]
    pub(crate) model: Option<String>,
    #[serde(default)]
    pub(crate) credentials: BTreeMap<String, CredentialInput>,
    #[serde(default)]
    pub(crate) supports_n: Option<bool>,
    #[serde(default)]
    pub(crate) edit_region_mode: Option<String>,
    #[serde(default)]
    pub(crate) preset: Option<String>,
    #[serde(default)]
    pub(crate) image_transport: Option<String>,
    #[serde(default)]
    pub(crate) poll_interval_seconds: Option<u64>,
    #[serde(default)]
    pub(crate) poll_timeout_seconds: Option<u64>,
    #[serde(default)]
    pub(crate) proxy: Option<ProxyConfig>,
    #[serde(default)]
    pub(crate) set_default: bool,
    #[serde(default)]
    pub(crate) allow_overwrite: bool,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "source", rename_all = "lowercase")]
pub(crate) enum CredentialInput {
    File {
        #[serde(default)]
        value: Option<String>,
    },
    Env {
        env: String,
    },
    Keychain {
        #[serde(default)]
        service: Option<String>,
        #[serde(default)]
        account: Option<String>,
        #[serde(default)]
        value: Option<String>,
    },
}

#[derive(Clone)]
pub(crate) struct JobQueueState {
    pub(crate) inner: Arc<Mutex<JobQueueInner>>,
    pub(crate) auth: Arc<AuthPolicy>,
}

impl Default for JobQueueState {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(JobQueueInner::default())),
            auth: Arc::new(AuthPolicy::default()),
        }
    }
}

impl JobQueueState {
    pub(crate) fn with_auth(auth: AuthPolicy) -> Self {
        Self {
            auth: Arc::new(auth),
            ..Self::default()
        }
    }
}
