use std::path::PathBuf;

use rfd::AsyncFileDialog;

/// Opens the native folder picker and returns the selected path. Returns
/// `Ok(None)` when the user cancels — callers treat that as a no-op.
///
/// `start_dir` seeds the dialog with the directory the user is currently
/// looking at (e.g. the previous value in the same input). Invalid or
/// non-existent paths are silently ignored so the dialog still opens at
/// the OS default location.
#[tauri::command]
pub async fn pick_folder(start_dir: Option<String>) -> Result<Option<String>, String> {
    let mut dialog = AsyncFileDialog::new().set_title("选择文件夹");
    if let Some(start) = start_dir
        && !start.trim().is_empty()
    {
        let path = PathBuf::from(start.trim());
        if path.is_dir() {
            dialog = dialog.set_directory(path);
        }
    }
    Ok(dialog
        .pick_folder()
        .await
        .map(|handle| handle.path().display().to_string()))
}
