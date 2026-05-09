#![allow(unused_imports)]

use super::*;

pub(crate) fn validate_remote_http_target(
    url_str: &str,
    target_label: &str,
) -> Result<(Url, String, Vec<SocketAddr>), AppError> {
    let url = Url::parse(url_str).map_err(|err| {
        AppError::new(
            "storage_remote_url_invalid",
            format!("{target_label} URL is invalid."),
        )
        .with_detail(json!({"url": redact_url_for_log(url_str), "error": err.to_string()}))
    })?;
    match url.scheme() {
        "http" | "https" => {}
        scheme => {
            return Err(AppError::new(
                "storage_remote_url_invalid",
                format!("{target_label} URL must use http or https."),
            )
            .with_detail(json!({"scheme": scheme})));
        }
    }
    let host_label = url
        .host_str()
        .ok_or_else(|| {
            AppError::new(
                "storage_remote_url_invalid",
                format!("{target_label} URL is missing a host."),
            )
            .with_detail(json!({"url": redact_url_for_log(url_str)}))
        })?
        .to_string();
    let addrs = url.socket_addrs(|| None).map_err(|err| {
        AppError::new(
            "storage_remote_resolve_failed",
            format!("Unable to resolve {target_label} host."),
        )
        .with_detail(json!({"host": host_label, "error": err.to_string()}))
    })?;
    validate_remote_addresses(&host_label, addrs.iter().map(|addr| addr.ip()))?;
    Ok((url, host_label, addrs))
}

pub(crate) fn validate_remote_tcp_target(
    host: &str,
    port: u16,
    target_label: &str,
) -> Result<Vec<SocketAddr>, AppError> {
    let host_label = host.trim();
    if host_label.is_empty() {
        return Err(AppError::new(
            "storage_remote_host_invalid",
            format!("{target_label} host is required."),
        ));
    }
    let addrs = (host_label, port).to_socket_addrs().map_err(|err| {
        AppError::new(
            "storage_remote_resolve_failed",
            format!("Unable to resolve {target_label} host."),
        )
        .with_detail(json!({"host": host_label, "port": port, "error": err.to_string()}))
    })?;
    let addrs = addrs.collect::<Vec<_>>();
    validate_remote_addresses(host_label, addrs.iter().map(|addr| addr.ip()))?;
    Ok(addrs)
}

pub(crate) fn validate_remote_addresses<I>(host_label: &str, addrs: I) -> Result<(), AppError>
where
    I: IntoIterator<Item = IpAddr>,
{
    let addrs = addrs.into_iter().collect::<Vec<_>>();
    if addrs.is_empty() {
        return Err(AppError::new(
            "storage_remote_resolve_failed",
            "Storage target host did not resolve to any address.",
        )
        .with_detail(json!({"host": host_label})));
    }
    for ip in addrs {
        let ip = canonicalize_ip(ip);
        if ip_is_internal(ip) {
            return Err(AppError::new(
                "storage_remote_blocked",
                "Storage target resolves to a non-routable address (loopback, private, link-local, or unspecified). Refusing to upload.",
            )
            .with_detail(json!({
                "host": host_label,
                "address": ip.to_string(),
            })));
        }
    }
    Ok(())
}

pub(crate) fn canonicalize_ip(ip: IpAddr) -> IpAddr {
    if let IpAddr::V6(v6) = ip {
        let segs = v6.segments();
        // Unmap ::ffff:0:0/96 into the underlying IPv4 so private/loopback
        // checks below catch it.
        if segs[0] == 0
            && segs[1] == 0
            && segs[2] == 0
            && segs[3] == 0
            && segs[4] == 0
            && segs[5] == 0xffff
        {
            return IpAddr::V4(Ipv4Addr::new(
                (segs[6] >> 8) as u8,
                (segs[6] & 0xff) as u8,
                (segs[7] >> 8) as u8,
                (segs[7] & 0xff) as u8,
            ));
        }
    }
    ip
}

pub(crate) fn ip_is_internal(ip: IpAddr) -> bool {
    if ip.is_loopback() || ip.is_unspecified() || ip.is_multicast() {
        return true;
    }
    match ip {
        IpAddr::V4(v4) => {
            // Covers 10/8, 172.16/12, 192.168/16, 169.254/16 (incl. AWS/GCP
            // metadata at 169.254.169.254), broadcast 255.255.255.255, and
            // the 0.0.0.0/8 "this network" block.
            v4.is_private() || v4.is_link_local() || v4.is_broadcast() || v4.octets()[0] == 0
        }
        IpAddr::V6(v6) => {
            let segs = v6.segments();
            // ULA fc00::/7
            (segs[0] & 0xfe00) == 0xfc00
                // Link-local fe80::/10
                || (segs[0] & 0xffc0) == 0xfe80
        }
    }
}
