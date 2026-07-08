#![allow(unused_imports)]

use super::*;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};

pub fn write_edit_inputs(
    request: &EditRequest,
    dir: &Path,
    config: Option<&AppConfig>,
) -> Result<(Vec<PathBuf>, Option<PathBuf>, String), String> {
    let mut ref_paths = Vec::new();
    for (index, upload) in request.refs.iter().enumerate() {
        let ext = Path::new(&upload.name)
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("png");
        let path = dir.join(format!("ref-{index}.{ext}"));
        fs::write(&path, &upload.bytes).map_err(|error| error.to_string())?;
        ref_paths.push(path);
    }
    let mask_path = if let Some(mask) = &request.mask {
        let path = dir.join("mask.png");
        fs::write(&path, &mask.bytes).map_err(|error| error.to_string())?;
        Some(path)
    } else {
        None
    };
    let selection_hint_path = if let Some(hint) = &request.selection_hint {
        let path = dir.join("selection-hint.png");
        fs::write(&path, &hint.bytes).map_err(|error| error.to_string())?;
        Some(path)
    } else {
        None
    };
    let edit_region_mode = edit_region_mode_for_request(request, config);
    if edit_region_mode == "none" && (mask_path.is_some() || selection_hint_path.is_some()) {
        return Err("当前凭证不支持局部编辑。请切换到「多图参考」或更换凭证。".to_string());
    }
    if edit_region_mode == "reference-hint"
        && let Some(path) = &selection_hint_path
    {
        ref_paths.push(path.clone());
    }
    Ok((ref_paths, mask_path, edit_region_mode))
}

pub fn edit_region_mode_for_request(request: &EditRequest, config: Option<&AppConfig>) -> String {
    if request.mask.is_some() || request.selection_hint.is_some() {
        provider_edit_region_mode_from_config(config, request.provider.as_deref())
    } else {
        "none".to_string()
    }
}

pub fn edit_request_metadata(request: &EditRequest, config: Option<&AppConfig>) -> Value {
    let edit_region_mode = edit_region_mode_for_request(request, config);
    json!({
        "prompt": request.prompt,
        "provider": request.provider,
        "size": request.size,
        "format": request.format,
        "quality": request.quality,
        "background": request.background,
        "n": request.n,
        "compression": request.compression,
        "input_fidelity": request.input_fidelity,
        "moderation": request.moderation,
        "storage_targets": request.storage_targets,
        "fallback_targets": request.fallback_targets,
        "ref_count": request.refs.len(),
        "has_mask": request.mask.is_some(),
        "selection_hint": request.selection_hint.is_some(),
        "edit_region_mode": edit_region_mode,
    })
}

pub fn run_edit_request(
    mut request: EditRequest,
    fallback_id: String,
    dir: PathBuf,
    host: &Arc<dyn RuntimeHost>,
    stream: Option<StreamContext>,
) -> Result<Value, Value> {
    if request.prompt.trim().is_empty() {
        return Err(error_value_from_message("Prompt is required."));
    }
    if request.refs.is_empty() {
        return Err(error_value_from_message(
            "At least one reference image is required.",
        ));
    }
    let output_count = requested_n(request.n).map_err(error_value_from_message)?;
    if request.n.is_some() {
        request.n = Some(output_count);
    }
    let config = host.load_config().ok();
    let (ref_paths, mask_path, edit_region_mode) =
        write_edit_inputs(&request, &dir, config.as_ref()).map_err(error_value_from_message)?;
    let provider_supports_n =
        provider_supports_n_from_config(config.as_ref(), request.provider.as_deref());
    let payload = if provider_supports_n || output_count == 1 {
        let out = dir.join(format!(
            "out.{}",
            output_extension(request.format.as_deref())
        ));
        cli_json_result(&edit_args_with_recovery(
            &request,
            &ref_paths,
            if edit_region_mode == "native-mask" {
                mask_path.as_deref()
            } else {
                None
            },
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
                edit_args_with_recovery(
                    &request,
                    &ref_paths,
                    if edit_region_mode == "native-mask" {
                        mask_path.as_deref()
                    } else {
                        None
                    },
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
        let child_dirs = recovery_targets
            .iter()
            .map(|(_, recovery_dir)| recovery_dir.clone())
            .collect::<Vec<_>>();
        let merged = merge_batch_payloads(
            "images edit",
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
        .map_err(|error| error_value_from_message(app_error(error)))?;
        merged
    };
    let request_meta = edit_request_metadata(&request, config.as_ref());
    let job = job_from_payload(&payload, &fallback_id, "images edit", request_meta);
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
