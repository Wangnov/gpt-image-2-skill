use serde_json::{Value, json};

use super::job::NotificationJob;

pub(crate) fn notification_payload(job: &NotificationJob) -> Value {
    json!({
        "event": job.event_name(),
        "title": job.title(),
        "summary": job.summary(),
        "job": {
            "id": job.id,
            "command": job.command,
            "provider": job.provider,
            "status": job.status,
            "created_at": job.created_at,
            "updated_at": job.updated_at,
            "output_path": job.output_path,
            "outputs": job.outputs,
            "storage": storage_payload(&job.outputs),
            "metadata": job.metadata,
            "error": job.error_message.as_ref().map(|message| json!({"message": message})).unwrap_or(Value::Null),
        }
    })
}

fn storage_payload(outputs: &[Value]) -> Value {
    let mut origin = Vec::new();
    let mut archives = Vec::new();
    let mut uploads = Vec::new();
    for output in outputs {
        let output_index = output.get("index").cloned().unwrap_or(Value::Null);
        let Some(items) = output.get("uploads").and_then(Value::as_array) else {
            continue;
        };
        for item in items {
            let mut upload = item.clone();
            if let Some(object) = upload.as_object_mut() {
                object.insert("output_index".to_string(), output_index.clone());
            }
            let role = item
                .get("metadata")
                .and_then(|metadata| metadata.get("role"))
                .and_then(Value::as_str);
            let placement = item
                .get("metadata")
                .and_then(|metadata| metadata.get("placement"))
                .and_then(Value::as_str);
            let is_origin = match placement {
                Some("origin") => true,
                Some("archive") => false,
                _ => role != Some("fallback"),
            };
            if is_origin {
                origin.push(upload.clone());
            } else {
                archives.push(upload.clone());
            }
            uploads.push(upload);
        }
    }
    json!({
        "origin": origin,
        "archives": archives,
        "uploads": uploads,
    })
}
