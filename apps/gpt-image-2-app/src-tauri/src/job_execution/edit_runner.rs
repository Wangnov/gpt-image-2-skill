#![allow(unused_imports)]

use super::*;

pub(crate) fn write_edit_inputs(
    request: &EditRequest,
    dir: &Path,
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
    let edit_region_mode = edit_region_mode_for_request(request);
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

pub(crate) fn edit_region_mode_for_request(request: &EditRequest) -> String {
    if request.mask.is_some() || request.selection_hint.is_some() {
        provider_edit_region_mode(request.provider.as_deref())
    } else {
        "none".to_string()
    }
}

pub(crate) fn edit_request_metadata(request: &EditRequest) -> Value {
    let edit_region_mode = edit_region_mode_for_request(request);
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

pub(crate) fn run_edit_request(
    mut request: EditRequest,
    fallback_id: String,
    dir: PathBuf,
    stream: Option<StreamContext>,
) -> Result<Value, String> {
    if request.prompt.trim().is_empty() {
        return Err("Prompt is required.".to_string());
    }
    if request.refs.is_empty() {
        return Err("At least one reference image is required.".to_string());
    }
    let output_count = requested_n(request.n)?;
    if request.n.is_some() {
        request.n = Some(output_count);
    }
    let (ref_paths, mask_path, edit_region_mode) = write_edit_inputs(&request, &dir)?;
    let provider_supports_n = provider_supports_n(request.provider.as_deref());
    let payload = if provider_supports_n || output_count == 1 {
        let out = dir.join(format!(
            "out.{}",
            output_extension(request.format.as_deref())
        ));
        cli_json_result(&edit_args(
            &request,
            &ref_paths,
            if edit_region_mode == "native-mask" {
                mask_path.as_deref()
            } else {
                None
            },
            &out,
            provider_supports_n,
        ))?
    } else {
        let arg_sets = (0..output_count)
            .map(|index| {
                edit_args(
                    &request,
                    &ref_paths,
                    if edit_region_mode == "native-mask" {
                        mask_path.as_deref()
                    } else {
                        None
                    },
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
        merge_batch_payloads("images edit", payloads)
    };
    let request_meta = edit_request_metadata(&request);
    let job = job_from_payload(&payload, &fallback_id, "images edit", request_meta);
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
