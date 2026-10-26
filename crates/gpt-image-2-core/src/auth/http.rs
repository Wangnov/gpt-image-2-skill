#![allow(unused_imports)]

use super::*;

pub(crate) fn http_client_builder() -> reqwest::blocking::ClientBuilder {
    // reqwest 0.13 需要显式选择加密实现。保留 ring，避免 CLI 的
    // musl 安装包额外引入 aws-lc 的原生构建依赖，并尊重宿主已配置的实现。
    static TLS_PROVIDER_INIT: std::sync::Once = std::sync::Once::new();
    TLS_PROVIDER_INIT.call_once(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
    Client::builder()
}

pub(crate) fn make_client(timeout_seconds: u64, proxy: &ProxyConfig) -> Result<Client, AppError> {
    let builder = http_client_builder()
        .timeout(Duration::from_secs(timeout_seconds))
        .user_agent(build_user_agent());
    apply_proxy(builder, proxy)?.build().map_err(|error| {
        AppError::new("http_client_error", "Unable to build HTTP client.")
            .with_detail(json!({ "error": error.to_string() }))
    })
}

pub(crate) fn http_status_error(status: StatusCode, detail: String) -> AppError {
    AppError::new("http_error", format!("HTTP {}", status.as_u16()))
        .with_detail(json!(detail))
        .with_status_code(status.as_u16())
}
