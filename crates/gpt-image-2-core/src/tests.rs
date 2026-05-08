use super::*;
use std::sync::Mutex;

static CODEX_HOME_TEST_LOCK: Mutex<()> = Mutex::new(());

struct TestCodexHome {
    previous: Option<std::ffi::OsString>,
}

impl TestCodexHome {
    fn set(path: &Path) -> Self {
        let previous = std::env::var_os("CODEX_HOME");
        unsafe {
            std::env::set_var("CODEX_HOME", path);
        }
        Self { previous }
    }
}

impl Drop for TestCodexHome {
    fn drop(&mut self) {
        unsafe {
            if let Some(previous) = &self.previous {
                std::env::set_var("CODEX_HOME", previous);
            } else {
                std::env::remove_var("CODEX_HOME");
            }
        }
    }
}

mod config_provider;
mod history_storage;
mod image_requests;
mod network_safety;
mod notification_delivery;
mod notifications;
mod storage_config;
