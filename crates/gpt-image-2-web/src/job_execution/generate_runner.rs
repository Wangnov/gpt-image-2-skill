#![allow(unused_imports)]

use super::*;

pub(crate) fn run_generate_request(
    mut request: GenerateRequest,
    fallback_id: String,
    dir: PathBuf,
    stream: Option<StreamContext>,
) -> Result<Value, String> {
    if request.prompt.trim().is_empty() {
        return Err("Prompt is required.".to_string());
    }
    let output_count = requested_n(request.n)?;
    if request.n.is_some() {
        request.n = Some(output_count);
    }
    let provider_supports_n = provider_supports_n(request.provider.as_deref());
    let payload = if provider_supports_n || output_count == 1 {
        let out = dir.join(format!(
            "out.{}",
            output_extension(request.format.as_deref())
        ));
        cli_json_result(&generate_args(&request, &out, provider_supports_n))?
    } else {
        let arg_sets = (0..output_count)
            .map(|index| {
                generate_args(
                    &request,
                    &batch_output_path(&dir, request.format.as_deref(), index),
                    false,
                )
            })
            .collect::<Vec<_>>();
        let partials = Arc::new(Mutex::new(Vec::<Value>::new()));
        let partials_for_cb = partials.clone();
        let stream_for_cb = stream.clone();
        let payloads = run_payloads_concurrently_streaming(arg_sets, move |index, payload| {
            if let Some(ctx) = &stream_for_cb {
                let mut list = partials_for_cb
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                apply_partial_output(ctx, &mut list, index, payload);
            }
        })?;
        merge_batch_payloads("images generate", payloads)
    };
    let request_meta = serde_json::to_value(&request).unwrap_or_else(|_| json!({}));
    let job = job_from_payload(&payload, &fallback_id, "images generate", request_meta);
    Ok(json!({
        "job_id": job.get("id").cloned().unwrap_or(Value::Null),
        "job": job,
        "events": [{
            "seq": 1,
            "kind": "local",
            "type": "job.completed",
            "data": {"status": "completed", "output": payload.get("output")}
        }],
        "payload": payload,
    }))
}
