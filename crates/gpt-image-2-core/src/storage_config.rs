use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::paths::default_legacy_shared_codex_path;

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PathMode {
    Default,
    Custom,
}

impl Default for PathMode {
    fn default() -> Self {
        Self::Default
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
pub struct PathRef {
    #[serde(default)]
    pub mode: PathMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<PathBuf>,
}

impl Default for PathRef {
    fn default() -> Self {
        Self {
            mode: PathMode::Default,
            path: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, Ord, PartialEq, PartialOrd)]
#[serde(rename_all = "snake_case")]
pub enum ExportDirMode {
    Downloads,
    Documents,
    Pictures,
    ResultLibrary,
    Custom,
    BrowserDefault,
}

impl Default for ExportDirMode {
    fn default() -> Self {
        Self::Downloads
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
pub struct ExportDirConfig {
    #[serde(default)]
    pub mode: ExportDirMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<PathBuf>,
}

impl Default for ExportDirConfig {
    fn default() -> Self {
        Self {
            mode: ExportDirMode::Downloads,
            path: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
pub struct LegacyPathConfig {
    #[serde(default = "default_legacy_shared_codex_path")]
    pub path: PathBuf,
    #[serde(default = "default_true")]
    pub enabled_for_read: bool,
}

impl Default for LegacyPathConfig {
    fn default() -> Self {
        Self {
            path: default_legacy_shared_codex_path(),
            enabled_for_read: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq, Default)]
pub struct PathConfig {
    #[serde(default)]
    pub app_data_dir: PathRef,
    #[serde(default)]
    pub result_library_dir: PathRef,
    #[serde(default)]
    pub default_export_dir: ExportDirConfig,
    #[serde(default)]
    pub legacy_shared_codex_dir: LegacyPathConfig,
}
