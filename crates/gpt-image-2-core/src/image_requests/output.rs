#![allow(unused_imports)]

use super::*;

pub(crate) fn save_image(path: &Path, bytes: &[u8]) -> Result<PathBuf, AppError> {
    let final_path = if path.extension().is_none() {
        path.with_extension(detect_extension(bytes).trim_start_matches('.'))
    } else {
        path.to_path_buf()
    };
    if let Some(parent) = final_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            AppError::new("output_write_failed", "Unable to create output directory.").with_detail(
                json!({ "error": error.to_string(), "path": parent.display().to_string() }),
            )
        })?;
    }
    fs::write(&final_path, bytes).map_err(|error| {
        AppError::new("output_write_failed", "Unable to write output image.").with_detail(
            json!({ "error": error.to_string(), "path": final_path.display().to_string() }),
        )
    })?;
    Ok(final_path)
}

pub(crate) fn save_images(
    output_path: &Path,
    image_bytes_list: &[Vec<u8>],
) -> Result<Vec<Value>, AppError> {
    if image_bytes_list.is_empty() {
        return Err(AppError::new(
            "missing_image_result",
            "No image bytes were available to save.",
        ));
    }
    if image_bytes_list.len() == 1 {
        let path = save_image(output_path, &image_bytes_list[0])?;
        return Ok(vec![json!({
            "index": 0,
            "path": path.display().to_string(),
            "bytes": image_bytes_list[0].len(),
        })]);
    }
    let mut saved = Vec::new();
    let base_name = output_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .or_else(|| output_path.file_name().and_then(|name| name.to_str()))
        .unwrap_or("image");
    let suffix = output_path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| format!(".{ext}"));
    for (index, bytes) in image_bytes_list.iter().enumerate() {
        let extension = suffix
            .clone()
            .unwrap_or_else(|| detect_extension(bytes).to_string());
        let path = output_path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join(format!("{base_name}-{}{}", index + 1, extension));
        save_image(&path, bytes)?;
        saved.push(json!({
            "index": index,
            "path": path.display().to_string(),
            "bytes": bytes.len(),
        }));
    }
    Ok(saved)
}

pub(crate) fn normalize_saved_output(saved_files: &[Value]) -> Value {
    if saved_files.len() == 1 {
        json!({
            "path": saved_files[0].get("path"),
            "bytes": saved_files[0].get("bytes"),
            "files": saved_files,
        })
    } else {
        let total_bytes: u64 = saved_files
            .iter()
            .filter_map(|item| item.get("bytes").and_then(Value::as_u64))
            .sum();
        json!({
            "path": Value::Null,
            "bytes": total_bytes,
            "files": saved_files,
        })
    }
}

pub(crate) fn primary_saved_output_path(output_path: &Path, saved_files: &[Value]) -> PathBuf {
    saved_files
        .first()
        .and_then(|file| file.get("path"))
        .and_then(Value::as_str)
        .map(PathBuf::from)
        .unwrap_or_else(|| output_path.to_path_buf())
}

pub(crate) fn history_image_metadata(
    operation: &str,
    selection: &ProviderSelection,
    shared: &SharedImageArgs,
    saved_files: &[Value],
) -> Value {
    json!({
        "operation": operation,
        "prompt": &shared.prompt,
        "size": shared.size.as_deref(),
        "format": shared.output_format.map(OutputFormat::as_str),
        "quality": shared.quality.map(Quality::as_str),
        "background": shared.background.as_str(),
        "n": shared.n,
        "provider_selection": selection.payload(),
        "output": normalize_saved_output(saved_files),
    })
}

pub(crate) type DecodedOpenAiImages = (Vec<Vec<u8>>, Vec<Option<String>>);

pub(crate) fn decode_openai_images(payload: &Value) -> Result<DecodedOpenAiImages, AppError> {
    let mut result = Vec::new();
    let mut revised_prompts = Vec::new();
    for item in payload
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        revised_prompts.push(
            item.get("revised_prompt")
                .and_then(Value::as_str)
                .map(ToString::to_string),
        );
        if let Some(b64_json) = item.get("b64_json").and_then(Value::as_str) {
            result.push(decode_base64_bytes(b64_json)?);
            continue;
        }
        if let Some(url) = item.get("url").and_then(Value::as_str) {
            result.push(download_bytes(url)?);
        }
    }
    Ok((result, revised_prompts))
}
