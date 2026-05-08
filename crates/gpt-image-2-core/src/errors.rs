#![allow(unused_imports)]

use super::*;

#[derive(Debug, Clone)]
pub struct AppError {
    pub code: String,
    pub message: String,
    pub detail: Option<Value>,
    pub exit_status: i32,
    pub status_code: Option<u16>,
}

impl AppError {
    pub(crate) fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            detail: None,
            exit_status: 1,
            status_code: None,
        }
    }

    pub(crate) fn with_detail(mut self, detail: Value) -> Self {
        self.detail = Some(detail);
        self
    }

    pub(crate) fn with_exit_status(mut self, exit_status: i32) -> Self {
        self.exit_status = exit_status;
        self
    }

    pub(crate) fn with_status_code(mut self, status_code: u16) -> Self {
        self.status_code = Some(status_code);
        self
    }
}

#[derive(Debug, Serialize)]
pub struct CommandOutcome {
    pub payload: Value,
    pub exit_status: i32,
}
