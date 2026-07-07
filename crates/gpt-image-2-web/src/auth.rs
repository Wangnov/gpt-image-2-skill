#![allow(unused_imports)]

use super::*;
use axum::extract::Request;
use axum::middleware::Next;

pub(crate) const SESSION_COOKIE: &str = "gpt2_session";
const TOKEN_ENV: &str = "GPT_IMAGE_2_WEB_TOKEN";
const ALLOWED_HOSTS_ENV: &str = "GPT_IMAGE_2_WEB_ALLOWED_HOSTS";
const ALLOW_UNAUTH_ENV: &str = "GPT_IMAGE_2_WEB_ALLOW_UNAUTHENTICATED";

fn env_flag(name: &str) -> bool {
    env::var(name)
        .map(|value| matches!(value.trim(), "1" | "true" | "yes"))
        .unwrap_or(false)
}

/// Resolved auth policy for the server, decided once at startup.
#[derive(Clone, Debug)]
pub(crate) struct AuthPolicy {
    /// The shared secret from `GPT_IMAGE_2_WEB_TOKEN`, if configured.
    token: Option<String>,
    /// Host names allowed when running token-less (anti-DNS-rebinding).
    allowed_hosts: Vec<String>,
}

impl Default for AuthPolicy {
    /// Token-less, loopback-host-only — the safe default used by tests and the
    /// Tauri build (which never serves over HTTP).
    fn default() -> Self {
        Self {
            token: None,
            allowed_hosts: vec![
                "localhost".to_string(),
                "127.0.0.1".to_string(),
                "::1".to_string(),
            ],
        }
    }
}

impl AuthPolicy {
    pub(crate) fn from_env(bind_host: &str) -> Result<Self, String> {
        let token = env::var(TOKEN_ENV)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());

        // Refuse to expose the API beyond loopback without a token. Otherwise a
        // Docker/LAN deployment would serve config — including the plaintext
        // credential-reveal endpoint — to anyone who can reach the port. The
        // server can't see how Docker published the port, so it keys off the
        // bind host and errs safe; operators who front it with their own
        // network isolation / proxy auth can opt out explicitly.
        if token.is_none() && !host_is_loopback(bind_host) {
            if env_flag(ALLOW_UNAUTH_ENV) {
                eprintln!(
                    "gpt-image-2-web: WARNING — bound {bind_host} without {TOKEN_ENV} and \
                     {ALLOW_UNAUTH_ENV}=1. The API and credential reveal are unauthenticated; \
                     rely on your network isolation."
                );
            } else {
                return Err(format!(
                    "Refusing to bind {bind_host} without {TOKEN_ENV}: the API (including \
                     credential reveal) would be reachable unauthenticated. Set {TOKEN_ENV} to a \
                     secret to expose beyond localhost, bind 127.0.0.1, or set \
                     {ALLOW_UNAUTH_ENV}=1 if the network is already trusted."
                ));
            }
        }

