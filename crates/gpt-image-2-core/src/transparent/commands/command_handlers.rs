#![allow(unused_imports)]

use super::*;

pub(crate) fn run_transparent_command(
    cli: &Cli,
    command: &TransparentCommand,
) -> Result<CommandOutcome, AppError> {
    match &command.transparent_command {
        TransparentSubcommand::Generate(args) => run_transparent_generate(cli, args),
        TransparentSubcommand::Extract(args) => run_transparent_extract(args),
        TransparentSubcommand::Verify(args) => run_transparent_verify(args),
    }
}

pub(crate) fn run_transparent_generate(
    cli: &Cli,
    args: &TransparentGenerateArgs,
) -> Result<CommandOutcome, AppError> {
    let method = match args.method {
        TransparentMethod::Auto | TransparentMethod::Chroma => TransparentMethod::Chroma,
        TransparentMethod::Dual => {
            return Err(AppError::new(
                "unsupported_option",
                "transparent generate does not generate aligned dual-background sources. Generate the source pair explicitly, then call transparent extract --method dual.",
            ));
        }
    };
    let requested_matte_color = parse_matte_color(&args.matte_color)?;
    let chroma_settings = resolve_chroma_settings(
        args.material,
        args.threshold,
        args.softness,
        args.spill_suppression,
    );
    let selection = select_image_provider(cli)?;
    let output_path = normalize_png_output_path(Path::new(&args.out));
    let (source_path, temp_dir) = source_output_path(args)?;
    let source_prompt = args
        .source_prompt
        .clone()
        .unwrap_or_else(|| controlled_matte_prompt(&args.prompt, requested_matte_color));
    let shared = SharedImageArgs {
        prompt: source_prompt.clone(),
        out: source_path.display().to_string(),
        model: args.model.clone(),
        instructions: args.instructions.clone(),
        background: Background::Opaque,
        size: args.size.clone(),
        quality: args.quality,
        output_format: Some(OutputFormat::Png),
        output_compression: args.output_compression,
        n: None,
        moderation: args.moderation,
    };
    validate_provider_specific_image_args(&selection, &shared, None, None)?;
    let source_generation = generate_source_image(cli, &selection, &shared)?;
    let generated_source_path = output_files_from_payload(&source_generation)
        .first()
        .and_then(|file| file.get("path"))
        .and_then(Value::as_str)
        .map(PathBuf::from)
        .unwrap_or_else(|| source_path.clone());
    let extraction =
        extract_chroma_file(&generated_source_path, &output_path, None, chroma_settings)?;
    let verification_options = VerificationOptions {
        profile: args.profile,
        expected_matte_color: extraction
            .matte_color
            .as_deref()
            .map(parse_matte_color)
            .transpose()?,
    };
    let verification = verify_transparent_file(&output_path, verification_options)?;
    if !verification.passed {
        return Err(verification_failed_error(&verification).with_detail(json!({
            "source": generated_source_path.display().to_string(),
            "output": output_path.display().to_string(),
            "verification": verification,
        })));
    }
    if !args.keep_sources
        && args.source_out.is_none()
        && args.report_dir.is_none()
        && let Some(temp_dir) = temp_dir
    {
        let _ = fs::remove_dir_all(temp_dir);
    }
    let history_job_id = record_history_job(
        "transparent generate",
        &selection.resolved,
        "completed",
        Some(&output_path),
        json!({
            "prompt": args.prompt,
            "source_prompt": source_prompt,
            "method": method.as_str(),
            "profile": args.profile.as_str(),
            "material": args.material.map(TransparentMaterial::as_str),
            "provider_selection": selection.payload(),
            "source_output": source_generation.get("output").cloned().unwrap_or(Value::Null),
            "output": output_file_value(&output_path),
            "extraction": extraction,
            "verification": verification,
        }),
    )
    .ok();
    Ok(CommandOutcome {
        payload: json!({
            "ok": true,
            "command": "transparent generate",
            "provider": selection.resolved,
            "provider_selection": selection.payload(),
            "request": {
                "prompt": args.prompt,
                "source_prompt": source_prompt,
                "method": method.as_str(),
                "profile": args.profile.as_str(),
                "requested_matte_color": color_to_hex(requested_matte_color),
                "matte_color": extraction.matte_color,
                "matte_color_source": extraction.matte_color_source,
                "threshold": chroma_settings.threshold,
                "softness": chroma_settings.softness,
                "spill_suppression": chroma_settings.spill_suppression,
                "material": args.material.map(TransparentMaterial::as_str),
                "size": args.size,
                "quality": args.quality.map(Quality::as_str),
                "format": "png",
            },
            "source": {
                "path": generated_source_path.display().to_string(),
                "kept": args.keep_sources || args.source_out.is_some() || args.report_dir.is_some(),
                "generation": source_generation,
            },
            "extraction": extraction,
            "verification": verification,
            "output": output_file_value(&output_path),
            "history": {
                "job_id": history_job_id,
            }
        }),
        exit_status: 0,
    })
}

