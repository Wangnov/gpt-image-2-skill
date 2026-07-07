#![allow(unused_imports)]

use super::*;

pub(crate) fn jobs_trash_dir() -> PathBuf {
    result_library_dir().join(".trash")
}

/// Resolve a raw user-supplied path against the asset-protocol scope. Reading
/// outside the product result library, legacy jobs dir, or the system temp dir
/// is rejected so a malicious `read_image_bytes` payload can't exfiltrate
/// arbitrary files.
pub(crate) fn resolve_within_allowed_scope(input: &Path) -> Result<PathBuf, String> {
    let canonical_target = input
        .canonicalize()
        .map_err(|error| format!("无法解析路径：{error}"))?;
    let library = result_library_dir();
    let canonical_library = library.canonicalize().unwrap_or(library);
    if canonical_target.starts_with(&canonical_library) {
        return Ok(canonical_target);
    }
    let config = load_config_or_default();
    if config.paths.legacy_shared_codex_dir.enabled_for_read {
        let legacy = legacy_jobs_dir(Some(&config));
        let canonical_legacy = legacy.canonicalize().unwrap_or(legacy);
        if canonical_target.starts_with(&canonical_legacy) {
            return Ok(canonical_target);
        }
    }
    let temp = std::env::temp_dir();
    let canonical_temp = temp.canonicalize().unwrap_or(temp);
    if canonical_target.starts_with(&canonical_temp) {
        return Ok(canonical_target);
    }
    Err("不允许读取该路径。".to_string())
}

#[tauri::command]
pub(crate) async fn read_image_bytes(path: String) -> Result<Vec<u8>, String> {
    let raw = PathBuf::from(&path);
    if !raw.is_file() {
        return Err("文件不存在或不是文件。".to_string());
    }
    let resolved = resolve_within_allowed_scope(&raw)?;
    fs::read(&resolved).map_err(|error| format!("读取失败：{error}"))
}

#[tauri::command]
pub(crate) fn ensure_job_output_cached(
    job_id: String,
    output_index: usize,
) -> Result<Option<String>, String> {
    let readback = read_job_output_for_product(&job_id, output_index, true)?;
    Ok(readback
        .source
        .get("rehydrated_path")
        .and_then(Value::as_str)
        .map(ToString::to_string))
}

#[tauri::command]
pub(crate) async fn copy_image_to_clipboard(
    path: String,
    _prompt: Option<String>,
    job_id: Option<String>,
    output_index: Option<usize>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    // Reading a job output can pull it back from remote storage over core's
    // blocking HTTP client, which panics if dropped on the tokio runtime this
    // async command runs on; the `image` decode is blocking CPU work too. Do
    // both on the blocking pool and hand back only the raw RGBA buffer.
    let (raw, width, height) =
        tauri::async_runtime::spawn_blocking(move || -> Result<(Vec<u8>, u32, u32), String> {
            let raw_path = PathBuf::from(&path);
            let bytes = if raw_path.is_file() {
                let resolved = resolve_within_allowed_scope(&raw_path)?;
                fs::read(&resolved).map_err(|error| format!("读取失败：{error}"))?
            } else if let (Some(job_id), Some(output_index)) = (job_id.as_deref(), output_index) {
                read_job_output_for_product(job_id, output_index, true)?.bytes
            } else {
                return Err("图片文件不存在，可能已被移动或删除。".to_string());
            };
            // Decode via the `image` crate so JPEG / WEBP / GIF outputs
            // round-trip — `tauri::image::Image::from_bytes` only supports
            // PNG/ICO with the currently enabled feature set, which would
            // otherwise hard-regress Copy Image on any non-PNG job.
            let decoded = image::load_from_memory(&bytes)
                .map_err(|error| format!("解析图片失败：{error}"))?;
            let rgba = decoded.to_rgba8();
            let (width, height) = rgba.dimensions();
            Ok((rgba.into_raw(), width, height))
        })
        .await
        .map_err(|error| format!("图片处理任务失败：{error}"))??;
    let image = tauri::image::Image::new_owned(raw, width, height);
    app.clipboard()
        .write_image(&image)
        .map_err(|error| format!("写入剪贴板失败：{error}"))?;
    // Do not write text after the image: clipboard-manager currently treats
    // sequential writes as replacements, so a prompt write would overwrite the
    // image. Prompt copying remains a separate front-end action.
    Ok(())
}

