#![allow(unused_imports)]

use super::*;

pub(crate) type ApiResult<T = Value> = Result<Json<T>, ApiError>;

#[derive(Debug)]
pub(crate) struct ApiError {
    pub(crate) status: StatusCode,
    pub(crate) code: Option<String>,
    pub(crate) message: String,
    pub(crate) detail: Option<Value>,
}

impl ApiError {
    pub(crate) fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            code: None,
            message: message.into(),
            detail: None,
        }
    }

    pub(crate) fn internal(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code: None,
            message: message.into(),
            detail: None,
        }
    }

    pub(crate) fn not_found(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            code: None,
            message: message.into(),
            detail: None,
        }
    }

    pub(crate) fn forbidden(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            code: None,
            message: message.into(),
            detail: None,
        }
    }

    /// Attach a structured `detail` (and optional `code`) lifted from a
    /// JobError-shaped value, so the HTTP `error` envelope can carry the real
    /// cause through to the front-end instead of just a flat message.
    #[allow(dead_code)]
    pub(crate) fn with_error_value(mut self, error: &Value) -> Self {
        if let Some(code) = error.get("code").and_then(Value::as_str) {
            self.code = Some(code.to_string());
        }
        if let Some(detail) = error.get("detail") {
            self.detail = Some(detail.clone());
        }
        self
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut error = json!({ "message": self.message });
        if let (Value::Object(map), Some(code)) = (&mut error, self.code.as_ref()) {
            map.insert("code".to_string(), json!(code));
        }
        if let (Value::Object(map), Some(detail)) = (&mut error, self.detail) {
            map.insert("detail".to_string(), detail);
        }
        (self.status, Json(json!({ "error": error }))).into_response()
    }
}
