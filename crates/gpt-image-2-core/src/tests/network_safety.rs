use super::*;

#[test]
fn webhook_ssrf_guard_blocks_internal_addresses() {
    for url in [
        "http://127.0.0.1/hook",
        "http://localhost/hook",
        "http://10.0.0.1/hook",
        "http://172.16.5.5/hook",
        "http://192.168.1.1/hook",
        "http://169.254.169.254/latest/meta-data/", // AWS metadata
        "http://0.0.0.0/hook",
        "http://255.255.255.255/hook",
        "http://[::1]/hook",
        "http://[::ffff:127.0.0.1]/hook",
        "http://[fc00::1]/hook",
        "http://[fe80::1]/hook",
    ] {
        let err = validate_webhook_target(url).err().unwrap_or_else(|| {
            panic!("expected {url} to be rejected as internal");
        });
        assert_eq!(
            err.code, "notification_webhook_blocked",
            "url {url} produced unexpected error code {}",
            err.code
        );
    }
}

#[test]
fn webhook_ssrf_guard_rejects_non_http_schemes() {
    let err = validate_webhook_target("ftp://example.com/hook")
        .err()
        .expect("non-http scheme should be rejected");
    assert_eq!(err.code, "notification_webhook_invalid");
}

#[test]
fn webhook_ssrf_guard_rejects_malformed_urls() {
    let err = validate_webhook_target("not a url")
        .err()
        .expect("malformed url should be rejected");
    assert_eq!(err.code, "notification_webhook_invalid");
}

#[test]
fn ip_is_internal_classifies_addresses() {
    assert!(ip_is_internal("127.0.0.1".parse().unwrap()));
    assert!(ip_is_internal("10.0.0.1".parse().unwrap()));
    assert!(ip_is_internal("172.16.5.5".parse().unwrap()));
    assert!(ip_is_internal("192.168.1.1".parse().unwrap()));
    assert!(ip_is_internal("169.254.169.254".parse().unwrap()));
    assert!(ip_is_internal("0.0.0.0".parse().unwrap()));
    assert!(ip_is_internal("224.0.0.1".parse().unwrap()));
    assert!(ip_is_internal("::1".parse().unwrap()));
    assert!(ip_is_internal("fc00::1".parse().unwrap()));
    assert!(ip_is_internal("fe80::1".parse().unwrap()));

    assert!(!ip_is_internal("8.8.8.8".parse().unwrap()));
    assert!(!ip_is_internal("1.1.1.1".parse().unwrap()));
    assert!(!ip_is_internal("2606:4700:4700::1111".parse().unwrap()));
}

#[test]
fn canonicalize_ip_unmaps_ipv4_in_ipv6() {
    let mapped: IpAddr = "::ffff:127.0.0.1".parse().unwrap();
    match canonicalize_ip(mapped) {
        IpAddr::V4(v4) => assert_eq!(v4, Ipv4Addr::new(127, 0, 0, 1)),
        other => panic!("expected ipv4 unmapping, got {other:?}"),
    }
}
