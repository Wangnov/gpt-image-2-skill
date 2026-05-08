#![allow(unused_imports)]

use super::*;

pub(crate) fn unique_job_dir() -> Result<(String, PathBuf), String> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let id = format!("web-{millis}-{}", std::process::id());
    let dir = result_library_dir().join(&id);
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok((id, dir))
}

pub(crate) fn push_optional(args: &mut Vec<String>, flag: &str, value: Option<&str>) {
    if let Some(value) = value
        && !value.is_empty()
        && value != "auto"
    {
        args.push(flag.to_string());
        args.push(value.to_string());
    }
}

pub(crate) fn output_extension(format: Option<&str>) -> &str {
    match format {
        Some("jpeg") => "jpg",
        Some("webp") => "webp",
        _ => "png",
    }
}
