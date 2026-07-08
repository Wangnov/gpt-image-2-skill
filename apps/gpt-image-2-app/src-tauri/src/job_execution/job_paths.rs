#![allow(unused_imports)]

use super::*;

pub(crate) fn unique_job_dir() -> Result<(String, PathBuf), String> {
    gpt_image_2_runtime::unique_job_dir(result_library_dir(), "app")
}
