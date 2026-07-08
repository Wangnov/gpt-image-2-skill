use std::path::PathBuf;

use gpt_image_2_core::{
    GenerateRequest, batch_output_path, batch_recovery_job_dir, batch_recovery_job_id,
    generate_args_with_recovery, generation_slots_from_batch_payload, output_extension,
    requested_n, write_batch_recovery_summary,
};
use serde_json::{Value, json};

use crate::{
    cli_json_result, error_value_from_message, job_from_payload, merge_batch_payloads,
    run_payloads_concurrently_streaming, terminal_event_type,
};

pub fn run_generate_request(
    mut request: GenerateRequest,
    fallback_id: String,
    dir: PathBuf,
    provider_supports_n: bool,
    on_partial: impl FnMut(usize, &Value),
) -> Result<Value, Value> {
    if request.prompt.trim().is_empty() {
        return Err(error_value_from_message("Prompt is required."));
    }
    let output_count = requested_n(request.n).map_err(error_value_from_message)?;
    if request.n.is_some() {
        request.n = Some(output_count);
    }
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
        let batch = run_payloads_concurrently_streaming(arg_sets, on_partial);
        let child_dirs = recovery_targets
            .iter()
            .map(|(_, recovery_dir)| recovery_dir.clone())
            .collect::<Vec<_>>();
        let merged = merge_batch_payloads(
            "images generate",
            output_count.into(),
            batch.payloads,
            batch.errors,
        );
        let generation_slots =
            generation_slots_from_batch_payload(output_count.into(), &merged, &child_dirs);
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
            &child_dirs,
            outputs_present,
            failures,
            generation_slots,
        )
        .map_err(|error| error_value_from_message(format!("{}: {}", error.code, error.message)))?;
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
