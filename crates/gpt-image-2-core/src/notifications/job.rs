use serde_json::{Value, json};

#[derive(Debug, Clone)]
pub struct NotificationJob {
    pub id: String,
    pub command: String,
    pub provider: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    pub output_path: Option<String>,
    pub outputs: Vec<Value>,
    pub metadata: Value,
    pub error_message: Option<String>,
}

impl NotificationJob {
    pub fn from_job_value(job: &Value) -> Self {
        let metadata = job.get("metadata").cloned().unwrap_or_else(|| json!({}));
        let outputs = job
            .get("outputs")
            .and_then(Value::as_array)
            .cloned()
            .or_else(|| {
                metadata
                    .get("output")
                    .and_then(|output| output.get("files"))
                    .and_then(Value::as_array)
                    .cloned()
            })
            .unwrap_or_default();
        let output_path = job
            .get("output_path")
            .and_then(Value::as_str)
            .or_else(|| {
                metadata
                    .get("output")
                    .and_then(|output| output.get("path"))
                    .and_then(Value::as_str)
            })
            .map(ToString::to_string);
        let error_message = job
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
            .map(ToString::to_string);
        Self {
            id: string_json_field(job, "id").unwrap_or_default(),
            command: string_json_field(job, "command")
                .unwrap_or_else(|| "images generate".to_string()),
            provider: string_json_field(job, "provider").unwrap_or_else(|| "auto".to_string()),
            status: normalize_notification_status(
                &string_json_field(job, "status").unwrap_or_else(|| "completed".to_string()),
            ),
            created_at: string_json_field(job, "created_at").unwrap_or_default(),
            updated_at: string_json_field(job, "updated_at")
                .unwrap_or_else(|| string_json_field(job, "created_at").unwrap_or_default()),
            output_path,
            outputs,
            metadata,
            error_message,
        }
    }

    pub fn event_name(&self) -> String {
        format!("job.{}", self.status)
    }

    pub fn title(&self) -> String {
        let action = if self.command == "images edit" {
            "编辑"
        } else {
            "生成"
        };
        match self.status.as_str() {
            "completed" => format!("{action}完成"),
            "failed" => format!("{action}失败"),
            "cancelled" => "任务已取消".to_string(),
            _ => format!("任务{}", self.status),
        }
    }

    pub fn summary(&self) -> String {
        let mut parts = vec![self.provider.clone()];
        if let Some(size) = self.metadata.get("size").and_then(Value::as_str)
            && !size.trim().is_empty()
        {
            parts.push(size.to_string());
        }
        if self.status == "completed" {
            let count = if self.outputs.is_empty() {
                usize::from(self.output_path.is_some())
            } else {
                self.outputs.len()
            };
            if count > 0 {
                parts.push(if count > 1 {
                    format!("{count} 张图片")
                } else {
                    "1 张图片".to_string()
                });
            }
        } else if let Some(message) = &self.error_message {
            parts.push(message.clone());
        }
        parts.join(" · ")
    }
}

fn string_json_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(ToString::to_string)
}

pub(crate) fn normalize_notification_status(status: &str) -> String {
    if status == "canceled" {
        "cancelled".to_string()
    } else {
        status.to_string()
    }
}
