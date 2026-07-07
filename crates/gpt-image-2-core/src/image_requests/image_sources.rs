#![allow(unused_imports)]

use super::*;

pub(crate) fn decode_base64_bytes(value: &str) -> Result<Vec<u8>, AppError> {
    let encoded = if value.starts_with("data:image/") {
        value
            .split_once(',')
            .ok_or_else(|| {
                AppError::new(
                    "invalid_base64",
                    "Image data URL did not contain a comma separator.",
                )
            })?
            .1
    } else {
        value
    };
    STANDARD.decode(encoded).map_err(|_| {
        AppError::new("invalid_base64", "Image payload was not valid base64.")
            .with_detail(json!({ "length": encoded.len() }))
    })
}

pub(crate) fn detect_mime_type(path: &Path, bytes: &[u8]) -> Result<String, AppError> {
    if let Some(mime) = mime_guess::from_path(path).first_raw()
        && mime.starts_with("image/")
    {
        return Ok(mime.to_string());
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Ok("image/png".to_string());
    }
    if bytes.starts_with(b"\xff\xd8\xff") {
        return Ok("image/jpeg".to_string());
    }
    if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        return Ok("image/webp".to_string());
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Ok("image/gif".to_string());
    }
    if bytes.starts_with(b"BM") {
        return Ok("image/bmp".to_string());
    }
    Err(AppError::new(
        "ref_image_invalid",
        format!(
            "Unsupported image format for reference image: {}",
            path.display()
        ),
    ))
}

pub(crate) fn filename_extension_for_mime_type(mime_type: &str) -> &'static str {
    match mime_type {
        "image/png" => ".png",
        "image/jpeg" => ".jpg",
        "image/webp" => ".webp",
        "image/gif" => ".gif",
        "image/bmp" => ".bmp",
        _ => ".bin",
    }
}

pub(crate) fn detect_extension(bytes: &[u8]) -> &'static str {
    match detect_mime_type(Path::new("file.bin"), bytes).as_deref() {
        Ok("image/png") => ".png",
        Ok("image/jpeg") => ".jpg",
        Ok("image/webp") => ".webp",
        Ok("image/gif") => ".gif",
        Ok("image/bmp") => ".bmp",
        _ => ".bin",
    }
}

pub(crate) fn local_path_to_data_url(path: &Path) -> Result<String, AppError> {
    if !path.is_file() {
        return Err(AppError::new(
            "ref_image_missing",
            format!("Reference image not found: {}", path.display()),
        ));
    }
    let bytes = fs::read(path).map_err(|error| {
        AppError::new("ref_image_invalid", "Unable to read reference image.")
            .with_detail(json!({ "error": error.to_string(), "path": path.display().to_string() }))
    })?;
    let mime_type = detect_mime_type(path, &bytes)?;
    let encoded = STANDARD.encode(bytes);
    Ok(format!("data:{mime_type};base64,{encoded}"))
}

pub(crate) fn resolve_ref_image(value: &str) -> Result<String, AppError> {
    match Url::parse(value) {
        Ok(url) => match url.scheme() {
            "http" | "https" | "data" => Ok(value.to_string()),
            "file" => {
                let path = url
                    .to_file_path()
                    .map_err(|_| AppError::new("ref_image_invalid", "Unsupported file URL."))?;
                local_path_to_data_url(&path)
            }
            _ => local_path_to_data_url(Path::new(value)),
        },
        Err(_) => local_path_to_data_url(Path::new(value)),
    }
}

pub(crate) fn resolve_ref_images(values: &[String]) -> Result<Vec<String>, AppError> {
    values
        .iter()
        .map(|value| resolve_ref_image(value))
        .collect()
}

pub(crate) fn sanitize_file_name(name: &str) -> String {
    let clean: String = name
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric() || ['-', '_', '.'].contains(character)
        })
        .collect();
    if clean.is_empty() {
        "image.bin".to_string()
    } else {
        clean
    }
}

pub(crate) fn parse_data_url_image(value: &str) -> Result<(String, Vec<u8>), AppError> {
    let Some((prefix, encoded)) = value.split_once(',') else {
        return Err(AppError::new(
            "invalid_data_url",
            "Image data URL must contain a base64 payload.",
        ));
    };
    if !prefix.contains(";base64") {
        return Err(AppError::new(
            "invalid_data_url",
            "Image data URL must contain a base64 payload.",
        ));
    }
    let mime_type = prefix
        .trim_start_matches("data:")
        .split(';')
        .next()
        .unwrap_or("application/octet-stream")
        .to_string();
    Ok((mime_type, decode_base64_bytes(encoded)?))
}

/// Reference images fetched from a URL are capped so a hostile or accidental
/// giant response can't exhaust memory. 64MB comfortably covers any real image.
const MAX_REMOTE_IMAGE_BYTES: u64 = 64 * 1024 * 1024;

