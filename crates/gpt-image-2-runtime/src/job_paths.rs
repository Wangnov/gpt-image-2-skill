use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

pub fn unique_job_dir(root: impl AsRef<Path>, prefix: &str) -> Result<(String, PathBuf), String> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let id = format!("{prefix}-{millis}-{}", std::process::id());
    let dir = root.as_ref().join(&id);
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok((id, dir))
}
