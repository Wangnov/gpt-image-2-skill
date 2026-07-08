#![allow(unused_imports)]

use super::*;
pub(crate) use gpt_image_2_runtime::{JobQueueInner, QueuedJob, QueuedTask};

pub(crate) const MAX_DROPPED_IMAGE_BYTES: u64 = 64 * 1024 * 1024;

pub(crate) fn image_mime_for_path(path: &Path) -> Option<&'static str> {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .as_deref()
    {
        Some("avif") => Some("image/avif"),
        Some("bmp") => Some("image/bmp"),
        Some("gif") => Some("image/gif"),
        Some("heic") => Some("image/heic"),
        Some("heif") => Some("image/heif"),
        Some("jpg") | Some("jpeg") => Some("image/jpeg"),
        Some("png") => Some("image/png"),
        Some("tif") | Some("tiff") => Some("image/tiff"),
        Some("webp") => Some("image/webp"),
        _ => None,
    }
}

#[derive(Clone)]
pub(crate) struct JobQueueState {
    pub(crate) inner: Arc<Mutex<JobQueueInner>>,
}

impl Default for JobQueueState {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(JobQueueInner::default())),
        }
    }
}