pub(crate) fn run_transparent_extract(
    args: &TransparentExtractArgs,
) -> Result<CommandOutcome, AppError> {
    let output_path = normalize_png_output_path(Path::new(&args.out));
    let method = resolve_extract_method(
        args.method,
        args.input.as_deref(),
        args.dark_image.as_deref(),
        args.light_image.as_deref(),
    )?;
    let extraction = match method {
        TransparentMethod::Chroma => {
            let input = args.input.as_deref().ok_or_else(|| {
                AppError::new(
                    "invalid_argument",
                    "transparent extract --method chroma requires --input.",
                )
            })?;
            let chroma_settings = resolve_chroma_settings(
                args.material,
                args.threshold,
                args.softness,
                args.spill_suppression,
            );
            let matte = args
                .matte_color
                .as_deref()
                .map(parse_matte_color_or_auto)
                .transpose()?
                .flatten();
            extract_chroma_file(Path::new(input), &output_path, matte, chroma_settings)?
        }
        TransparentMethod::Dual => {
            let dark = args.dark_image.as_deref().ok_or_else(|| {
                AppError::new(
                    "invalid_argument",
                    "transparent extract --method dual requires --dark-image.",
                )
            })?;
            let light = args.light_image.as_deref().ok_or_else(|| {
                AppError::new(
                    "invalid_argument",
                    "transparent extract --method dual requires --light-image.",
                )
            })?;
            extract_dual_file(Path::new(dark), Path::new(light), &output_path)?
        }
        TransparentMethod::Auto => unreachable!("auto is resolved before extraction"),
    };
    let verification = verify_transparent_file(
        &output_path,
        VerificationOptions {
            profile: args.profile,
            expected_matte_color: extraction
                .matte_color
                .as_deref()
                .map(parse_matte_color)
                .transpose()?,
        },
    )?;
    if args.strict && !verification.passed {
        return Err(verification_failed_error(&verification).with_detail(json!({
            "output": output_path.display().to_string(),
            "verification": verification,
        })));
    }
    let history_job_id = record_history_job(
        "transparent extract",
        "local",
        "completed",
        Some(&output_path),
        json!({
            "method": method.as_str(),
            "profile": args.profile.as_str(),
            "material": args.material.map(TransparentMaterial::as_str),
            "output": output_file_value(&output_path),
            "extraction": extraction,
            "verification": verification,
        }),
    )
    .ok();
    Ok(CommandOutcome {
        payload: json!({
            "ok": true,
            "command": "transparent extract",
            "method": method.as_str(),
            "profile": args.profile.as_str(),
            "material": args.material.map(TransparentMaterial::as_str),
            "extraction": extraction,
            "verification": verification,
            "output": output_file_value(&output_path),
            "history": {
                "job_id": history_job_id,
            }
        }),
        exit_status: 0,
    })
}

pub(crate) fn run_transparent_verify(
    args: &TransparentVerifyArgs,
) -> Result<CommandOutcome, AppError> {
    let verification = verify_transparent_file(
        Path::new(&args.input),
        VerificationOptions {
            profile: args.profile,
            expected_matte_color: args
                .expected_matte_color
                .as_deref()
                .map(parse_matte_color)
                .transpose()?,
        },
    )?;
    if args.strict && !verification.passed {
        return Err(verification_failed_error(&verification));
    }
    Ok(CommandOutcome {
        payload: json!({
            "ok": true,
            "command": "transparent verify",
            "profile": args.profile.as_str(),
            "passed": verification.passed,
            "verification": verification,
        }),
        exit_status: 0,
    })
}

pub(crate) fn resolve_extract_method(
    requested: TransparentMethod,
    input: Option<&str>,
    dark_image: Option<&str>,
    light_image: Option<&str>,
) -> Result<TransparentMethod, AppError> {
    match requested {
        TransparentMethod::Auto => {
            if dark_image.is_some() || light_image.is_some() {
                if dark_image.is_some() && light_image.is_some() {
                    Ok(TransparentMethod::Dual)
                } else {
                    Err(AppError::new(
                        "invalid_argument",
                        "Dual extraction needs both --dark-image and --light-image.",
                    ))
                }
            } else if input.is_some() {
                Ok(TransparentMethod::Chroma)
            } else {
                Err(AppError::new(
                    "invalid_argument",
                    "transparent extract needs --input or a --dark-image/--light-image pair.",
                ))
            }
        }
        TransparentMethod::Chroma => Ok(TransparentMethod::Chroma),
        TransparentMethod::Dual => Ok(TransparentMethod::Dual),
    }
}

pub(crate) fn source_output_path(
    args: &TransparentGenerateArgs,
) -> Result<(PathBuf, Option<PathBuf>), AppError> {
    if let Some(source_out) = &args.source_out {
        return Ok((normalize_png_output_path(Path::new(source_out)), None));
    }
    if let Some(report_dir) = &args.report_dir {
        let dir = PathBuf::from(report_dir);
        return Ok((dir.join("source.png"), None));
    }
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temp_dir = std::env::temp_dir().join(format!(
        "gpt-image-2-transparent-{}-{unique}",
        std::process::id()
    ));
    fs::create_dir_all(&temp_dir).map_err(|error| {
        AppError::new(
            "output_write_failed",
            "Unable to create temporary source directory.",
        )
        .with_detail(json!({ "path": temp_dir.display().to_string(), "error": error.to_string() }))
    })?;
    Ok((temp_dir.join("source.png"), Some(temp_dir)))
}

pub(crate) fn controlled_matte_prompt(prompt: &str, matte: [u8; 3]) -> String {
    format!(
        "{prompt}\n\nExtraction setup: render exactly one isolated asset, centered with a clear margin, on a perfectly flat uniform matte background of pure {matte}. Do not use gradients, texture, vignette, shadows, reflections, contact shadows, scenery, props, labels, frames, or background-colored details. Keep the full subject visible and separated from the matte.",
        matte = color_to_hex(matte)
    )
}

pub(crate) fn verification_failed_error(verification: &TransparentVerification) -> AppError {
    AppError::new(
        "transparent_verification_failed",
        "Transparent PNG verification failed.",
    )
    .with_detail(json!({ "verification": verification }))
}
