#![allow(unused_imports)]

use super::*;

#[tauri::command]
pub(crate) async fn generate_image(_request: GenerateRequest) -> Result<Value, String> {
    Err("Direct generation is deprecated; use enqueue_generate_image.".to_string())
}

#[tauri::command]
pub(crate) async fn edit_image(_request: EditRequest) -> Result<Value, String> {
    Err("Direct editing is deprecated; use enqueue_edit_image.".to_string())
}
