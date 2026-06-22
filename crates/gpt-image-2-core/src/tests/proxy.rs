use super::*;

fn custom(url: &str) -> ProxyConfig {
    ProxyConfig {
        mode: ProxyMode::Custom,
        url: Some(url.to_string()),
        no_proxy: Vec::new(),
    }
}

#[test]
fn validate_proxy_url_accepts_supported_schemes() {
    for url in [
        "http://proxy.local:8080",
        "https://proxy.local:8443",
        "socks5://proxy.local:1080",
        "socks5h://proxy.local:1080",
        "socks5h://user:pass@proxy.local:1080",
    ] {
        assert!(validate_proxy_url(url).is_ok(), "should accept {url}");
    }
}

#[test]
fn validate_proxy_url_rejects_unsupported_schemes() {
    for url in [
        "socks4://proxy.local:1080",
        "socks4a://proxy.local:1080",
        "ftp://proxy.local:21",
        "ws://proxy.local:80",
    ] {
        let error = validate_proxy_url(url).unwrap_err();
        assert_eq!(error.code, "proxy_url_invalid", "should reject {url}");
    }
}

#[test]
fn validate_proxy_url_rejects_incomplete_credentials() {
    // username only, and empty password are both ambiguous -> rejected.
    for url in [
        "socks5h://user@proxy.local:1080",
        "http://user@proxy.local:8080",
        "http://user:@proxy.local:8080",
    ] {
        let error = validate_proxy_url(url).unwrap_err();
        assert_eq!(error.code, "proxy_url_invalid", "should reject {url}");
    }
}

#[test]
fn validate_proxy_url_rejects_malformed() {
    assert_eq!(
        validate_proxy_url("not a url").unwrap_err().code,
        "proxy_url_invalid"
    );
    assert_eq!(
        validate_proxy_url("http://").unwrap_err().code,
        "proxy_url_invalid"
    );
}

#[test]
fn resolve_effective_proxy_prefers_provider_override() {
    let global = custom("http://global.local:8080");
    let direct = ProxyConfig {
        mode: ProxyMode::None,
        ..ProxyConfig::default()
    };
    let provider = ProviderConfig {
        provider_type: "openai".to_string(),
        proxy: Some(direct.clone()),
        ..ProviderConfig::default()
    };
    // Provider override wins.
    assert_eq!(
        resolve_effective_proxy(&global, Some(&provider)),
        direct
    );
    // No override inherits the global proxy.
    let inherit = ProviderConfig {
        provider_type: "openai".to_string(),
        proxy: None,
        ..ProviderConfig::default()
    };
    assert_eq!(resolve_effective_proxy(&global, Some(&inherit)), global);
    // Builtin/auto provider (no config entry) inherits the global proxy.
    assert_eq!(resolve_effective_proxy(&global, None), global);
}

#[test]
fn redact_proxy_url_strips_credentials() {
    assert_eq!(
        redact_proxy_url("socks5h://user:secret@proxy.local:1080"),
        "socks5h://proxy.local:1080"
    );
    // No credentials -> unchanged host/port.
    assert!(redact_proxy_url("http://proxy.local:8080").contains("proxy.local:8080"));
    assert!(!redact_proxy_url("http://user:secret@proxy.local:8080").contains("secret"));
}

#[test]
fn redact_proxy_config_hides_password() {
    let value = redact_proxy_config(&custom("socks5h://user:secret@proxy.local:1080"));
    assert_eq!(value["mode"], "custom");
    let serialized = value.to_string();
    assert!(!serialized.contains("secret"), "password must be redacted");
}

#[test]
fn preserve_proxy_secrets_restores_redacted_credentials() {
    let existing = custom("socks5h://user:secret@proxy.local:1080");

    // Redacted round-trip (same target, no creds) -> credentials restored.
    let mut redacted = custom("socks5h://proxy.local:1080");
    preserve_proxy_secrets(&mut redacted, &existing);
    assert_eq!(redacted.url.as_deref(), Some("socks5h://user:secret@proxy.local:1080"));

    // User supplied fresh credentials -> left untouched.
    let mut fresh = custom("socks5h://newuser:newpass@proxy.local:1080");
    preserve_proxy_secrets(&mut fresh, &existing);
    assert_eq!(fresh.url.as_deref(), Some("socks5h://newuser:newpass@proxy.local:1080"));

    // Different host -> do NOT leak credentials across targets.
    let mut other_host = custom("socks5h://other.local:1080");
    preserve_proxy_secrets(&mut other_host, &existing);
    assert_eq!(other_host.url.as_deref(), Some("socks5h://other.local:1080"));

    // Switching to direct (None) -> untouched.
    let mut direct = ProxyConfig {
        mode: ProxyMode::None,
        ..ProxyConfig::default()
    };
    preserve_proxy_secrets(&mut direct, &existing);
    assert_eq!(direct.mode, ProxyMode::None);
    assert!(direct.url.is_none());
}

#[test]
fn make_client_builds_for_every_mode() {
    // System and None never fail to build.
    assert!(make_client(30, &ProxyConfig::default()).is_ok());
    assert!(
        make_client(
            30,
            &ProxyConfig {
                mode: ProxyMode::None,
                ..ProxyConfig::default()
            }
        )
        .is_ok()
    );
    // A valid SOCKS5h custom proxy builds (no connection attempted here).
    assert!(make_client(30, &custom("socks5h://proxy.local:1080")).is_ok());
    // An invalid custom proxy fails with a structured error, not a panic.
    let error = make_client(30, &custom("socks4://proxy.local:1080")).unwrap_err();
    assert_eq!(error.code, "proxy_url_invalid");
}
