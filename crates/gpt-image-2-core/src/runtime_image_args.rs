#![allow(unused_imports)]

use super::*;

pub fn requested_n(n: Option<u8>) -> Result<u8, String> {
    let requested = n.unwrap_or(1);
    if requested == 0 {
        return Err("Output count must be at least 1.".to_string());
    }
    Ok(requested.min(16))
}

pub fn output_extension(format: Option<&str>) -> &str {
    match format {
        Some("jpeg") => "jpg",
        Some("webp") => "webp",
        _ => "png",
    }
}

pub fn push_optional(args: &mut Vec<String>, flag: &str, value: Option<&str>) {
    if let Some(value) = value
        && !value.is_empty()
        && value != "auto"
    {
        args.push(flag.to_string());
        args.push(value.to_string());
    }
}

pub fn push_provider_arg(args: &mut Vec<String>, provider: Option<&str>) {
    if let Some(provider) = provider
        && !provider.trim().is_empty()
    {
        args.push("--provider".to_string());
        args.push(provider.to_string());
    }
}

pub fn generate_args(request: &GenerateRequest, out: &Path, include_n: bool) -> Vec<String> {
    let mut args = Vec::new();
    push_provider_arg(&mut args, request.provider.as_deref());
    args.extend([
        "images".to_string(),
        "generate".to_string(),
        "--prompt".to_string(),
        request.prompt.clone(),
        "--out".to_string(),
        out.display().to_string(),
    ]);
    push_optional(&mut args, "--size", request.size.as_deref());
    push_optional(&mut args, "--format", request.format.as_deref());
    push_optional(&mut args, "--quality", request.quality.as_deref());
    push_optional(&mut args, "--background", request.background.as_deref());
    push_optional(&mut args, "--moderation", request.moderation.as_deref());
    if include_n && let Some(n) = request.n {
        args.push("--n".to_string());
        args.push(n.to_string());
    }
    if let Some(compression) = request.compression {
        args.push("--compression".to_string());
        args.push(compression.to_string());
    }
    args
}

pub fn edit_args(
    request: &EditRequest,
    ref_paths: &[PathBuf],
    mask_path: Option<&Path>,
    out: &Path,
    include_n: bool,
) -> Vec<String> {
    let mut args = Vec::new();
    push_provider_arg(&mut args, request.provider.as_deref());
    args.extend([
        "images".to_string(),
        "edit".to_string(),
        "--prompt".to_string(),
        request.prompt.clone(),
        "--out".to_string(),
        out.display().to_string(),
    ]);
    for path in ref_paths {
        args.push("--ref-image".to_string());
        args.push(path.display().to_string());
    }
    if let Some(path) = mask_path {
        args.push("--mask".to_string());
        args.push(path.display().to_string());
    }
    push_optional(&mut args, "--size", request.size.as_deref());
    push_optional(&mut args, "--format", request.format.as_deref());
    push_optional(&mut args, "--quality", request.quality.as_deref());
    push_optional(&mut args, "--background", request.background.as_deref());
    push_optional(
        &mut args,
        "--input-fidelity",
        request.input_fidelity.as_deref(),
    );
    push_optional(&mut args, "--moderation", request.moderation.as_deref());
    if include_n && let Some(n) = request.n {
        args.push("--n".to_string());
        args.push(n.to_string());
    }
    if let Some(compression) = request.compression {
        args.push("--compression".to_string());
        args.push(compression.to_string());
    }
    args
}

pub fn batch_output_path(dir: &Path, format: Option<&str>, index: u8) -> PathBuf {
    dir.join(format!("out-{}.{}", index + 1, output_extension(format)))
}
