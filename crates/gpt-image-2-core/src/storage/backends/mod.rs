mod baidu;
mod http;
mod local;
mod pan123;
mod s3;
mod sftp;
mod webdav;

pub(crate) use baidu::BAIDU_NETDISK_FILE_ENDPOINT;
pub(crate) use pan123::PAN123_OPEN_TOKEN_ENDPOINT;
#[cfg(test)]
pub(crate) use pan123::pan123_file_name_from_key;
pub(crate) use s3::s3_endpoint_and_host;
#[cfg(test)]
pub(crate) use sftp::sftp_host_key_matches;
pub(crate) use sftp::{authenticate_sftp_session, connect_sftp_session};

use crate::AppError;

use super::StorageTargetConfig;
use super::util::{StorageUploadOutcome, UploadOutput};

pub(super) fn upload_to_target(
    target: &StorageTargetConfig,
    job_id: &str,
    output: &UploadOutput,
) -> Result<StorageUploadOutcome, AppError> {
    match target {
        StorageTargetConfig::Local {
            directory,
            public_base_url,
        } => local::upload_to_local(directory, public_base_url.as_deref(), job_id, output),
        StorageTargetConfig::Http {
            url,
            method,
            headers,
            public_url_json_pointer,
        } => http::upload_to_http(
            url,
            method,
            headers,
            public_url_json_pointer.as_deref(),
            job_id,
            output,
        ),
        StorageTargetConfig::WebDav {
            url,
            username,
            password,
            public_base_url,
        } => webdav::upload_to_webdav(
            url,
            username.as_deref(),
            password.as_ref(),
            public_base_url.as_deref(),
            job_id,
            output,
        ),
        StorageTargetConfig::Sftp { .. } => sftp::upload_to_sftp(target, job_id, output),
        StorageTargetConfig::S3 { .. } => s3::upload_to_s3(target, job_id, output),
        StorageTargetConfig::BaiduNetdisk { .. } => {
            baidu::upload_to_baidu_netdisk(target, job_id, output)
        }
        StorageTargetConfig::Pan123Open { .. } => {
            pan123::upload_to_pan123_open(target, job_id, output)
        }
    }
}
