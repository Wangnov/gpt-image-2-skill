use super::*;

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
