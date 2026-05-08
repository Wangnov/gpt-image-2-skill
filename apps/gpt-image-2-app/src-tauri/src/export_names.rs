#![allow(unused_imports)]

use super::*;

pub(crate) fn output_paths_from_job(job: &Value) -> Vec<String> {
    let mut paths = job
        .get("outputs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|output| output.get("path").and_then(Value::as_str))
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    if paths.is_empty() {
        if let Some(files) = job
            .get("metadata")
            .and_then(|metadata| metadata.get("output"))
            .and_then(|output| output.get("files"))
            .and_then(Value::as_array)
        {
            paths.extend(
                files
                    .iter()
                    .filter_map(|output| output.get("path").and_then(Value::as_str))
                    .map(ToString::to_string),
            );
        }
    }
    if paths.is_empty() {
        if let Some(path) = job.get("output_path").and_then(Value::as_str).or_else(|| {
            job.get("metadata")
                .and_then(|metadata| metadata.get("output"))
                .and_then(|output| output.get("path"))
                .and_then(Value::as_str)
        }) {
            paths.push(path.to_string());
        }
    }
    paths
}

pub(crate) fn job_prompt(job: &Value) -> String {
    job.get("metadata")
        .and_then(|metadata| metadata.get("prompt"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

pub(crate) fn job_export_folder_name(job: &Value) -> String {
    let created = job
        .get("created_at")
        .and_then(Value::as_str)
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or_else(current_unix_seconds);
    let prompt = safe_filename_part(&job_prompt(job), "untitled");
    let job_id = safe_filename_part(
        job.get("id").and_then(Value::as_str).unwrap_or("job"),
        "job",
    );
    format!("{}-{}-{}", timestamp_for_filename(created), prompt, job_id)
}

pub(crate) fn current_unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub(crate) fn timestamp_for_filename(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let seconds_of_day = secs % 86_400;
    let (year, month, day) = civil_from_days(days);
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day % 3_600) / 60;
    let second = seconds_of_day % 60;
    format!("{year:04}{month:02}{day:02}-{hour:02}{minute:02}{second:02}")
}

pub(crate) fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if month <= 2 { 1 } else { 0 };
    (year, month as u32, day as u32)
}

pub(crate) fn safe_filename_part(value: &str, fallback: &str) -> String {
    let mut result = String::new();
    let mut last_dash = false;
    for ch in value.trim().chars() {
        let separator = ch.is_control()
            || ch.is_whitespace()
            || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*');
        if separator {
            if !last_dash && !result.is_empty() {
                result.push('-');
                last_dash = true;
            }
        } else {
            result.push(ch);
            last_dash = false;
        }
        if result.chars().count() >= 48 {
            break;
        }
    }
    let trimmed = result.trim_matches(['-', '.']).to_string();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed
    }
}

pub(crate) fn unique_export_dir(root: &Path, folder_name: &str) -> PathBuf {
    let mut candidate = root.join(folder_name);
    let mut index = 2;
    while candidate.exists() {
        candidate = root.join(format!("{folder_name}-{index}"));
        index += 1;
    }
    candidate
}

pub(crate) fn unique_destination(dir: &Path, file_name: &str) -> PathBuf {
    let original = Path::new(file_name);
    let stem = original
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("image");
    let extension = original.extension().and_then(|value| value.to_str());
    let mut candidate = dir.join(file_name);
    let mut index = 2;
    while candidate.exists() {
        let next_name = match extension {
            Some(ext) if !ext.is_empty() => format!("{stem}-{index}.{ext}"),
            _ => format!("{stem}-{index}"),
        };
        candidate = dir.join(next_name);
        index += 1;
    }
    candidate
}

pub(crate) fn open_system_path(path: &Path, reveal: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let status = if reveal && path.is_file() {
        Command::new("open").arg("-R").arg(path).status()
    } else {
        Command::new("open").arg(path).status()
    };

    #[cfg(target_os = "windows")]
    let status = if reveal && path.is_file() {
        Command::new("explorer")
            .arg(format!("/select,{}", path.display()))
            .status()
    } else {
        Command::new("explorer").arg(path).status()
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let status = if reveal && path.is_file() {
        let parent = path.parent().unwrap_or(path);
        Command::new("xdg-open").arg(parent).status()
    } else {
        Command::new("xdg-open").arg(path).status()
    };

    status
        .map_err(|error| format!("无法打开：{error}"))
        .and_then(|status| {
            if status.success() {
                Ok(())
            } else {
                Err("系统没有成功打开文件。".to_string())
            }
        })
}
