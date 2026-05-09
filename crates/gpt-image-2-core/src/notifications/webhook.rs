use std::collections::BTreeMap;
use std::net::{IpAddr, Ipv4Addr};
use std::time::Duration;

use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde_json::json;

use crate::{AppError, resolve_credential};

use super::job::NotificationJob;
use super::payload::notification_payload;
use super::types::{NotificationDelivery, WebhookNotificationConfig, WebhookRequest};

pub fn build_webhook_request(
    webhook: &WebhookNotificationConfig,
    job: &NotificationJob,
) -> Result<WebhookRequest, AppError> {
    let url = webhook.url.trim();
    if url.is_empty() {
        return Err(AppError::new(
            "notification_webhook_invalid",
            "Webhook URL is required.",
        ));
    }
    let mut headers = BTreeMap::new();
    for (name, credential) in &webhook.headers {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            continue;
        }
        let (value, _) = resolve_credential(credential)?;
        if !value.trim().is_empty() {
            headers.insert(trimmed.to_string(), value);
        }
    }
    Ok(WebhookRequest {
        method: webhook.method.trim().to_ascii_uppercase(),
        url: url.to_string(),
        headers,
        body: notification_payload(job),
        timeout_seconds: webhook.timeout_seconds.max(1),
    })
}

// Webhook URLs are user-supplied and the server can reach internal networks
// (loopback, RFC1918, link-local, cloud metadata at 169.254.169.254). Without
// a check, a misconfigured or hostile webhook would let the server speak to
// services it should not (SSRF). This validates scheme + DNS-resolved IPs.
//
// This is best-effort: a perfect defense would replace reqwest's connector to
// avoid DNS rebinding races. That's larger than this PR -- this still blocks
// the realistic configuration mistakes and obvious abuse.
fn validate_webhook_target(url_str: &str) -> Result<(), AppError> {
    let url = reqwest::Url::parse(url_str).map_err(|err| {
        AppError::new("notification_webhook_invalid", "Webhook URL is invalid.")
            .with_detail(json!({"url": url_str, "error": err.to_string()}))
    })?;
    match url.scheme() {
        "http" | "https" => {}
        scheme => {
            return Err(AppError::new(
                "notification_webhook_invalid",
                "Webhook URL must use http or https.",
            )
            .with_detail(json!({"scheme": scheme})));
        }
    }
    let host_label = url
        .host_str()
        .ok_or_else(|| {
            AppError::new(
                "notification_webhook_invalid",
                "Webhook URL is missing a host.",
            )
            .with_detail(json!({"url": url_str}))
        })?
        .to_string();
    // Url::socket_addrs handles IPv6 literals (`[::1]` strips brackets) and
    // resolves DNS names -- both of which `(host_str, port).to_socket_addrs()`
    // would mishandle.
    let addrs = url.socket_addrs(|| None).map_err(|err| {
        AppError::new(
            "notification_webhook_failed",
            "Unable to resolve webhook host.",
        )
        .with_detail(json!({"host": host_label, "error": err.to_string()}))
    })?;
    if addrs.is_empty() {
        return Err(AppError::new(
            "notification_webhook_failed",
            "Webhook host did not resolve to any address.",
        )
        .with_detail(json!({"host": host_label})));
    }
    for addr in &addrs {
        let ip = canonicalize_webhook_ip(addr.ip());
        if webhook_ip_is_internal(ip) {
            return Err(AppError::new(
                "notification_webhook_blocked",
                "Webhook target resolves to a non-routable address (loopback, private, link-local, or unspecified). Refusing to send.",
            )
            .with_detail(json!({
                "host": host_label,
                "address": ip.to_string(),
            })));
        }
    }
    Ok(())
}

fn canonicalize_webhook_ip(ip: IpAddr) -> IpAddr {
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

fn webhook_ip_is_internal(ip: IpAddr) -> bool {
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

pub(crate) fn send_webhook_notification(
    webhook: &WebhookNotificationConfig,
    job: &NotificationJob,
) -> NotificationDelivery {
    let name = if webhook.name.trim().is_empty() {
        webhook.id.clone()
    } else {
        webhook.name.clone()
    };
    let request = match build_webhook_request(webhook, job) {
        Ok(request) => request,
        Err(error) => {
            return NotificationDelivery {
                channel: "webhook".to_string(),
                name,
                ok: false,
                message: error.message,
            };
        }
    };
    match execute_webhook_request(&request) {
        Ok(message) => NotificationDelivery {
            channel: "webhook".to_string(),
            name,
            ok: true,
            message,
        },
        Err(error) => NotificationDelivery {
            channel: "webhook".to_string(),
            name,
            ok: false,
            message: error.message,
        },
    }
}

fn execute_webhook_request(request: &WebhookRequest) -> Result<String, AppError> {
    validate_webhook_target(&request.url)?;
    let client = Client::builder()
        .timeout(Duration::from_secs(request.timeout_seconds.max(1)))
        .build()
        .map_err(|error| {
            AppError::new(
                "notification_webhook_failed",
                "Unable to create webhook client.",
            )
            .with_detail(json!({"error": error.to_string()}))
        })?;
    let method = reqwest::Method::from_bytes(request.method.as_bytes()).map_err(|error| {
        AppError::new("notification_webhook_invalid", "Webhook method is invalid.")
            .with_detail(json!({"method": request.method, "error": error.to_string()}))
    })?;
    let mut headers = HeaderMap::new();
    for (name, value) in &request.headers {
        let header_name = HeaderName::from_bytes(name.as_bytes()).map_err(|error| {
            AppError::new(
                "notification_webhook_invalid",
                "Webhook header name is invalid.",
            )
            .with_detail(json!({"header": name, "error": error.to_string()}))
        })?;
        let header_value = HeaderValue::from_str(value).map_err(|error| {
            AppError::new(
                "notification_webhook_invalid",
                "Webhook header value is invalid.",
            )
            .with_detail(json!({"header": name, "error": error.to_string()}))
        })?;
        headers.insert(header_name, header_value);
    }
    let response = client
        .request(method, &request.url)
        .headers(headers)
        .json(&request.body)
        .send()
        .map_err(|error| {
            AppError::new("notification_webhook_failed", "Webhook request failed.")
                .with_detail(json!({"error": error.to_string()}))
        })?;
    let status = response.status();
    if status.is_success() {
        Ok(format!("Webhook delivered with HTTP {status}."))
    } else {
        Err(AppError::new(
            "notification_webhook_failed",
            format!("Webhook returned HTTP {status}."),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::validate_webhook_target;

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
    fn webhook_ssrf_guard_keeps_notification_owned_invalid_url_detail() {
        let url = format!("not a url {}", "x".repeat(300));
        let err = validate_webhook_target(&url)
            .err()
            .expect("malformed url should be rejected");
        assert_eq!(err.code, "notification_webhook_invalid");
        assert_eq!(err.detail.unwrap()["url"], url);
    }
}