#[tauri::command]
pub(crate) fn soft_delete_job(job_id: String) -> Result<(), String> {
    // This flow only moves local result-library files into local trash and
    // marks the local history row. Remote Origin/Archive objects are never
    // deleted implicitly.
    let job_root = result_library_dir().join(&job_id);
    if job_root.exists() {
        let trash_root = jobs_trash_dir();
        fs::create_dir_all(&trash_root).map_err(|error| format!("创建回收目录失败：{error}"))?;
        let trash_path = trash_root.join(&job_id);
        if trash_path.exists() {
            // Defensive: a previous soft-delete may have left an entry behind.
            let _ = fs::remove_dir_all(&trash_path);
        }
        fs::rename(&job_root, &trash_path)
            .map_err(|error| format!("移动到回收目录失败：{error}"))?;
    }
    soft_delete_history_job(&job_id).map_err(app_error)?;
    Ok(())
}

#[tauri::command]
pub(crate) fn restore_deleted_job(job_id: String) -> Result<(), String> {
    let trash_path = jobs_trash_dir().join(&job_id);
    if trash_path.exists() {
        let dest = result_library_dir().join(&job_id);
        if dest.exists() {
            return Err("恢复失败：目标位置已存在同名任务。".to_string());
        }
        fs::rename(&trash_path, &dest).map_err(|error| format!("从回收目录恢复失败：{error}"))?;
    }
    restore_deleted_history_job(&job_id).map_err(app_error)?;
    Ok(())
}

#[tauri::command]
pub(crate) fn hard_delete_job(job_id: String) -> Result<(), String> {
    // Hard delete is still local-only: remove local trash/cache plus the DB
    // row, but leave any uploaded Origin/Archive objects intact.
    let trash_path = jobs_trash_dir().join(&job_id);
    if trash_path.exists() {
        fs::remove_dir_all(&trash_path).map_err(|error| format!("清空回收目录失败：{error}"))?;
    }
    let main_path = result_library_dir().join(&job_id);
    if main_path.exists() {
        let _ = fs::remove_dir_all(&main_path);
    }
    delete_history_job(&job_id).map_err(app_error)?;
    Ok(())
}

/// Permanently remove soft-deleted history rows whose 5-minute undo window
/// has elapsed, deleting both the database row and the corresponding
/// `result_library_dir/.trash/<id>` directory.
///
/// Cutoff is anchored to the SQLite `deleted_at` column (set by
/// `soft_delete_history_job`), NOT the trash directory's filesystem mtime
/// — `fs::rename` doesn't update mtime, so a long-lived job soft-deleted
/// just now would otherwise look ancient and get hard-deleted immediately,
/// completely defeating the undo window.
pub(crate) fn cleanup_orphan_trash() {
    const RETENTION_SECS: u64 = 5 * 60;
    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let threshold = now_secs.saturating_sub(RETENTION_SECS);

    let expired = match list_expired_deleted_history_jobs(threshold) {
        Ok(ids) => ids,
        Err(_) => return,
    };

    let trash_root = jobs_trash_dir();
    for job_id in expired {
        let trash_path = trash_root.join(&job_id);
        if trash_path.exists() {
            let _ = fs::remove_dir_all(&trash_path);
        }
        let _ = delete_history_job(&job_id);
    }
}

/// Long-lived worker that re-runs `cleanup_orphan_trash` on a fixed cadence.
/// Started once from `setup` so undo windows that elapse mid-session also get
/// finalized (not just the ones that elapsed across a quit/restart).
pub(crate) fn spawn_trash_cleanup_worker() {
    thread::spawn(|| {
        loop {
            cleanup_orphan_trash();
            thread::sleep(std::time::Duration::from_secs(60));
        }
    });
}
