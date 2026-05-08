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
    fs::create_dir_all(&export_dir).map_err(|error| format!("无法创建保存目录：{error}"))?;

    let mut saved = Vec::new();
    for path in paths {
        let source = PathBuf::from(path);
        if !source.is_file() {
            return Err("图片文件不存在，可能已被移动或删除。".to_string());
        }
        let file_name = source
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "图片文件名无效。".to_string())?;
        let destination = unique_destination(&export_dir, file_name);
        fs::copy(&source, &destination).map_err(|error| format!("保存图片失败：{error}"))?;
        saved.push(destination.display().to_string());
    }
    Ok(saved)
}

#[tauri::command]
pub(crate) fn export_job_to_configured_folder(job_id: String) -> Result<Vec<String>, String> {
    let job = show_history_job(&job_id).map_err(app_error)?;
    let paths = output_paths_from_job(&job);
    if paths.is_empty() {
        return Err("这个任务没有可保存的图片。".to_string());
    }
    let root = configured_export_dir()?;
    fs::create_dir_all(&root).map_err(|error| format!("无法创建保存目录：{error}"))?;
    let folder = unique_export_dir(&root, &job_export_folder_name(&job));
    fs::create_dir_all(&folder).map_err(|error| format!("无法创建任务目录：{error}"))?;

    let mut saved = Vec::new();
    for path in paths {
        let source = PathBuf::from(path);
        if !source.is_file() {
            return Err("图片文件不存在，可能已被移动或删除。".to_string());
        }
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

pub(crate) fn configured_export_dir() -> Result<PathBuf, String> {
    let dir = default_export_dir();
    if dir.as_os_str().is_empty() {
        Err("找不到默认导出目录。".to_string())
    } else {
        Ok(dir)
    }
}
