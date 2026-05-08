#![allow(unused_imports)]

use super::*;

#[derive(Debug)]
pub(crate) struct Settings {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) static_dir: PathBuf,
}

pub(crate) fn default_static_dir() -> PathBuf {
    if let Ok(value) = env::var("GPT_IMAGE_2_WEB_DIST")
        && !value.trim().is_empty()
    {
        return PathBuf::from(value);
    }
    let repo_dist = PathBuf::from("apps/gpt-image-2-app/dist");
    if repo_dist.is_dir() {
        repo_dist
    } else {
        PathBuf::from("/app/public")
    }
}

pub(crate) fn parse_settings() -> Result<Settings, String> {
    let mut host = env::var("GPT_IMAGE_2_WEB_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let mut port = env::var("GPT_IMAGE_2_WEB_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(8787);
    let mut static_dir = default_static_dir();
    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--host" => {
                host = args
                    .next()
                    .ok_or_else(|| "--host requires a value".to_string())?;
            }
            "--port" => {
                let value = args
                    .next()
                    .ok_or_else(|| "--port requires a value".to_string())?;
                port = value
                    .parse::<u16>()
                    .map_err(|_| "--port must be a number".to_string())?;
            }
            "--static-dir" => {
                static_dir = PathBuf::from(
                    args.next()
                        .ok_or_else(|| "--static-dir requires a value".to_string())?,
                );
            }
            "--help" | "-h" => {
                println!(
                    "Usage: gpt-image-2-web [--host 127.0.0.1] [--port 8787] [--static-dir apps/gpt-image-2-app/dist]"
                );
                std::process::exit(0);
            }
            other => return Err(format!("Unknown argument: {other}")),
        }
    }
    Ok(Settings {
        host,
        port,
        static_dir,
    })
}

pub(crate) fn api_router(state: JobQueueState) -> Router {
    Router::new()
        .route("/config", get(get_config))
        .route("/config-paths", get(config_paths))
        .route("/notifications", put(update_notifications))
        .route("/notifications/test", post(test_notifications))
        .route(
            "/notifications/capabilities",
            get(notification_capabilities),
        )
        .route("/paths", put(update_paths))
        .route("/storage", put(update_storage))
        .route("/storage/{name}/test", post(test_storage))
        .route("/providers/default", post(set_default_provider))
        .route(
            "/providers/{name}",
            put(upsert_provider).delete(delete_provider),
        )
        .route(
            "/providers/{name}/credentials/{credential}",
            get(reveal_provider_credential),
        )
        .route("/providers/{name}/test", post(provider_test))
        .route("/jobs", get(history_list))
        .route("/jobs/active", get(history_active_list))
        .route("/jobs/{job_id}", get(history_show).delete(history_delete))
        .route("/jobs/{job_id}/cancel", post(cancel_job))
        .route("/jobs/{job_id}/retry", post(retry_job))
        .route("/queue", get(queue_status))
        .route("/queue/concurrency", post(set_queue_concurrency))
        .route("/images/generate", post(enqueue_generate_image))
        .route("/images/edit", post(enqueue_edit_image))
        .route("/files", get(file_response))
        .with_state(state)
}
