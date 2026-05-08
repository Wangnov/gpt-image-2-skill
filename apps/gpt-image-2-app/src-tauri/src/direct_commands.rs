#![allow(unused_imports)]

use super::*;

#[tauri::command]
pub(crate) async fn generate_image(request: GenerateRequest) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (fallback_id, dir) = unique_job_dir()?;
        run_generate_request(request, fallback_id, dir, None)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn edit_image(request: EditRequest) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (fallback_id, dir) = unique_job_dir()?;
        run_edit_request(request, fallback_id, dir, None)
    })
    .await
    .map_err(|error| error.to_string())?
}
