use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::{AppError, CredentialRef};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum BaiduNetdiskAuthMode {
    Personal,
    Oauth,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Pan123OpenAuthMode {
    Client,
    AccessToken,
}

pub fn effective_baidu_netdisk_auth_mode(
    auth_mode: Option<BaiduNetdiskAuthMode>,
    access_token: Option<&CredentialRef>,
) -> BaiduNetdiskAuthMode {
    auth_mode.unwrap_or_else(|| {
        if access_token.is_some() {
            BaiduNetdiskAuthMode::Personal
        } else {
            BaiduNetdiskAuthMode::Oauth
        }
    })
}

pub fn effective_pan123_open_auth_mode(
    auth_mode: Option<Pan123OpenAuthMode>,
    access_token: Option<&CredentialRef>,
) -> Pan123OpenAuthMode {
    auth_mode.unwrap_or_else(|| {
        if access_token.is_some() {
            Pan123OpenAuthMode::AccessToken
        } else {
            Pan123OpenAuthMode::Client
        }
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum StorageTargetConfig {
    Local {
        directory: PathBuf,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        public_base_url: Option<String>,
    },
    S3 {
        bucket: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        region: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        endpoint: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        prefix: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        access_key_id: Option<CredentialRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        secret_access_key: Option<CredentialRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        session_token: Option<CredentialRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        public_base_url: Option<String>,
    },
    #[serde(rename = "webdav")]
    WebDav {
        url: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        username: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        password: Option<CredentialRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        public_base_url: Option<String>,
    },
    Http {
        url: String,
        #[serde(default = "default_http_storage_method")]
        method: String,
        #[serde(default)]
        headers: BTreeMap<String, CredentialRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        public_url_json_pointer: Option<String>,
    },
    Sftp {
        host: String,
        #[serde(default = "default_sftp_port")]
        port: u16,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        host_key_sha256: Option<String>,
        username: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        password: Option<CredentialRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        private_key: Option<CredentialRef>,
        remote_dir: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        public_base_url: Option<String>,
    },
    #[serde(rename = "baidu_netdisk")]
    BaiduNetdisk {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        auth_mode: Option<BaiduNetdiskAuthMode>,
        app_key: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        secret_key: Option<CredentialRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        access_token: Option<CredentialRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        refresh_token: Option<CredentialRef>,
        app_name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        remote_dir: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        public_base_url: Option<String>,
    },
    #[serde(rename = "pan123_open")]
    Pan123Open {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        auth_mode: Option<Pan123OpenAuthMode>,
        client_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        client_secret: Option<CredentialRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        access_token: Option<CredentialRef>,
        #[serde(default)]
        parent_id: u64,
        #[serde(default)]
        use_direct_link: bool,
    },
}

fn default_http_storage_method() -> String {
    "POST".to_string()
}

fn default_sftp_port() -> u16 {
    22
}

/// Suitability ranking for a backend acting as the **Result Origin** — the
/// authoritative store the task list reads originals from.
///
/// This is a *type-level* property, not a deployment property: a backend type
/// is `Full` if its protocol supports the operations Origin needs (random
/// readback at predictable latency), `Degraded` if it works but with caveats
/// (vendor rate limits, throttling), and `Unsupported` if it can only accept
/// uploads (e.g. webhooks) and therefore can never serve historical reads.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PrimaryQuality {
    Full,
    Degraded,
    Unsupported,
}

/// What a backend instance is *capable of doing in principle*, independent of
/// whether the current code path implements it. Pipeline planning, UI
/// gating, and policy enforcement should consult `capabilities()` rather than
/// matching `StorageTargetConfig` variants directly — that keeps decision
/// sites stable as new backends are added.
///
/// The flags describe protocol-level affordances; whether a particular
/// operation is wired up in this build is a separate concern tracked by the
/// individual backend modules.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Eq, PartialEq)]
pub struct BackendCapabilities {
    pub can_upload: bool,
    pub can_read_back: bool,
    pub can_delete: bool,
    pub can_list: bool,
    pub has_public_url: bool,
    pub primary_quality: PrimaryQuality,
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum StorageFallbackPolicy {
    Never,
    OnFailure,
    Always,
}

impl Default for StorageFallbackPolicy {
    fn default() -> Self {
        Self::OnFailure
    }
}

/// How `Result Origin` and `Archives` relate for a deployment. Replaces the
/// older flat (default_targets / fallback_targets / fallback_policy) trio,
/// whose three policy values were mutually inconsistent and easy to misuse.
///
/// Origin is the authoritative store the task list reads originals from;
/// Archives are async copies that may or may not be readable. See
/// `effective_pipeline()` for how legacy configs map onto these modes.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PipelineMode {
    /// Local result library is the Origin; no archives. Default for Tauri and
    /// small-team Docker.
    LocalOnly,
    /// Local Origin plus N async archives — the "double-insurance" pattern.
    /// Equivalent to today's `fallback_policy = Always` users.
    Mirror,
    /// A remote backend serves as Origin (must support readback). Local jobs
    /// dir degrades into upload buffer cache. GC of the buffer is a separate
    /// later step; this enum value reserves the schema slot now.
    CloudPrimary,
    /// Local Origin plus archives that are write-only (e.g. webhooks). Catches
    /// the legacy `fallback_targets` use case where the second list contains
    /// targets that can never serve as Origin.
    CloudArchiveOnly,
}

/// Lifecycle policy for cached/local copies of originals when `CloudPrimary`
/// is enabled. Cleanup only deletes local cache files after upload history
/// proves the configured Origin and Archive targets have completed; remote
/// objects are never deleted implicitly by these policies.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CleanupMode {
    Never,
    AfterArchiveSuccess,
    ByAge,
    BySize,
}

impl Default for CleanupMode {
    fn default() -> Self {
        Self::Never
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq, Default)]
pub struct CleanupPolicy {
    #[serde(default)]
    pub mode: CleanupMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retention_days: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_origin_gb: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
pub struct PipelineConfig {
    pub mode: PipelineMode,
    /// Required when `mode == CloudPrimary`; ignored otherwise. References a
    /// target name in `StorageConfig.targets` whose `can_act_as_origin()` is
    /// true.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
    /// Async archive targets, run for every successful job. Order is the
    /// authored order (deduplication preserves first occurrence).
    #[serde(default)]
    pub archives: Vec<String>,
    #[serde(default)]
    pub cleanup: CleanupPolicy,
}

impl Default for PipelineConfig {
    fn default() -> Self {
        Self {
            mode: PipelineMode::LocalOnly,
            origin: None,
            archives: Vec::new(),
            cleanup: CleanupPolicy::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq, Default)]
pub struct StorageManagementPolicy {
    /// Set by managed deployments to surface config-as-code defaults or locks.
    #[serde(default)]
    pub managed: bool,
    /// When true, the policy is advisory: UI can label the defaults as
    /// administrator-provided, but user edits remain authoritative. When
    /// false, UI/server save paths preserve this policy and coerce user edits
    /// back to the managed pipeline boundary.
    #[serde(default)]
    pub allow_user_overrides: bool,
    /// Restrict selectable pipeline modes for locked policies. An empty list
    /// means "no mode restriction" unless another lock (such as locked_origin)
    /// implies one.
    #[serde(default)]
    pub allowed_modes: Vec<PipelineMode>,
    /// Force a target name to be the remote Result Origin for locked policies.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub locked_origin: Option<String>,
    /// Force the archive target list for locked policies. Empty means the
    /// user/config may choose.
    #[serde(default)]
    pub locked_archives: Vec<String>,
    /// Optional operator-facing note surfaced in UI.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl StorageManagementPolicy {
    fn apply_to_pipeline(&self, pipeline: &mut PipelineConfig) {
        if !self.managed || self.allow_user_overrides {
            return;
        }
        if !self.allowed_modes.is_empty() && !self.allowed_modes.contains(&pipeline.mode) {
            pipeline.mode = self.allowed_modes[0];
        }
        if let Some(origin) = normalized_policy_name(&self.locked_origin) {
            pipeline.mode = PipelineMode::CloudPrimary;
            pipeline.origin = Some(origin);
        }
        if !self.locked_archives.is_empty() {
            pipeline.archives = dedupe_policy_names(&self.locked_archives);
        }
        if pipeline.mode != PipelineMode::CloudPrimary {
            pipeline.origin = None;
        }
        if let Some(origin) = pipeline.origin.as_deref() {
            pipeline.archives.retain(|archive| archive != origin);
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageConfig {
    #[serde(default)]
    pub targets: BTreeMap<String, StorageTargetConfig>,
    /// Pipeline takes precedence over the legacy fields below; if `None`,
    /// `effective_pipeline()` synthesises one from those fields so old
    /// configs continue to work without manual migration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pipeline: Option<PipelineConfig>,
    /// Legacy: read only via `effective_pipeline()`. Kept for back-compat
    /// load + zero-value emit during the deprecation window.
    #[deprecated(
        since = "0.5.3",
        note = "Use StorageConfig::effective_pipeline() instead."
    )]
    #[serde(default)]
    pub default_targets: Vec<String>,
    /// Legacy: read only via `effective_pipeline()`.
    #[deprecated(
        since = "0.5.3",
        note = "Use StorageConfig::effective_pipeline() instead."
    )]
    #[serde(default = "default_storage_fallback_targets")]
    pub fallback_targets: Vec<String>,
    /// Legacy: read only via `effective_pipeline()`.
    #[deprecated(
        since = "0.5.3",
        note = "Use StorageConfig::effective_pipeline() instead."
    )]
    #[serde(default)]
    pub fallback_policy: StorageFallbackPolicy,
    #[serde(default = "default_storage_upload_concurrency")]
    pub upload_concurrency: usize,
    #[serde(default = "default_storage_target_concurrency")]
    pub target_concurrency: usize,
    #[serde(default)]
    pub policy: StorageManagementPolicy,
}

fn normalized_policy_name(value: &Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn dedupe_policy_names(values: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for value in values {
        let clean = value.trim();
        if !clean.is_empty() && !out.iter().any(|existing: &String| existing == clean) {
            out.push(clean.to_string());
        }
    }
    out
}

fn default_storage_fallback_targets() -> Vec<String> {
    Vec::new()
}

fn default_storage_upload_concurrency() -> usize {
    4
}

fn default_storage_target_concurrency() -> usize {
    2
}

impl Default for StorageConfig {
    #[allow(deprecated)] // Initialising the legacy fields with empty defaults; access of deprecated fields is intentional inside this constructor.
    fn default() -> Self {
        Self {
            targets: BTreeMap::new(),
            pipeline: None,
            default_targets: Vec::new(),
            fallback_targets: default_storage_fallback_targets(),
            fallback_policy: StorageFallbackPolicy::default(),
            upload_concurrency: default_storage_upload_concurrency(),
            target_concurrency: default_storage_target_concurrency(),
            policy: StorageManagementPolicy::default(),
        }
    }
}

impl StorageConfig {
    /// Resolve the deployment pipeline that should drive uploads.
    ///
    /// If `self.pipeline` is set, it wins outright (legacy fields are ignored
    /// even if populated — this matches the "explicit configuration is
    /// authoritative" rule).
    ///
    /// Otherwise we synthesise a `PipelineConfig` from the legacy
    /// `default_targets` / `fallback_targets` / `fallback_policy` trio:
    ///
    /// | Legacy state | Synthesised mode | Notes |
    /// |---|---|---|
    /// | both lists empty | `LocalOnly` | the default install baseline |
    /// | only `fallback_targets` populated | `CloudArchiveOnly`, archives = fallback | the "archive only" pattern |
    /// | only `default_targets` populated | `CloudArchiveOnly`, archives = default | "always upload to defaults" |
    /// | both populated, `policy = Always` | `Mirror`, archives = default ∪ fallback | Always already meant "run everything" |
    /// | both populated, `policy in {OnFailure, Never}` | `CloudArchiveOnly` | OnFailure's "run fallback only on primary failure" semantics is intentionally dropped (everyone uploads to all archives now). Never's fallback list is also discarded. |
    #[allow(deprecated)] // The legacy fields are read here on purpose: this is the migration shim.
    pub fn effective_pipeline(&self) -> PipelineConfig {
        let mut pipeline = if let Some(pipeline) = &self.pipeline {
            pipeline.clone()
        } else {
            let primary = &self.default_targets;
            let fallback = &self.fallback_targets;
            if primary.is_empty() && fallback.is_empty() {
                PipelineConfig::default()
            } else {
                let merged = match (primary.is_empty(), fallback.is_empty()) {
                    (true, false) => fallback.clone(),
                    (false, true) => primary.clone(),
                    (false, false) => match self.fallback_policy {
                        StorageFallbackPolicy::Never => primary.clone(),
                        StorageFallbackPolicy::OnFailure | StorageFallbackPolicy::Always => {
                            let mut out = Vec::with_capacity(primary.len() + fallback.len());
                            for name in primary.iter().chain(fallback.iter()) {
                                if !out.iter().any(|existing: &String| existing == name) {
                                    out.push(name.clone());
                                }
                            }
                            out
                        }
                    },
                    (true, true) => unreachable!("handled by the empty-empty branch above"),
                };
                let mode = if matches!(self.fallback_policy, StorageFallbackPolicy::Always)
                    && !primary.is_empty()
                    && !fallback.is_empty()
                {
                    PipelineMode::Mirror
                } else {
                    PipelineMode::CloudArchiveOnly
                };
                PipelineConfig {
                    mode,
                    origin: None,
                    archives: merged,
                    cleanup: CleanupPolicy::default(),
                }
            }
        };
        self.policy.apply_to_pipeline(&mut pipeline);
        pipeline
    }

    pub fn enforce_policy(&mut self) {
        if self.policy.managed && !self.policy.allow_user_overrides {
            self.pipeline = Some(self.effective_pipeline());
        }
    }

    pub fn validate_pipeline(&self) -> Result<(), AppError> {
        let pipeline = self.effective_pipeline();
        if !matches!(pipeline.mode, PipelineMode::CloudPrimary) {
            return Ok(());
        }
        let origin = pipeline
            .origin
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                AppError::new(
                    "storage_origin_missing",
                    "Cloud-primary storage requires an Origin target.",
                )
            })?;
        let target = self.targets.get(origin).ok_or_else(|| {
            AppError::new(
                "storage_origin_missing",
                "Cloud-primary Origin target is not configured.",
            )
            .with_detail(serde_json::json!({"origin": origin}))
        })?;
        if !target.can_act_as_origin() {
            return Err(AppError::new(
                "storage_origin_readback_unsupported",
                "Cloud-primary Origin must support implemented readback.",
            )
            .with_detail(serde_json::json!({"origin": origin})));
        }
        Ok(())
    }
}

