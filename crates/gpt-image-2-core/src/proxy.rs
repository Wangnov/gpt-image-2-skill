#![allow(unused_imports)]

use super::*;

/// Stable string form of a [`ProxyMode`] for JSON payloads.
pub(crate) fn proxy_mode_str(mode: ProxyMode) -> &'static str {
    match mode {
        ProxyMode::System => "system",
        ProxyMode::None => "none",
        ProxyMode::Custom => "custom",
    }
}

/// Validate a Custom-mode proxy URL.
///
/// Accepts only `http`/`https`/`socks5`/`socks5h`. `socks4`/`socks4a` and any
/// other scheme are rejected (we focus on SOCKS5 this round). Credentials must
/// be either absent or a complete, non-empty `user:pass` pair — a username with
/// no password silently becomes an empty-password auth attempt in the
/// underlying client, so we reject it up front rather than depend on library
/// behavior.
pub(crate) fn validate_proxy_url(url_str: &str) -> Result<(), AppError> {
    let url = Url::parse(url_str).map_err(|error| {
        AppError::new("proxy_url_invalid", "Proxy URL is not a valid URL.").with_detail(
            json!({ "error": error.to_string(), "url": redact_proxy_url(url_str) }),
        )
    })?;
    match url.scheme() {
        "http" | "https" | "socks5" | "socks5h" => {}
        other => {
            return Err(AppError::new(
                "proxy_url_invalid",
                format!(
                    "Unsupported proxy scheme: {other}. Use http, https, socks5, or socks5h."
                ),
            )
            .with_detail(json!({
                "scheme": other,
                "allowed": ["http", "https", "socks5", "socks5h"],
            })));
        }
    }
    if url.host_str().map(str::is_empty).unwrap_or(true) {
        return Err(
            AppError::new("proxy_url_invalid", "Proxy URL is missing a host.")
                .with_detail(json!({ "url": redact_proxy_url(url_str) })),
        );
    }
    let has_username = !url.username().is_empty();
    let has_password = url.password().map(|pass| !pass.is_empty()).unwrap_or(false);
    if has_username != has_password {
        return Err(AppError::new(
            "proxy_url_invalid",
            "Proxy URL credentials must include both a username and a non-empty password.",
        )
        .with_detail(json!({ "url": redact_proxy_url(url_str) })));
    }
    Ok(())
}

/// Resolve the effective proxy for a provider: a per-provider override wins,
/// otherwise the global proxy applies.
pub(crate) fn resolve_effective_proxy(
    global: &ProxyConfig,
    provider: Option<&ProviderConfig>,
) -> ProxyConfig {
    provider
        .and_then(|provider| provider.proxy.clone())
        .unwrap_or_else(|| global.clone())
}

/// Load config and resolve the effective proxy for `provider_name`, validating
/// a Custom URL eagerly so a bad proxy fails fast with `proxy_url_invalid`.
pub(crate) fn effective_proxy_for(
    cli: &Cli,
    provider_name: &str,
) -> Result<ProxyConfig, AppError> {
    let config = load_app_config(&cli_config_path(cli))?;
    let resolved = resolve_effective_proxy(&config.proxy, config.providers.get(provider_name));
    validate_proxy_config(&resolved)?;
    Ok(resolved)
}

/// Validate a [`ProxyConfig`] (only Custom mode has anything to check).
pub fn validate_proxy_config(proxy: &ProxyConfig) -> Result<(), AppError> {
    if proxy.mode == ProxyMode::Custom {
        let url = custom_proxy_url(proxy)?;
        validate_proxy_url(url)?;
    }
    Ok(())
}

fn custom_proxy_url(proxy: &ProxyConfig) -> Result<&str, AppError> {
    proxy
        .url
        .as_deref()
        .map(str::trim)
        .filter(|url| !url.is_empty())
        .ok_or_else(|| {
            AppError::new(
                "proxy_url_invalid",
                "Custom proxy mode requires a proxy URL.",
            )
        })
}

/// Apply a [`ProxyConfig`] to a blocking client builder.
///
/// - `System`: leave the builder untouched so reqwest reads the environment.
/// - `None`: disable all proxying (overrides any environment proxy).
/// - `Custom`: route through the configured URL, applying `no_proxy` as a
///   bypass list. SOCKS auth is taken from the URL's inline `user:pass`; never
///   use `custom_http_auth()`/`headers()` for SOCKS (HTTP-only, ignored there).
pub(crate) fn apply_proxy(
    builder: reqwest::blocking::ClientBuilder,
    proxy: &ProxyConfig,
) -> Result<reqwest::blocking::ClientBuilder, AppError> {
    match proxy.mode {
        ProxyMode::System => Ok(builder),
        ProxyMode::None => Ok(builder.no_proxy()),
        ProxyMode::Custom => {
            let url = custom_proxy_url(proxy)?;
            validate_proxy_url(url)?;
            let mut reqwest_proxy = reqwest::Proxy::all(url).map_err(|error| {
                AppError::new("proxy_url_invalid", "Invalid proxy URL.").with_detail(
                    json!({ "error": error.to_string(), "url": redact_proxy_url(url) }),
                )
            })?;
            if !proxy.no_proxy.is_empty()
                && let Some(no_proxy) = reqwest::NoProxy::from_string(&proxy.no_proxy.join(","))
            {
                reqwest_proxy = reqwest_proxy.no_proxy(Some(no_proxy));
            }
            Ok(builder.proxy(reqwest_proxy))
        }
    }
}

/// Strip any inline credentials from a proxy URL for display/logging.
pub(crate) fn redact_proxy_url(url_str: &str) -> String {
    match Url::parse(url_str) {
        Ok(mut url) => {
            if !url.username().is_empty() || url.password().is_some() {
                let _ = url.set_username("");
                let _ = url.set_password(None);
            }
            url.to_string()
        }
        Err(_) => "<invalid-proxy-url>".to_string(),
    }
}

/// Redacted JSON form of a [`ProxyConfig`] (credentials stripped from `url`).
pub(crate) fn redact_proxy_config(proxy: &ProxyConfig) -> Value {
    json!({
        "mode": proxy_mode_str(proxy.mode),
        "url": proxy.url.as_deref().map(redact_proxy_url),
        "no_proxy": proxy.no_proxy,
    })
}
