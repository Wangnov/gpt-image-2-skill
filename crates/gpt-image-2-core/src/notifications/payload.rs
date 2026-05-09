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
            "metadata": job.metadata,
            "error": job.error_message.as_ref().map(|message| json!({"message": message})).unwrap_or(Value::Null),
        }
    })
}
