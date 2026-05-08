#![allow(unused_imports)]

use super::*;

#[derive(Deserialize)]
pub(crate) struct HistoryListQuery {
    pub(crate) limit: Option<usize>,
    pub(crate) cursor: Option<String>,
    pub(crate) status: Option<String>,
    #[serde(alias = "query")]
    pub(crate) q: Option<String>,
}

pub(crate) async fn history_list(Query(query): Query<HistoryListQuery>) -> ApiResult {
    let page = list_history_jobs_page(HistoryListOptions {
        limit: query.limit,
        cursor: query.cursor,
        status: query.status,
        query: query.q,
        include_deleted: false,
    })
    .map_err(app_error)
    .map_err(ApiError::internal)?;
    Ok(Json(json!({
        "history_file": history_db_path().display().to_string(),
        "jobs": page.jobs,
        "next_cursor": page.next_cursor,
        "has_more": page.has_more,
        "total": page.total,
    })))
}

pub(crate) async fn history_active_list() -> ApiResult {
    Ok(Json(json!({
        "history_file": history_db_path().display().to_string(),
        "jobs": list_active_history_jobs().map_err(app_error).map_err(ApiError::internal)?,
    })))
}

pub(crate) async fn history_show(
    Path(job_id): Path<String>,
    State(state): State<JobQueueState>,
) -> ApiResult {
    let events = state
        .inner
        .lock()
        .ok()
        .and_then(|inner| inner.events.get(&job_id).cloned())
        .unwrap_or_default();
    Ok(Json(json!({
        "history_file": history_db_path().display().to_string(),
        "job": show_history_job(&job_id).map_err(app_error).map_err(ApiError::not_found)?,
        "events": events,
    })))
}

pub(crate) async fn history_delete(Path(job_id): Path<String>) -> ApiResult {
    let deleted = delete_history_job(&job_id)
        .map_err(app_error)
        .map_err(ApiError::internal)?;
    Ok(Json(json!({
        "ok": true,
        "command": "history delete",
        "job_id": job_id,
        "deleted": deleted,
    })))
}
