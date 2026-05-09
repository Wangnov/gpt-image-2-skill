#![allow(unused_imports)]

use super::*;

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
}

impl Default for JobQueueState {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(JobQueueInner {
                max_parallel: 2,
                running: 0,
                queue: VecDeque::new(),
                events: BTreeMap::new(),
                next_seq: BTreeMap::new(),
            })),
        }
    }
}

pub(crate) struct JobQueueInner {
    pub(crate) max_parallel: usize,
    pub(crate) running: usize,
    pub(crate) queue: VecDeque<QueuedJob>,
    pub(crate) events: BTreeMap<String, Vec<Value>>,
    pub(crate) next_seq: BTreeMap<String, u64>,
}

#[derive(Clone)]
pub(crate) enum QueuedTask {
    Generate(GenerateRequest),
    Edit(EditRequest),
}

#[derive(Clone)]
pub(crate) struct QueuedJob {
    pub(crate) id: String,
    pub(crate) command: String,
    pub(crate) provider: String,
    pub(crate) created_at: String,
    pub(crate) dir: PathBuf,
    pub(crate) metadata: Value,
    pub(crate) task: QueuedTask,
}