impl StorageTargetConfig {
    pub fn capabilities(&self) -> BackendCapabilities {
        match self {
            Self::Local {
                public_base_url, ..
            } => BackendCapabilities {
                can_upload: true,
                can_read_back: true,
                can_delete: true,
                can_list: true,
                has_public_url: public_base_url.is_some(),
                primary_quality: PrimaryQuality::Full,
            },
            Self::S3 {
                public_base_url, ..
            } => BackendCapabilities {
                can_upload: true,
                can_read_back: true,
                can_delete: true,
                can_list: true,
                has_public_url: public_base_url.is_some(),
                primary_quality: PrimaryQuality::Full,
            },
            Self::WebDav {
                public_base_url, ..
            } => BackendCapabilities {
                can_upload: true,
                can_read_back: true,
                can_delete: true,
                can_list: true,
                has_public_url: public_base_url.is_some(),
                primary_quality: PrimaryQuality::Full,
            },
            Self::Sftp {
                public_base_url, ..
            } => BackendCapabilities {
                can_upload: true,
                can_read_back: true,
                can_delete: true,
                can_list: true,
                has_public_url: public_base_url.is_some(),
                primary_quality: PrimaryQuality::Full,
            },
            Self::BaiduNetdisk {
                public_base_url, ..
            } => BackendCapabilities {
                can_upload: true,
                can_read_back: false,
                can_delete: true,
                // Baidu OpenAPI has read/list APIs, but this build has only
                // wired upload. Do not advertise Origin readback until
                // download/head support lands.
                can_list: false,
                has_public_url: public_base_url.is_some(),
                primary_quality: PrimaryQuality::Degraded,
            },
            Self::Pan123Open {
                use_direct_link, ..
            } => BackendCapabilities {
                can_upload: true,
                can_read_back: false,
                can_delete: true,
                can_list: false,
                has_public_url: *use_direct_link,
                primary_quality: PrimaryQuality::Degraded,
            },
            Self::Http {
                public_url_json_pointer,
                ..
            } => BackendCapabilities {
                can_upload: true,
                can_read_back: false,
                can_delete: false,
                can_list: false,
                has_public_url: public_url_json_pointer.is_some(),
                primary_quality: PrimaryQuality::Unsupported,
            },
        }
    }

