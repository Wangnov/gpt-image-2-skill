#![allow(unused_imports)]

use super::*;

pub(crate) fn unique_job_dir() -> Result<(String, PathBuf), String> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let id = format!("app-{millis}-{}", std::process::id());
    let dir = result_library_dir().join(&id);
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok((id, dir))
}
