use serde_json::{Map, Value, json};

use super::job::NotificationJob;

pub(crate) fn notification_payload(job: &NotificationJob) -> Value {
    json!({
        "event": job.event_name(),
        "title": job.title(),
        "summary": public_summary(job),
        "job": {
            "id": job.id,
            "command": job.command,
            "provider": job.provider,
            "status": job.status,
            "created_at": job.created_at,
            "updated_at": job.updated_at,
            "output_path": public_url_value(job.output_path.as_deref()),
            "outputs": outputs_payload(&job.outputs),
            "storage": storage_payload(&job.outputs),
            "metadata": metadata_payload(&job.metadata),
            "error": public_job_error(job),
        }
    })
}

fn public_summary(job: &NotificationJob) -> String {
    let mut parts = vec![job.provider.clone()];
    if let Some(size) = job.metadata.get("size").and_then(Value::as_str)
        && !size.trim().is_empty()
    {
        parts.push(size.to_string());
    }
    if job.status == "completed" || job.status == "partial_failed" {
        let count = if job.outputs.is_empty() {
            usize::from(job.output_path.is_some())
        } else {
            job.outputs.len()
        };
        if count > 0 {
            parts.push(if count > 1 {
                format!("{count} 张图片")
            } else {
                "1 张图片".to_string()
            });
        }
        if job.status == "partial_failed" && job.error_message.is_some() {
            parts.push("Some outputs failed.".to_string());
        }
    } else if job.error_message.is_some() {
        parts.push("Job failed.".to_string());
    }
    parts.join(" · ")
}

fn public_job_error(job: &NotificationJob) -> Value {
    if job.error_message.is_some() {
        json!({"message": "Job failed."})
    } else {
        Value::Null
    }
}

fn metadata_payload(metadata: &Value) -> Value {
    let mut object = Map::new();
    copy_field(&mut object, metadata, "prompt");
    copy_field(&mut object, metadata, "size");
    copy_field(&mut object, metadata, "quality");
    copy_field(&mut object, metadata, "format");
    copy_field(&mut object, metadata, "n");
    copy_field(&mut object, metadata, "edit_mode");
    copy_field(&mut object, metadata, "edit_region_mode");
    copy_field(&mut object, metadata, "ref_count");
    copy_field(&mut object, metadata, "has_mask");
    copy_field(&mut object, metadata, "selection_hint");
    Value::Object(object)
}

fn outputs_payload(outputs: &[Value]) -> Value {
    Value::Array(outputs.iter().map(public_output_payload).collect())
}

fn public_output_payload(output: &Value) -> Value {
    let mut object = Map::new();
    copy_field(&mut object, output, "index");
    copy_field(&mut object, output, "bytes");
    if output
        .get("error")
        .and_then(Value::as_str)
        .is_some_and(|value| !value.trim().is_empty())
    {
        object.insert(
            "error".to_string(),
            Value::String("Output failed.".to_string()),
        );
    }
    if let Some(items) = output.get("uploads").and_then(Value::as_array) {
        let output_index = output.get("index").cloned().unwrap_or(Value::Null);
        object.insert(
            "uploads".to_string(),
            Value::Array(
                items
                    .iter()
                    .map(|item| public_upload_payload(item, &output_index))
                    .collect(),
            ),
        );
    }
    Value::Object(object)
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
            let upload = public_upload_payload(item, &output_index);
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

fn public_upload_payload(item: &Value, output_index: &Value) -> Value {
    let mut object = Map::new();
    object.insert("output_index".to_string(), output_index.clone());
    copy_field(&mut object, item, "target");
    copy_field(&mut object, item, "target_type");
    copy_field(&mut object, item, "status");
    copy_field(&mut object, item, "url");
    copy_field(&mut object, item, "bytes");
    copy_field(&mut object, item, "updated_at");
    if item
        .get("error")
        .and_then(Value::as_str)
        .is_some_and(|value| !value.trim().is_empty())
    {
        object.insert(
            "error".to_string(),
            Value::String("Storage upload failed.".to_string()),
        );
    }

    if let Some(role) = upload_metadata_field(item, "role") {
        object.insert("role".to_string(), role);
    }
    if let Some(placement) = upload_metadata_field(item, "placement") {
        object.insert("placement".to_string(), placement);
    }
    if let Some(manifest) = upload_manifest(item) {
        copy_field(&mut object, manifest, "key");
        copy_field(&mut object, manifest, "mime");
        copy_field(&mut object, manifest, "sha256");
        if !object.contains_key("bytes") {
            copy_field(&mut object, manifest, "bytes");
        }
    }

    Value::Object(object)
}

fn upload_manifest(item: &Value) -> Option<&Value> {
    item.get("metadata")
        .and_then(|metadata| metadata.get("manifest"))
        .filter(|manifest| manifest.is_object())
}

fn upload_metadata_field(item: &Value, key: &str) -> Option<Value> {
    item.get("metadata")
        .and_then(|metadata| metadata.get(key))
        .or_else(|| upload_manifest(item).and_then(|manifest| manifest.get(key)))
        .cloned()
}

fn copy_field(object: &mut Map<String, Value>, source: &Value, key: &str) {
    if let Some(value) = source.get(key)
        && !value.is_null()
    {
        object.insert(key.to_string(), value.clone());
    }
}

fn public_url_value(value: Option<&str>) -> Value {
    let Some(value) = value else {
        return Value::Null;
    };
    match url::Url::parse(value) {
        Ok(url) if matches!(url.scheme(), "http" | "https") => Value::String(value.to_string()),
        _ => Value::Null,
    }
}