        let mut allowed_hosts = env::var(ALLOWED_HOSTS_ENV)
            .ok()
            .map(|value| {
                value
                    .split(',')
                    .map(|item| item.trim().to_ascii_lowercase())
                    .filter(|item| !item.is_empty())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        if allowed_hosts.is_empty() {
            allowed_hosts = vec![
                "localhost".to_string(),
                "127.0.0.1".to_string(),
                "::1".to_string(),
            ];
        }

        Ok(Self {
            token,
            allowed_hosts,
        })
    }

    pub(crate) fn requires_token(&self) -> bool {
        self.token.is_some()
    }
}

fn host_is_loopback(host: &str) -> bool {
    let host = host.trim();
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    // "0.0.0.0" / "::" parse as unspecified (all interfaces) — is_loopback()
    // is false for them, which is exactly what we want to reject.
    host.parse::<std::net::IpAddr>()
        .map(|ip| ip.is_loopback())
        .unwrap_or(false)
}

/// Strip the optional `:port` and surrounding brackets from a Host header and
/// lowercase it for comparison.
fn host_header_name(raw: &str) -> String {
    let raw = raw.trim();
    let without_port = if raw.starts_with('[') {
        // IPv6 literal: [::1]:8787 -> ::1
        raw.split(']')
            .next()
            .map(|s| s.trim_start_matches('['))
            .unwrap_or(raw)
    } else {
        raw.rsplit_once(':').map(|(host, _)| host).unwrap_or(raw)
    };
    without_port.to_ascii_lowercase()
}

/// Constant-time string comparison so a wrong token can't be recovered by
/// timing the failure.
fn constant_time_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

fn presented_token(request: &Request) -> Option<String> {
    if let Some(value) = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        && let Some(token) = value.strip_prefix("Bearer ")
    {
        return Some(token.trim().to_string());
    }
    request
        .headers()
        .get(header::COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|cookies| {
            cookies.split(';').find_map(|pair| {
                let (name, value) = pair.split_once('=')?;
                if name.trim() == SESSION_COOKIE {
                    Some(value.trim().to_string())
                } else {
                    None
                }
            })
        })
}

/// Axum middleware guarding `/api`. With a token configured, every request must
/// present it (Bearer header or session cookie). Without a token, the server is
/// loopback-bound (enforced at startup), and we additionally reject Host headers
/// that aren't loopback names to blunt DNS-rebinding from a browser.
pub(crate) async fn require_auth(
    State(state): State<JobQueueState>,
    request: Request,
    next: Next,
) -> Response {
    let policy = &state.auth;
    // The login route must stay reachable without an existing session.
    if request.uri().path() == "/session" {
        return next.run(request).await;
    }

    match &policy.token {
        Some(expected) => match presented_token(&request) {
            Some(token) if constant_time_eq(&token, expected) => next.run(request).await,
            _ => unauthorized("Missing or invalid access token."),
        },
        None => {
            let host_ok = request
                .headers()
                .get(header::HOST)
                .and_then(|value| value.to_str().ok())
                .map(|raw| policy.allowed_hosts.contains(&host_header_name(raw)))
                // A missing Host header can't be a rebinding attack via DNS name.
                .unwrap_or(true);
            if host_ok {
                next.run(request).await
            } else {
                forbidden("Host not allowed for token-less access.")
            }
        }
    }
}

/// `POST /api/session` — exchange the shared token for an HttpOnly session
/// cookie so image `<img>` requests (which can't carry an Authorization header)
/// authenticate too.
pub(crate) async fn create_session(
    State(state): State<JobQueueState>,
    Json(body): Json<SessionRequest>,
) -> Response {
    let Some(expected) = &state.auth.token else {
        // No token configured — nothing to log in to.
        return (StatusCode::NO_CONTENT, ()).into_response();
    };
    if constant_time_eq(body.token.trim(), expected) {
        let cookie = format!(
            "{SESSION_COOKIE}={}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1209600",
            expected
        );
        (StatusCode::NO_CONTENT, [(header::SET_COOKIE, cookie)]).into_response()
    } else {
        unauthorized("Invalid access token.")
    }
}

/// `GET /api/session` — report whether auth is required (so the UI can decide
/// to show a token gate) and whether the current request is already authorized.
pub(crate) async fn session_status(
    State(state): State<JobQueueState>,
    request: Request,
) -> Json<Value> {
    let required = state.auth.requires_token();
    let authorized = match &state.auth.token {
        Some(expected) => presented_token(&request)
            .map(|token| constant_time_eq(&token, expected))
            .unwrap_or(false),
        None => true,
    };
    Json(json!({ "auth_required": required, "authorized": authorized }))
}

#[derive(Deserialize)]
pub(crate) struct SessionRequest {
    #[serde(default)]
    pub(crate) token: String,
}

fn unauthorized(message: &str) -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({ "error": { "message": message } })),
    )
        .into_response()
}

fn forbidden(message: &str) -> Response {
    (
        StatusCode::FORBIDDEN,
        Json(json!({ "error": { "message": message } })),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_hosts_are_recognized() {
        for host in ["localhost", "LOCALHOST", "127.0.0.1", "127.0.0.5", "::1"] {
            assert!(host_is_loopback(host), "{host} should be loopback");
        }
        for host in ["0.0.0.0", "::", "192.168.1.10", "example.com"] {
            assert!(!host_is_loopback(host), "{host} should not be loopback");
        }
    }

    #[test]
    fn host_header_name_strips_port_and_brackets() {
        assert_eq!(host_header_name("localhost:8787"), "localhost");
        assert_eq!(host_header_name("127.0.0.1:8787"), "127.0.0.1");
        assert_eq!(host_header_name("[::1]:8787"), "::1");
        assert_eq!(host_header_name("EXAMPLE.com"), "example.com");
    }

    #[test]
    fn constant_time_eq_matches_only_identical_strings() {
        assert!(constant_time_eq("secret", "secret"));
        assert!(!constant_time_eq("secret", "Secret"));
        assert!(!constant_time_eq("secret", "secret-longer"));
        assert!(!constant_time_eq("", "x"));
        assert!(constant_time_eq("", ""));
    }
}