    /// Whether this backend may serve as the Result Origin. Pipeline UIs use
    /// this to filter the Origin selector — `Unsupported` quality and missing
    /// readback are both disqualifying.
    pub fn can_act_as_origin(&self) -> bool {
        let caps = self.capabilities();
        caps.can_read_back && !matches!(caps.primary_quality, PrimaryQuality::Unsupported)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn netdisk_auth_mode_is_serialized_for_explicit_configs() {
        let baidu = StorageTargetConfig::BaiduNetdisk {
            auth_mode: Some(BaiduNetdiskAuthMode::Personal),
            app_key: String::new(),
            secret_key: None,
            access_token: Some(CredentialRef::File {
                value: "token".to_string(),
            }),
            refresh_token: None,
            app_name: "gpt-image-2".to_string(),
            remote_dir: None,
            public_base_url: None,
        };
        let pan123 = StorageTargetConfig::Pan123Open {
            auth_mode: Some(Pan123OpenAuthMode::AccessToken),
            client_id: String::new(),
            client_secret: None,
            access_token: Some(CredentialRef::File {
                value: "token".to_string(),
            }),
            parent_id: 0,
            use_direct_link: false,
        };

        assert_eq!(
            serde_json::to_value(baidu).unwrap()["auth_mode"],
            json!("personal")
        );
        assert_eq!(
            serde_json::to_value(pan123).unwrap()["auth_mode"],
            json!("access_token")
        );
    }

    #[test]
    fn netdisk_auth_mode_can_be_inferred_for_legacy_configs() {
        let baidu: StorageTargetConfig = serde_json::from_value(json!({
            "type": "baidu_netdisk",
            "app_key": "app-key",
            "secret_key": {"source": "file", "value": "secret"},
            "refresh_token": {"source": "file", "value": "refresh"},
            "app_name": "gpt-image-2"
        }))
        .unwrap();
        let pan123: StorageTargetConfig = serde_json::from_value(json!({
            "type": "pan123_open",
            "client_id": "",
            "access_token": {"source": "file", "value": "access"}
        }))
        .unwrap();

        let StorageTargetConfig::BaiduNetdisk {
            auth_mode,
            access_token,
            ..
        } = &baidu
        else {
            panic!("expected baidu target");
        };
        let StorageTargetConfig::Pan123Open {
            auth_mode: pan123_auth_mode,
            access_token: pan123_access_token,
            ..
        } = &pan123
        else {
            panic!("expected 123 target");
        };

        assert_eq!(
            effective_baidu_netdisk_auth_mode(*auth_mode, access_token.as_ref()),
            BaiduNetdiskAuthMode::Oauth
        );
        assert_eq!(
            effective_pan123_open_auth_mode(*pan123_auth_mode, pan123_access_token.as_ref()),
            Pan123OpenAuthMode::AccessToken
        );
    }

    fn local(public_base_url: Option<&str>) -> StorageTargetConfig {
        StorageTargetConfig::Local {
            directory: PathBuf::from("/tmp/test"),
            public_base_url: public_base_url.map(str::to_string),
        }
    }

    fn s3(public_base_url: Option<&str>) -> StorageTargetConfig {
        StorageTargetConfig::S3 {
            bucket: "bucket".to_string(),
            region: None,
            endpoint: None,
            prefix: None,
            access_key_id: None,
            secret_access_key: None,
            session_token: None,
            public_base_url: public_base_url.map(str::to_string),
        }
    }

    fn webdav(public_base_url: Option<&str>) -> StorageTargetConfig {
        StorageTargetConfig::WebDav {
            url: "https://example.com".to_string(),
            username: None,
            password: None,
            public_base_url: public_base_url.map(str::to_string),
        }
    }

    fn sftp(public_base_url: Option<&str>) -> StorageTargetConfig {
        StorageTargetConfig::Sftp {
            host: "host".to_string(),
            port: 22,
            host_key_sha256: None,
            username: "user".to_string(),
            password: None,
            private_key: None,
            remote_dir: "/upload".to_string(),
            public_base_url: public_base_url.map(str::to_string),
        }
    }

    fn baidu(public_base_url: Option<&str>) -> StorageTargetConfig {
        StorageTargetConfig::BaiduNetdisk {
            auth_mode: None,
            app_key: "app".to_string(),
            secret_key: None,
            access_token: None,
            refresh_token: None,
            app_name: "app".to_string(),
            remote_dir: None,
            public_base_url: public_base_url.map(str::to_string),
        }
    }

    fn pan123(use_direct_link: bool) -> StorageTargetConfig {
        StorageTargetConfig::Pan123Open {
            auth_mode: None,
            client_id: "client".to_string(),
            client_secret: None,
            access_token: None,
            parent_id: 0,
            use_direct_link,
        }
    }

    fn http(with_pointer: bool) -> StorageTargetConfig {
        StorageTargetConfig::Http {
            url: "https://example.com/upload".to_string(),
            method: "POST".to_string(),
            headers: BTreeMap::new(),
            public_url_json_pointer: if with_pointer {
                Some("/url".to_string())
            } else {
                None
            },
        }
    }

    #[test]
    fn local_capabilities_are_full_with_optional_public_url() {
        let caps = local(None).capabilities();
        assert!(caps.can_upload && caps.can_read_back && caps.can_delete && caps.can_list);
        assert!(!caps.has_public_url);
        assert_eq!(caps.primary_quality, PrimaryQuality::Full);

        let caps_with_url = local(Some("https://cdn.example.com")).capabilities();
        assert!(caps_with_url.has_public_url);
        assert_eq!(caps_with_url.primary_quality, PrimaryQuality::Full);
    }

    #[test]
    fn s3_capabilities_are_full() {
        let caps = s3(Some("https://cdn.example.com")).capabilities();
        assert!(caps.can_upload && caps.can_read_back && caps.can_delete && caps.can_list);
        assert!(caps.has_public_url);
        assert_eq!(caps.primary_quality, PrimaryQuality::Full);
    }

    #[test]
    fn webdav_capabilities_are_full() {
        let caps = webdav(None).capabilities();
        assert!(caps.can_upload && caps.can_read_back && caps.can_delete && caps.can_list);
        assert!(!caps.has_public_url);
        assert_eq!(caps.primary_quality, PrimaryQuality::Full);
    }

    #[test]
    fn sftp_capabilities_are_full() {
        let caps = sftp(None).capabilities();
        assert!(caps.can_upload && caps.can_read_back && caps.can_delete && caps.can_list);
        assert_eq!(caps.primary_quality, PrimaryQuality::Full);
    }

    #[test]
    fn baidu_capabilities_are_degraded_without_listing() {
        let caps = baidu(None).capabilities();
        assert!(caps.can_upload && caps.can_delete);
        assert!(!caps.can_read_back);
        assert!(!caps.can_list);
        assert_eq!(caps.primary_quality, PrimaryQuality::Degraded);
    }

    #[test]
    fn pan123_public_url_follows_direct_link_flag() {
        assert!(!pan123(false).capabilities().has_public_url);
        assert!(pan123(true).capabilities().has_public_url);
        assert!(!pan123(false).capabilities().can_read_back);
        assert_eq!(
            pan123(false).capabilities().primary_quality,
            PrimaryQuality::Degraded
        );
    }

    #[test]
    fn http_capabilities_are_unsupported_for_origin() {
        let caps = http(false).capabilities();
        assert!(caps.can_upload);
        assert!(!caps.can_read_back && !caps.can_delete && !caps.can_list);
        assert!(!caps.has_public_url);
        assert_eq!(caps.primary_quality, PrimaryQuality::Unsupported);

        assert!(http(true).capabilities().has_public_url);
    }

    #[test]
    fn can_act_as_origin_matches_implemented_readback_backends() {
        assert!(local(None).can_act_as_origin());
        assert!(s3(None).can_act_as_origin());
        assert!(webdav(None).can_act_as_origin());
        assert!(sftp(None).can_act_as_origin());
        assert!(!baidu(None).can_act_as_origin());
        assert!(!pan123(false).can_act_as_origin());
        assert!(!http(false).can_act_as_origin());
        assert!(!http(true).can_act_as_origin());
    }

    #[test]
    fn validate_pipeline_rejects_cloud_primary_origin_without_readback() {
        let mut config = StorageConfig {
            targets: BTreeMap::from([
                ("baidu".to_string(), baidu(None)),
                ("pan123".to_string(), pan123(true)),
                ("webhook".to_string(), http(false)),
            ]),
            ..StorageConfig::default()
        };
        for origin in ["baidu", "pan123", "webhook"] {
            config.pipeline = Some(PipelineConfig {
                mode: PipelineMode::CloudPrimary,
                origin: Some(origin.to_string()),
                archives: Vec::new(),
                cleanup: CleanupPolicy::default(),
            });
            let err = config.validate_pipeline().unwrap_err();
            assert_eq!(err.code, "storage_origin_readback_unsupported");
        }
    }

    #[test]
    fn validate_pipeline_accepts_implemented_readback_origin() {
        let config = StorageConfig {
            targets: BTreeMap::from([("origin".to_string(), local(None))]),
            pipeline: Some(PipelineConfig {
                mode: PipelineMode::CloudPrimary,
                origin: Some("origin".to_string()),
                archives: Vec::new(),
                cleanup: CleanupPolicy::default(),
            }),
            ..StorageConfig::default()
        };
        config.validate_pipeline().unwrap();
    }

    #[test]
    fn managed_policy_locks_origin_and_archive_selection() {
        let config = StorageConfig {
            pipeline: Some(PipelineConfig {
                mode: PipelineMode::Mirror,
                origin: None,
                archives: vec!["local-copy".to_string(), "r2-origin".to_string()],
                cleanup: CleanupPolicy::default(),
            }),
            policy: StorageManagementPolicy {
                managed: true,
                locked_origin: Some("r2-origin".to_string()),
                locked_archives: vec!["audit-webhook".to_string(), "r2-origin".to_string()],
                allowed_modes: vec![PipelineMode::CloudPrimary],
                ..StorageManagementPolicy::default()
            },
            ..StorageConfig::default()
        };

        let pipeline = config.effective_pipeline();
        assert_eq!(pipeline.mode, PipelineMode::CloudPrimary);
        assert_eq!(pipeline.origin.as_deref(), Some("r2-origin"));
        assert_eq!(pipeline.archives, vec!["audit-webhook"]);
    }

    #[test]
    fn managed_policy_with_user_overrides_is_advisory() {
        let mut config = StorageConfig {
            pipeline: Some(PipelineConfig {
                mode: PipelineMode::Mirror,
                origin: None,
                archives: vec!["user-archive".to_string()],
                cleanup: CleanupPolicy::default(),
            }),
            policy: StorageManagementPolicy {
                managed: true,
                allow_user_overrides: true,
                locked_origin: Some("r2-origin".to_string()),
                locked_archives: vec!["audit-webhook".to_string()],
                allowed_modes: vec![PipelineMode::CloudPrimary],
                ..StorageManagementPolicy::default()
            },
            ..StorageConfig::default()
        };

        let pipeline = config.effective_pipeline();
        assert_eq!(pipeline.mode, PipelineMode::Mirror);
        assert_eq!(pipeline.origin, None);
        assert_eq!(pipeline.archives, vec!["user-archive"]);

        config.enforce_policy();
        assert_eq!(config.pipeline.unwrap().archives, vec!["user-archive"]);
    }
}
