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
        cli_json_result(&generate_args_with_recovery(
            &request,
            &out,
            provider_supports_n,
            Some((&fallback_id, &dir)),
        ))?
    } else {
        let recovery_targets = (0..output_count)
            .map(|index| {
                (
                    batch_recovery_job_id(&fallback_id, index),
                    batch_recovery_job_dir(&dir, index),
                )
            })
            .collect::<Vec<_>>();
        let arg_sets = recovery_targets
            .iter()
            .enumerate()
            .map(|(index, (recovery_job_id, recovery_job_dir))| {
                generate_args_with_recovery(
                    &request,
                    &batch_output_path(&dir, request.format.as_deref(), index as u8),
                    false,
                    Some((recovery_job_id.as_str(), recovery_job_dir.as_path())),
                )
            })
            .collect::<Vec<_>>();
        let partials = Arc::new(Mutex::new(Vec::<Value>::new()));
        let partials_for_cb = partials.clone();
        let stream_for_cb = stream.clone();
        let batch = run_payloads_concurrently_streaming(arg_sets, move |index, payload| {
            if let Some(ctx) = &stream_for_cb {
                let mut list = partials_for_cb
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                apply_partial_output(ctx, &mut list, index, payload);
            }
        });
        let merged = merge_batch_payloads(
            "images generate",
            output_count.into(),
            batch.payloads,
            batch.errors,
        );
        let outputs_present = merged
            .get("output")
            .and_then(|output| output.get("files"))
            .and_then(Value::as_array)
            .map(Vec::len)
            .unwrap_or(0);
        let failures = merged
            .get("batch")
            .and_then(|batch| batch.get("failure_count"))
            .and_then(Value::as_u64)
            .unwrap_or(0) as usize;
        write_batch_recovery_summary(
            &fallback_id,
            &dir,
            &recovery_targets
                .iter()
                .map(|(_, recovery_dir)| recovery_dir.clone())
                .collect::<Vec<_>>(),
            outputs_present,
            failures,
        )
        .map_err(app_error)?;
        merged
    };
    let request_meta = serde_json::to_value(&request).unwrap_or_else(|_| json!({}));
    let job = job_from_payload(&payload, &fallback_id, "images generate", request_meta);
    let event_type = terminal_event_type(job.get("status").and_then(Value::as_str));
    Ok(json!({
        "job_id": job.get("id").cloned().unwrap_or(Value::Null),
        "job": job,
        "events": [{
            "seq": 1,
            "kind": "local",
            "type": event_type,
            "data": {"status": job.get("status"), "output": payload.get("output"), "error": payload.get("error")}
        }],
        "payload": payload,
    }))
}
