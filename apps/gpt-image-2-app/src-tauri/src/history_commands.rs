#![allow(unused_imports)]

use super::*;

#[tauri::command]
pub(crate) fn history_list(
    limit: Option<usize>,
    cursor: Option<String>,
    status: Option<String>,
    query: Option<String>,
) -> Result<Value, String> {
    let page = list_history_jobs_page(HistoryListOptions {
        limit,
        cursor,
        status,
        query,
        include_deleted: false,
    })
    .map_err(app_error)?;
    Ok(json!({
        "history_file": history_db_path().display().to_string(),
        "jobs": page.jobs,
        "next_cursor": page.next_cursor,
        "has_more": page.has_more,
        "total": page.total,
    }))
}

#[tauri::command]
pub(crate) fn history_active_list() -> Result<Value, String> {
    Ok(json!({
        "history_file": history_db_path().display().to_string(),
        "jobs": list_active_history_jobs().map_err(app_error)?,
    }))
}

#[tauri::command]
pub(crate) fn history_show(
    job_id: String,
    state: tauri::State<'_, JobQueueState>,
) -> Result<Value, String> {
    let events = state
        .inner
        .lock()
        .ok()
        .and_then(|inner| inner.events.get(&job_id).cloned())
        .unwrap_or_default();
    Ok(json!({
        "history_file": history_db_path().display().to_string(),
        "job": show_history_job(&job_id).map_err(app_error)?,
        "events": events,
    }))
}

#[tauri::command]
pub(crate) fn history_delete(job_id: String) -> Result<Value, String> {
    let deleted = delete_history_job(&job_id).map_err(app_error)?;
    Ok(json!({
        "ok": true,
        "command": "history delete",
        "job_id": job_id,
        "deleted": deleted,
    }))
}