pub(crate) fn download_bytes(url: &str, proxy: &ProxyConfig) -> Result<Vec<u8>, AppError> {
    use std::io::Read;

    // Redact query strings from anything we log — reference URLs can carry
    // signed tokens.
    let redacted = redact_url_for_log(url);
    // SSRF guard, applied unconditionally: reject URLs whose host resolves to
    // loopback/link-local/private ranges (e.g. the cloud metadata service).
    // We can't exempt the custom-proxy case — a `no_proxy` match still makes
    // reqwest connect directly — so we always validate and pin.
    let (_, host_label, addrs) = validate_remote_http_target(url, "Reference image")?;
    // Pin the initial host to the addresses we just validated (blocks a rebind
    // between validation and connect) and re-validate every redirect hop, so a
    // 302-to-internal can't smuggle us onto a blocked target either. Legitimate
    // CDN redirects to other public hosts still work. Proxy is honored for
    // egress.
    let redirect_policy = reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= 10 {
            return attempt.error(std::io::Error::other("too many redirects"));
        }
        match validate_remote_http_target(attempt.url().as_str(), "Reference image redirect") {
            Ok(_) => attempt.follow(),
            Err(_) => attempt.stop(),
        }
    });
    let builder = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(DEFAULT_REQUEST_TIMEOUT))
        .redirect(redirect_policy)
        .resolve_to_addrs(&host_label, &addrs)
        .user_agent(build_user_agent());
    let client = apply_proxy(builder, proxy)?.build().map_err(|error| {
        AppError::new("network_error", "Unable to build download client.")
            .with_detail(json!({ "error": error.to_string() }))
    })?;
    let response = client.get(url).send().map_err(|error| {
        AppError::new("network_error", "Unable to download image bytes.")
            .with_detail(json!({ "error": error.to_string(), "url": redacted }))
    })?;
    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().unwrap_or_else(|_| String::new());
        return Err(http_status_error(status, detail));
    }
    // Stream with a hard cap: reading `MAX + 1` bytes lets us detect an
    // over-limit body (including chunked / Content-Length-less responses)
    // without ever buffering the whole thing.
    let mut buf = Vec::new();
    let mut limited = response.take(MAX_REMOTE_IMAGE_BYTES + 1);
    limited.read_to_end(&mut buf).map_err(|error| {
        AppError::new("network_error", "Unable to read downloaded image bytes.")
            .with_detail(json!({ "error": error.to_string(), "url": redacted }))
    })?;
    if buf.len() as u64 > MAX_REMOTE_IMAGE_BYTES {
        return Err(
            AppError::new("network_error", "Downloaded image is too large.").with_detail(json!({
                "url": redacted,
                "max_bytes": MAX_REMOTE_IMAGE_BYTES,
            })),
        );
    }
    Ok(buf)
}

pub(crate) fn load_image_source_bytes(
    source: &str,
    fallback_name: &str,
    proxy: &ProxyConfig,
) -> Result<(String, Vec<u8>, String), AppError> {
    if source.starts_with("data:image/") {
        let (mime_type, bytes) = parse_data_url_image(source)?;
        let file_name = format!(
            "{fallback_name}{}",
            filename_extension_for_mime_type(&mime_type)
        );
        return Ok((mime_type, bytes, sanitize_file_name(&file_name)));
    }
    if let Ok(url) = Url::parse(source) {
        match url.scheme() {
            "http" | "https" => {
                let bytes = download_bytes(source, proxy)?;
                let guessed_name = Path::new(url.path())
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or(fallback_name);
                let mime_type = detect_mime_type(Path::new(guessed_name), &bytes)?;
                let file_name = format!(
                    "{}{}",
                    Path::new(guessed_name)
                        .file_stem()
                        .and_then(|stem| stem.to_str())
                        .unwrap_or(fallback_name),
                    filename_extension_for_mime_type(&mime_type)
                );
                return Ok((mime_type, bytes, sanitize_file_name(&file_name)));
            }
            "file" => {
                let path = url
                    .to_file_path()
                    .map_err(|_| AppError::new("ref_image_invalid", "Unsupported file URL."))?;
                let bytes = fs::read(&path).map_err(|error| {
                    AppError::new("ref_image_invalid", "Unable to read local file URL image.")
                        .with_detail(json!({ "error": error.to_string(), "path": path.display().to_string() }))
                })?;
                let mime_type = detect_mime_type(&path, &bytes)?;
                let file_name = path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(sanitize_file_name)
                    .unwrap_or_else(|| "image.bin".to_string());
                return Ok((mime_type, bytes, file_name));
            }
            _ => {}
        }
    }
    let path = Path::new(source);
    if path.is_file() {
        let bytes = fs::read(path).map_err(|error| {
            AppError::new("ref_image_invalid", "Unable to read local image.").with_detail(
                json!({ "error": error.to_string(), "path": path.display().to_string() }),
            )
        })?;
        let mime_type = detect_mime_type(path, &bytes)?;
        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .map(sanitize_file_name)
            .unwrap_or_else(|| "image.bin".to_string());
        return Ok((mime_type, bytes, file_name));
    }
    Err(AppError::new(
        "ref_image_invalid",
        format!("Unsupported image source for multipart edit: {source}"),
    ))
}

#[cfg(test)]
mod download_ssrf_tests {
    use super::*;

    // The SSRF guard rejects internal targets before any request is made, so
    // these resolve numerically and fail offline.
    #[test]
    fn rejects_loopback_and_link_local_targets() {
        for url in [
            "http://127.0.0.1/x.png",
            "http://[::1]/x.png",
            "http://169.254.169.254/latest/meta-data/",
        ] {
            let err = download_bytes(url, &ProxyConfig::default()).unwrap_err();
            assert_ne!(
                err.code, "network_error",
                "{url} should be rejected by the SSRF guard, not attempted"
            );
        }
    }
}
