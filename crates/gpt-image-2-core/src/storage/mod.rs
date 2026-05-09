pub(crate) mod backends;
mod history;
mod orchestrator;
mod redaction;
pub(crate) mod secrets;
mod test_target;
mod types;
pub(crate) mod util;

pub use history::{OutputUploadRecord, list_output_upload_records, upsert_output_upload_record};
pub use orchestrator::{StorageUploadOverrides, upload_job_outputs_to_storage};
pub use secrets::preserve_storage_secrets;
pub use test_target::{StorageTestResult, test_storage_target};
pub use types::{
    BaiduNetdiskAuthMode, Pan123OpenAuthMode, StorageConfig, StorageFallbackPolicy,
    StorageTargetConfig,
};

pub(crate) use history::{
    enrich_outputs_with_uploads, list_output_upload_records_with_conn, storage_status_for_uploads,
};
pub(crate) use redaction::redact_storage_config;
pub(crate) use types::{effective_baidu_netdisk_auth_mode, effective_pan123_open_auth_mode};
