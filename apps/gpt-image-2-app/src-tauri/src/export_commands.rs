#![allow(unused_imports)]

use super::*;

#[tauri::command]
pub(crate) fn open_path(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !path.exists() {
        return Err("文件不存在，可能已被移动或删除。".to_string());
    }
    open_system_path(&path, false)
}

#[tauri::command]
pub(crate) fn reveal_path(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !path.exists() {
        return Err("文件不存在，可能已被移动或删除。".to_string());
    }
    open_system_path(&path, true)
}

#[tauri::command]
pub(crate) fn open_logs_dir() -> Result<String, String> {
    let dir = logs_dir(Some(&load_config_or_default()), ProductRuntime::Tauri);
    // The directory may not exist yet if nothing has been logged; create it so
    // the reveal lands somewhere instead of erroring.
    fs::create_dir_all(&dir).map_err(|error| format!("无法创建日志目录：{error}"))?;
    open_system_path(&dir, false)?;
    Ok(dir.display().to_string())
}

#[tauri::command]
pub(crate) fn export_files_to_downloads(paths: Vec<String>) -> Result<Vec<String>, String> {
    export_files_to_configured_folder(paths)
}

#[tauri::command]
pub(crate) fn export_job_to_downloads(job_id: String) -> Result<Vec<String>, String> {
    export_job_to_configured_folder(job_id)
}

#[tauri::command]
pub(crate) fn export_files_to_configured_folder(paths: Vec<String>) -> Result<Vec<String>, String> {
    if paths.is_empty() {
        return Err("没有可保存的图片。".to_string());
    }
    let export_dir = configured_export_dir()?;
    export_files_into_dir(paths, &export_dir)
}

pub(crate) fn export_files_into_dir(
    paths: Vec<String>,
    export_dir: &Path,
) -> Result<Vec<String>, String> {
    let sources = validate_source_paths(paths)?;
    fs::create_dir_all(export_dir).map_err(|error| format!("无法创建保存目录：{error}"))?;
    if all_sources_within_dir(&sources, export_dir) {
        return Ok(display_paths(&sources));
    }

    let mut saved = Vec::new();
    for source in sources {
        let file_name = source
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "图片文件名无效。".to_string())?;
        let destination = unique_destination(export_dir, file_name);
        fs::copy(&source, &destination).map_err(|error| format!("保存图片失败：{error}"))?;
        saved.push(destination.display().to_string());
    }
    Ok(saved)
}

#[tauri::command]
pub(crate) fn export_job_to_configured_folder(job_id: String) -> Result<Vec<String>, String> {
    let job = show_history_job(&job_id).map_err(app_error)?;
    rehydrate_history_job_outputs_for_export(&job)?;
    let paths = output_paths_from_job(&job);
    if paths.is_empty() {
        return Err("这个任务没有可保存的图片。".to_string());
    }
    let sources = validate_source_paths(paths)?;
    let root = configured_export_dir()?;
    fs::create_dir_all(&root).map_err(|error| format!("无法创建保存目录：{error}"))?;
    if all_sources_within_dir(&sources, &root) {
        return Ok(display_paths(&sources));
    }
    let folder = unique_export_dir(&root, &job_export_folder_name(&job));
    fs::create_dir_all(&folder).map_err(|error| format!("无法创建任务目录：{error}"))?;

    let mut saved = Vec::new();
    for source in sources {
        let file_name = source
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "图片文件名无效。".to_string())?;
        let destination = unique_destination(&folder, file_name);
        fs::copy(&source, &destination).map_err(|error| format!("保存图片失败：{error}"))?;
        saved.push(destination.display().to_string());
    }
    Ok(saved)
}

#[tauri::command]
pub(crate) fn export_job_output_to_configured_folder(
    job_id: String,
    output_index: usize,
) -> Result<Vec<String>, String> {
    let job = show_history_job(&job_id).map_err(app_error)?;
    let readback = read_job_output_for_product(&job_id, output_index, true).map_err(|error| {
        format!(
            "远端图片不可用，无法导出候选 {}：{}",
            history_output_label(output_index),
            error
        )
    })?;
    let path = readback
        .source
        .get("rehydrated_path")
        .and_then(Value::as_str)
        .or_else(|| readback.source.get("path").and_then(Value::as_str))
        .map(ToString::to_string)
        .or_else(|| output_path_from_job(&job, output_index))
        .ok_or_else(|| "这个输出没有可保存的图片。".to_string())?;
    let root = configured_export_dir()?;
    export_files_into_dir(vec![path], &root)
}

pub(crate) fn configured_export_dir() -> Result<PathBuf, String> {
    let dir = default_export_dir();
    if dir.as_os_str().is_empty() {
        Err("找不到默认导出目录。".to_string())
    } else {
        Ok(dir)
    }
}

fn validate_source_paths(paths: Vec<String>) -> Result<Vec<PathBuf>, String> {
    paths
        .into_iter()
        .map(|path| {
            let source = PathBuf::from(path);
            if !source.is_file() {
                return Err("图片文件不存在，可能已被移动或删除。".to_string());
            }
            Ok(source)
        })
        .collect()
}

fn all_sources_within_dir(sources: &[PathBuf], dir: &Path) -> bool {
    let canonical_dir = canonical_or_original(dir);
    sources
        .iter()
        .all(|source| canonical_or_original(source).starts_with(&canonical_dir))
}

fn canonical_or_original(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

fn display_paths(paths: &[PathBuf]) -> Vec<String> {
    paths
        .iter()
        .map(|path| path.display().to_string())
        .collect()
}
