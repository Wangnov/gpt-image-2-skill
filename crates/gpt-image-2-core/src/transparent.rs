use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use clap::{ArgAction, Args, Subcommand, ValueEnum};
use image::{DynamicImage, ImageReader, Rgba, RgbaImage};
use serde::Serialize;
use serde_json::{Value, json};

use super::*;

const DEFAULT_MATTE_COLOR: &str = "#00ff00";
const DEFAULT_CHROMA_THRESHOLD: f32 = 28.0;
const DEFAULT_CHROMA_SOFTNESS: f32 = 34.0;
const DEFAULT_SPILL_SUPPRESSION: f32 = 0.85;
const TRANSPARENT_ALPHA_MAX: u8 = 5;
const NONTRANSPARENT_ALPHA_MIN: u8 = 20;
const MIN_TRANSPARENT_RATIO: f64 = 0.005;
const STRICT_MIN_TRANSPARENT_RATIO: f64 = 0.05;
const MIN_OPAQUE_ALPHA: u8 = 250;

#[derive(Args, Debug)]
pub struct TransparentCommand {
    #[command(subcommand)]
    pub transparent_command: TransparentSubcommand,
}

#[derive(Subcommand, Debug)]
pub enum TransparentSubcommand {
    Generate(TransparentGenerateArgs),
    Extract(TransparentExtractArgs),
    Verify(TransparentVerifyArgs),
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, ValueEnum)]
pub enum TransparentMethod {
    Auto,
    Chroma,
    Dual,
}

impl TransparentMethod {
    fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Chroma => "chroma",
            Self::Dual => "dual",
        }
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, ValueEnum)]
pub enum TransparentProfile {
    Generic,
    Icon,
    Product,
    Translucent,
    Glow,
    Shadow,
}

impl TransparentProfile {
    fn as_str(self) -> &'static str {
        match self {
            Self::Generic => "generic",
            Self::Icon => "icon",
            Self::Product => "product",
            Self::Translucent => "translucent",
            Self::Glow => "glow",
            Self::Shadow => "shadow",
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct VerificationOptions {
    profile: TransparentProfile,
    expected_matte_color: Option<[u8; 3]>,
}

impl Default for VerificationOptions {
    fn default() -> Self {
        Self {
            profile: TransparentProfile::Generic,
            expected_matte_color: None,
        }
    }
}

#[derive(Args, Debug, Clone)]
pub struct TransparentGenerateArgs {
    #[arg(long)]
    pub prompt: String,
    #[arg(long)]
    pub out: String,
    #[arg(short = 'm', long)]
    pub model: Option<String>,
    #[arg(long, default_value = DEFAULT_INSTRUCTIONS)]
    pub instructions: String,
    #[arg(long, value_parser = parse_image_size)]
    pub size: Option<String>,
    #[arg(long, value_enum)]
    pub quality: Option<Quality>,
    #[arg(long = "compression", value_parser = clap::value_parser!(u8).range(0..=100))]
    pub output_compression: Option<u8>,
    #[arg(long, value_enum)]
    pub moderation: Option<Moderation>,
    #[arg(long, value_enum, default_value = "auto")]
    pub method: TransparentMethod,
    #[arg(long, value_enum, default_value = "generic")]
    pub profile: TransparentProfile,
    #[arg(long, default_value = DEFAULT_MATTE_COLOR)]
    pub matte_color: String,
    #[arg(long)]
    pub source_prompt: Option<String>,
    #[arg(long)]
    pub source_out: Option<String>,
    #[arg(long)]
    pub report_dir: Option<String>,
    #[arg(long, action = ArgAction::SetTrue)]
    pub keep_sources: bool,
    #[arg(long, default_value_t = DEFAULT_CHROMA_THRESHOLD)]
    pub threshold: f32,
    #[arg(long, default_value_t = DEFAULT_CHROMA_SOFTNESS)]
    pub softness: f32,
    #[arg(long, default_value_t = DEFAULT_SPILL_SUPPRESSION, value_parser = parse_unit_float)]
    pub spill_suppression: f32,
}

#[derive(Args, Debug, Clone)]
pub struct TransparentExtractArgs {
    #[arg(long)]
    pub input: Option<String>,
    #[arg(long = "dark-image")]
    pub dark_image: Option<String>,
    #[arg(long = "light-image")]
    pub light_image: Option<String>,
    #[arg(long)]
    pub out: String,
    #[arg(long, value_enum, default_value = "auto")]
    pub method: TransparentMethod,
    #[arg(long, value_enum, default_value = "generic")]
    pub profile: TransparentProfile,
    #[arg(long)]
    pub matte_color: Option<String>,
    #[arg(long, default_value_t = DEFAULT_CHROMA_THRESHOLD)]
    pub threshold: f32,
    #[arg(long, default_value_t = DEFAULT_CHROMA_SOFTNESS)]
    pub softness: f32,
    #[arg(long, default_value_t = DEFAULT_SPILL_SUPPRESSION, value_parser = parse_unit_float)]
    pub spill_suppression: f32,
    #[arg(long, action = ArgAction::SetTrue)]
    pub strict: bool,
}

#[derive(Args, Debug, Clone)]
pub struct TransparentVerifyArgs {
    #[arg(long)]
    pub input: String,
    #[arg(long, value_enum, default_value = "generic")]
    pub profile: TransparentProfile,
    #[arg(long = "expected-matte-color")]
    pub expected_matte_color: Option<String>,
    #[arg(long, action = ArgAction::SetTrue)]
    pub strict: bool,
}

#[derive(Debug, Clone, Serialize)]
struct AlphaBoundingBox {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

#[derive(Debug, Clone, Serialize)]
struct TransparentVerification {
    path: String,
    profile: String,
    width: u32,
    height: u32,
    is_png: bool,
    color_type: String,
    has_alpha: bool,
    input_has_alpha: bool,
    alpha_min: u8,
    alpha_max: u8,
    transparent_pixels: u64,
    partial_pixels: u64,
    opaque_pixels: u64,
    nontransparent_pixels: u64,
    transparent_ratio: f64,
    partial_ratio: f64,
    opaque_ratio: f64,
    edge_nontransparent_pixels: u64,
    edge_nontransparent_ratio: f64,
    touches_edge: bool,
    edge_margin_px: Option<u32>,
    component_count: u64,
    largest_component_pixels: u64,
    largest_component_ratio: f64,
    stray_pixel_count: u64,
    alpha_noise_score: f64,
    matte_residue_score: Option<f64>,
    matte_residue_checked: bool,
    halo_score: f64,
    transparent_rgb_scrubbed: bool,
    checkerboard_detected: bool,
    quality_score: f64,
    bbox: Option<AlphaBoundingBox>,
    passed: bool,
    failure_reasons: Vec<String>,
    warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
struct ExtractionReport {
    method: String,
    inputs: Value,
    output: Value,
    matte_color: Option<String>,
    threshold: Option<f32>,
    softness: Option<f32>,
    spill_suppression: Option<f32>,
    matte_decontamination_applied: bool,
    rgb_scrubbed: bool,
    dual_alignment: Option<DualAlignmentReport>,
}

#[derive(Debug, Clone, Serialize)]
struct DualAlignmentReport {
    score: f64,
    passed: bool,
    negative_delta_ratio: f64,
    delta_channel_noise: f64,
    color_space: String,
}

pub(super) fn run_transparent_command(
    cli: &Cli,
    command: &TransparentCommand,
) -> Result<CommandOutcome, AppError> {
    match &command.transparent_command {
        TransparentSubcommand::Generate(args) => run_transparent_generate(cli, args),
        TransparentSubcommand::Extract(args) => run_transparent_extract(args),
        TransparentSubcommand::Verify(args) => run_transparent_verify(args),
    }
}

fn run_transparent_generate(
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
    let matte_color = parse_matte_color(&args.matte_color)?;
    let verification_options = VerificationOptions {
        profile: args.profile,
        expected_matte_color: Some(matte_color),
    };
    let selection = select_image_provider(cli)?;
    let output_path = normalize_png_output_path(Path::new(&args.out));
    let (source_path, temp_dir) = source_output_path(args)?;
    let source_prompt = args
        .source_prompt
        .clone()
        .unwrap_or_else(|| controlled_matte_prompt(&args.prompt, matte_color));
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
    let extraction = extract_chroma_file(
        &generated_source_path,
        &output_path,
        Some(matte_color),
        args.threshold,
        args.softness,
        args.spill_suppression,
    )?;
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
                "matte_color": color_to_hex(matte_color),
                "spill_suppression": args.spill_suppression,
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

fn generate_source_image(
    cli: &Cli,
    selection: &ProviderSelection,
    shared: &SharedImageArgs,
) -> Result<Value, AppError> {
    if matches!(selection.kind, ProviderKind::OpenAi) {
        generate_openai_source_image(cli, selection, shared)
    } else {
        generate_codex_source_image(cli, selection, shared)
    }
}

fn generate_openai_source_image(
    cli: &Cli,
    selection: &ProviderSelection,
    shared: &SharedImageArgs,
) -> Result<Value, AppError> {
    let auth_state = load_openai_auth_state_for(cli, selection)?;
    let resolved_model = shared
        .model
        .clone()
        .unwrap_or_else(|| selection.default_model.clone());
    let body = build_openai_image_body(
        "generate",
        &shared.prompt,
        &resolved_model,
        &[],
        None,
        None,
        shared.background,
        shared.size.as_deref(),
        shared.quality,
        shared.output_format,
        shared.output_compression,
        shared.n,
        shared.moderation,
    );
    let endpoint = build_openai_operation_endpoint(&selection.api_base, "generate")?;
    let mut logger = JsonEventLogger::new(cli.json_events);
    let (payload, retry_count) =
        execute_openai_with_retry(&mut logger, &selection.resolved, |logger| {
            request_openai_images_once(&endpoint, &auth_state, &body, logger)
        })?;
    let (image_bytes_list, revised_prompts) = decode_openai_images(&payload)?;
    if image_bytes_list.is_empty() {
        return Err(AppError::new(
            "missing_image_result",
            "The response did not include a generated image.",
        ));
    }
    let saved_files = save_images(Path::new(&shared.out), &image_bytes_list)?;
    emit_progress_event(
        &mut logger,
        "openai",
        "source_saved",
        "Controlled transparent-PNG source image saved.",
        "completed",
        Some(50),
        json!({
            "file_count": saved_files.len(),
            "output": normalize_saved_output(&saved_files),
        }),
    );
    Ok(json!({
        "provider": selection.resolved,
        "provider_selection": selection.payload(),
        "request": summarize_image_request_options("openai", "generate", &resolved_model, shared, 0, false, None),
        "response": {
            "created": payload.get("created"),
            "background": payload.get("background"),
            "output_format": payload.get("output_format"),
            "quality": payload.get("quality"),
            "size": payload.get("size"),
            "image_count": image_bytes_list.len(),
            "revised_prompts": revised_prompts.into_iter().flatten().collect::<Vec<_>>(),
        },
        "output": normalize_saved_output(&saved_files),
        "retry": {
            "count": retry_count,
            "max_retries": DEFAULT_RETRY_COUNT,
        },
        "events": {
            "count": logger.seq,
        }
    }))
}

fn generate_codex_source_image(
    cli: &Cli,
    selection: &ProviderSelection,
    shared: &SharedImageArgs,
) -> Result<Value, AppError> {
    let mut auth_state = load_codex_auth_state_for(cli, selection)?;
    let resolved_model = shared
        .model
        .clone()
        .unwrap_or_else(|| selection.default_model.clone());
    let body = build_codex_image_body(
        &shared.prompt,
        &resolved_model,
        &shared.instructions,
        &[],
        shared.background,
        shared.size.as_deref(),
        shared.quality,
        shared.output_format,
        shared.output_compression,
        "generate",
    );
    let mut logger = JsonEventLogger::new(cli.json_events);
    let (outcome, auth_refreshed, retry_count) = request_codex_with_retry(
        &selection.codex_endpoint,
        &mut auth_state,
        &body,
        &mut logger,
    )?;
    let output_items = outcome
        .get("output_items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let image_items = extract_codex_image_items(&output_items);
    if image_items.is_empty() {
        return Err(AppError::new(
            "missing_image_result",
            "The response did not include an image_generation_call result.",
        ));
    }
    let image_bytes_list: Vec<Vec<u8>> = image_items
        .iter()
        .filter_map(|item| item.get("result").and_then(Value::as_str))
        .map(decode_base64_bytes)
        .collect::<Result<_, _>>()?;
    let saved_files = save_images(Path::new(&shared.out), &image_bytes_list)?;
    emit_progress_event(
        &mut logger,
        "codex",
        "source_saved",
        "Controlled transparent-PNG source image saved.",
        "completed",
        Some(50),
        json!({
            "file_count": saved_files.len(),
            "output": normalize_saved_output(&saved_files),
        }),
    );
    let response_meta = outcome
        .get("response")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let revised_prompts = image_items
        .iter()
        .filter_map(|item| item.get("revised_prompt").and_then(Value::as_str))
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    Ok(json!({
        "provider": selection.resolved,
        "provider_selection": selection.payload(),
        "request": summarize_image_request_options("codex", "generate", &resolved_model, shared, 0, false, None),
        "response": {
            "response_id": response_meta.get("id"),
            "model": response_meta.get("model"),
            "service_tier": response_meta.get("service_tier"),
            "status": response_meta.get("status"),
            "image_count": image_items.len(),
            "item_ids": image_items.iter().map(|item| item.get("id").cloned().unwrap_or(Value::Null)).collect::<Vec<_>>(),
            "revised_prompts": revised_prompts,
        },
        "output": normalize_saved_output(&saved_files),
        "retry": {
            "count": retry_count,
            "max_retries": DEFAULT_RETRY_COUNT,
        },
        "auth": {
            "source": match &auth_state.persistence {
                CodexAuthPersistence::AuthFile => "auth.json",
                CodexAuthPersistence::ConfigProvider { .. } => "config",
                CodexAuthPersistence::SessionOnly => "session",
            },
            "auth_file": auth_state.auth_path.display().to_string(),
            "account_id": auth_state.account_id,
            "refreshed": auth_refreshed,
        },
        "events": {
            "count": logger.seq,
        }
    }))
}

fn run_transparent_extract(args: &TransparentExtractArgs) -> Result<CommandOutcome, AppError> {
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
            let matte = args
                .matte_color
                .as_deref()
                .map(parse_matte_color)
                .transpose()?;
            extract_chroma_file(
                Path::new(input),
                &output_path,
                matte,
                args.threshold,
                args.softness,
                args.spill_suppression,
            )?
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

fn run_transparent_verify(args: &TransparentVerifyArgs) -> Result<CommandOutcome, AppError> {
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

fn resolve_extract_method(
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

fn extract_chroma_file(
    input_path: &Path,
    output_path: &Path,
    matte_color: Option<[u8; 3]>,
    threshold: f32,
    softness: f32,
    spill_suppression: f32,
) -> Result<ExtractionReport, AppError> {
    let image = read_image(input_path)?.to_rgba8();
    let matte = matte_color.unwrap_or_else(|| estimate_matte_color(&image));
    let mut output = extract_chroma(&image, matte, threshold, softness, spill_suppression);
    scrub_transparent_rgb(&mut output);
    save_rgba_png(output_path, &output)?;
    Ok(ExtractionReport {
        method: "chroma".to_string(),
        inputs: json!({
            "input": input_path.display().to_string(),
        }),
        output: output_file_value(output_path),
        matte_color: Some(color_to_hex(matte)),
        threshold: Some(threshold),
        softness: Some(softness),
        spill_suppression: Some(spill_suppression),
        matte_decontamination_applied: true,
        rgb_scrubbed: true,
        dual_alignment: None,
    })
}

fn extract_dual_file(
    dark_path: &Path,
    light_path: &Path,
    output_path: &Path,
) -> Result<ExtractionReport, AppError> {
    let dark = read_image(dark_path)?.to_rgba8();
    let light = read_image(light_path)?.to_rgba8();
    if dark.dimensions() != light.dimensions() {
        return Err(AppError::new(
            "transparent_input_mismatch",
            "Dual-background images must have identical dimensions.",
        )
        .with_detail(json!({
            "dark_image": dark_path.display().to_string(),
            "light_image": light_path.display().to_string(),
            "dark_size": {"width": dark.width(), "height": dark.height()},
            "light_size": {"width": light.width(), "height": light.height()},
        })));
    }
    let dual_alignment = dual_alignment_report(&dark, &light);
    let mut output = extract_dual(&dark, &light);
    scrub_transparent_rgb(&mut output);
    save_rgba_png(output_path, &output)?;
    Ok(ExtractionReport {
        method: "dual".to_string(),
        inputs: json!({
            "dark_image": dark_path.display().to_string(),
            "light_image": light_path.display().to_string(),
        }),
        output: output_file_value(output_path),
        matte_color: None,
        threshold: None,
        softness: None,
        spill_suppression: None,
        matte_decontamination_applied: false,
        rgb_scrubbed: true,
        dual_alignment: Some(dual_alignment),
    })
}

fn extract_chroma(
    image: &RgbaImage,
    matte: [u8; 3],
    threshold: f32,
    softness: f32,
    spill_suppression: f32,
) -> RgbaImage {
    let low = threshold.max(0.0);
    let high = (threshold + softness.max(1.0)).max(low + 1.0);
    let mut output = RgbaImage::new(image.width(), image.height());
    for (x, y, pixel) in output.enumerate_pixels_mut() {
        let source = image.get_pixel(x, y).0;
        let distance = color_distance([source[0], source[1], source[2]], matte);
        let t = ((distance - low) / (high - low)).clamp(0.0, 1.0);
        let smoothed = t * t * (3.0 - 2.0 * t);
        let alpha = (smoothed * 255.0).round().clamp(0.0, 255.0) as u8;
        *pixel = decontaminate_pixel(source, matte, alpha, spill_suppression);
    }
    output
}

fn extract_dual(dark: &RgbaImage, light: &RgbaImage) -> RgbaImage {
    let mut output = RgbaImage::new(dark.width(), dark.height());
    for (x, y, pixel) in output.enumerate_pixels_mut() {
        let d = dark.get_pixel(x, y).0;
        let l = light.get_pixel(x, y).0;
        let delta = (0..3)
            .map(|channel| (l[channel] as f32 - d[channel] as f32).clamp(0.0, 255.0))
            .sum::<f32>()
            / 3.0;
        let alpha_f = (1.0 - delta / 255.0).clamp(0.0, 1.0);
        let alpha = (alpha_f * 255.0).round().clamp(0.0, 255.0) as u8;
        if alpha <= TRANSPARENT_ALPHA_MAX {
            *pixel = Rgba([0, 0, 0, 0]);
        } else {
            let mut out = [0u8; 4];
            for channel in 0..3 {
                out[channel] = (d[channel] as f32 / alpha_f.max(0.001))
                    .round()
                    .clamp(0.0, 255.0) as u8;
            }
            out[3] = alpha;
            *pixel = Rgba(out);
        }
    }
    output
}

fn verify_transparent_file(
    path: &Path,
    options: VerificationOptions,
) -> Result<TransparentVerification, AppError> {
    let decoded = read_image(path)?;
    let is_png = is_png_file(path);
    let color_type = format!("{:?}", decoded.color());
    let input_has_alpha = decoded.color().has_alpha();
    let rgba = decoded.to_rgba8();
    let width = rgba.width();
    let height = rgba.height();
    let total = u64::from(width) * u64::from(height);
    let mut alpha_min = u8::MAX;
    let mut alpha_max = u8::MIN;
    let mut transparent_pixels = 0u64;
    let mut partial_pixels = 0u64;
    let mut opaque_pixels = 0u64;
    let mut nontransparent_pixels = 0u64;
    let mut edge_nontransparent_pixels = 0u64;
    let mut min_x = width;
    let mut min_y = height;
    let mut max_x = 0u32;
    let mut max_y = 0u32;
    let transparent_rgb_scrubbed = transparent_rgb_scrubbed(&rgba);

    for (x, y, pixel) in rgba.enumerate_pixels() {
        let alpha = pixel.0[3];
        alpha_min = alpha_min.min(alpha);
        alpha_max = alpha_max.max(alpha);
        if alpha <= TRANSPARENT_ALPHA_MAX {
            transparent_pixels += 1;
        } else {
            nontransparent_pixels += 1;
            min_x = min_x.min(x);
            min_y = min_y.min(y);
            max_x = max_x.max(x);
            max_y = max_y.max(y);
            if x == 0 || y == 0 || x + 1 == width || y + 1 == height {
                edge_nontransparent_pixels += 1;
            }
            if alpha >= 250 {
                opaque_pixels += 1;
            } else {
                partial_pixels += 1;
            }
        }
    }

    let transparent_ratio = ratio(transparent_pixels, total);
    let partial_ratio = ratio(partial_pixels, total);
    let opaque_ratio = ratio(opaque_pixels, total);
    let edge_pixels = if width == 0 || height == 0 {
        0
    } else if width == 1 || height == 1 {
        total
    } else {
        u64::from(width) * 2 + u64::from(height.saturating_sub(2)) * 2
    };
    let edge_nontransparent_ratio = ratio(edge_nontransparent_pixels, edge_pixels);
    let bbox = if nontransparent_pixels == 0 {
        None
    } else {
        Some(AlphaBoundingBox {
            x: min_x,
            y: min_y,
            width: max_x - min_x + 1,
            height: max_y - min_y + 1,
        })
    };
    let edge_margin_px = bbox.as_ref().map(|bbox| {
        let right = width.saturating_sub(bbox.x.saturating_add(bbox.width));
        let bottom = height.saturating_sub(bbox.y.saturating_add(bbox.height));
        bbox.x.min(bbox.y).min(right).min(bottom)
    });
    let touches_edge = edge_margin_px == Some(0);
    let component_stats = component_stats(&rgba);
    let matte_residue_checked = options.expected_matte_color.is_some();
    let matte_residue_score = options
        .expected_matte_color
        .map(|matte| matte_residue_score(&rgba, matte));
    let halo_score = halo_score(&rgba);
    let checkerboard_detected = (!input_has_alpha || transparent_ratio < MIN_TRANSPARENT_RATIO)
        && detect_checkerboard(&rgba);
    let mut warnings = Vec::new();
    if touches_edge || edge_nontransparent_ratio > 0.15 {
        warnings.push(
            "nontransparent pixels reach the image edge; consider adding margin before extraction"
                .to_string(),
        );
    }
    if partial_pixels == 0 {
        warnings.push("no semi-transparent pixels detected".to_string());
    }
    if checkerboard_detected {
        warnings.push(
            "checkerboard-like pattern detected; visual transparency is not enough".to_string(),
        );
    }
    if !transparent_rgb_scrubbed {
        warnings.push(
            "fully transparent pixels contain non-zero RGB values; scrub them to avoid compositing artifacts"
                .to_string(),
        );
    }
    if let Some(score) = matte_residue_score
        && score > 0.12
    {
        warnings.push("possible matte-color residue on semi-transparent edge pixels".to_string());
    }
    if !matte_residue_checked
        && matches!(
            options.profile,
            TransparentProfile::Icon | TransparentProfile::Product
        )
        && partial_pixels > 0
    {
        warnings.push(
            "matte residue was not checked; pass --expected-matte-color when verifying chroma outputs"
                .to_string(),
        );
    }
    let (passed, failure_reasons) = evaluate_transparency_gate(TransparencyGateInput {
        profile: options.profile,
        is_png,
        has_alpha: input_has_alpha,
        alpha_min,
        alpha_max,
        nontransparent_pixels,
        transparent_ratio,
        partial_pixels,
        touches_edge,
        largest_component_ratio: component_stats.largest_component_ratio,
        alpha_noise_score: component_stats.alpha_noise_score,
        matte_residue_score,
        checkerboard_detected,
        transparent_rgb_scrubbed,
    });
    let quality_score = quality_score(
        passed,
        touches_edge,
        component_stats.alpha_noise_score,
        matte_residue_score,
        halo_score,
        checkerboard_detected,
        transparent_rgb_scrubbed,
    );

    Ok(TransparentVerification {
        path: path.display().to_string(),
        profile: options.profile.as_str().to_string(),
        width,
        height,
        is_png,
        color_type,
        has_alpha: input_has_alpha,
        input_has_alpha,
        alpha_min,
        alpha_max,
        transparent_pixels,
        partial_pixels,
        opaque_pixels,
        nontransparent_pixels,
        transparent_ratio,
        partial_ratio,
        opaque_ratio,
        edge_nontransparent_pixels,
        edge_nontransparent_ratio,
        touches_edge,
        edge_margin_px,
        component_count: component_stats.component_count,
        largest_component_pixels: component_stats.largest_component_pixels,
        largest_component_ratio: component_stats.largest_component_ratio,
        stray_pixel_count: component_stats.stray_pixel_count,
        alpha_noise_score: component_stats.alpha_noise_score,
        matte_residue_score,
        matte_residue_checked,
        halo_score,
        transparent_rgb_scrubbed,
        checkerboard_detected,
        quality_score,
        bbox,
        passed,
        failure_reasons,
        warnings,
    })
}

#[derive(Debug, Clone, Copy)]
struct ComponentStats {
    component_count: u64,
    largest_component_pixels: u64,
    largest_component_ratio: f64,
    stray_pixel_count: u64,
    alpha_noise_score: f64,
}

fn component_stats(image: &RgbaImage) -> ComponentStats {
    let width = image.width() as usize;
    let height = image.height() as usize;
    let total = width.saturating_mul(height);
    if width == 0 || height == 0 || total == 0 {
        return ComponentStats {
            component_count: 0,
            largest_component_pixels: 0,
            largest_component_ratio: 0.0,
            stray_pixel_count: 0,
            alpha_noise_score: 0.0,
        };
    }
    let mut visited = vec![false; total];
    let mut component_count = 0u64;
    let mut largest = 0u64;
    let mut nontransparent = 0u64;
    let mut stack = Vec::new();
    for y in 0..height {
        for x in 0..width {
            let index = y * width + x;
            if visited[index] || image.get_pixel(x as u32, y as u32).0[3] <= TRANSPARENT_ALPHA_MAX {
                continue;
            }
            component_count += 1;
            let mut count = 0u64;
            visited[index] = true;
            stack.push((x, y));
            while let Some((cx, cy)) = stack.pop() {
                count += 1;
                for ny in cy.saturating_sub(1)..=(cy + 1).min(height - 1) {
                    for nx in cx.saturating_sub(1)..=(cx + 1).min(width - 1) {
                        let next = ny * width + nx;
                        if visited[next]
                            || image.get_pixel(nx as u32, ny as u32).0[3] <= TRANSPARENT_ALPHA_MAX
                        {
                            continue;
                        }
                        visited[next] = true;
                        stack.push((nx, ny));
                    }
                }
            }
            nontransparent += count;
            largest = largest.max(count);
        }
    }
    let stray = nontransparent.saturating_sub(largest);
    ComponentStats {
        component_count,
        largest_component_pixels: largest,
        largest_component_ratio: ratio(largest, nontransparent),
        stray_pixel_count: stray,
        alpha_noise_score: ratio(stray, nontransparent),
    }
}

struct TransparencyGateInput {
    profile: TransparentProfile,
    is_png: bool,
    has_alpha: bool,
    alpha_min: u8,
    alpha_max: u8,
    nontransparent_pixels: u64,
    transparent_ratio: f64,
    partial_pixels: u64,
    touches_edge: bool,
    largest_component_ratio: f64,
    alpha_noise_score: f64,
    matte_residue_score: Option<f64>,
    checkerboard_detected: bool,
    transparent_rgb_scrubbed: bool,
}

fn evaluate_transparency_gate(input: TransparencyGateInput) -> (bool, Vec<String>) {
    let mut failures = Vec::new();
    if !input.is_png {
        failures.push("not_png".to_string());
    }
    if !input.has_alpha {
        failures.push("missing_alpha_channel".to_string());
    }
    if input.checkerboard_detected {
        failures.push("checkerboard_detected".to_string());
    }
    if input.nontransparent_pixels == 0 {
        failures.push("empty_subject".to_string());
    }
    if input.alpha_min > TRANSPARENT_ALPHA_MAX {
        failures.push("no_fully_transparent_pixels".to_string());
    }
    if input.alpha_max < NONTRANSPARENT_ALPHA_MIN {
        failures.push("alpha_range_too_low".to_string());
    }
    if input.transparent_ratio < MIN_TRANSPARENT_RATIO {
        failures.push("transparent_area_too_small".to_string());
    }
    if !input.transparent_rgb_scrubbed {
        failures.push("transparent_rgb_not_scrubbed".to_string());
    }

    match input.profile {
        TransparentProfile::Generic => {}
        TransparentProfile::Icon | TransparentProfile::Product => {
            if input.alpha_max < MIN_OPAQUE_ALPHA {
                failures.push("profile_requires_opaque_pixels".to_string());
            }
            if input.transparent_ratio < STRICT_MIN_TRANSPARENT_RATIO {
                failures.push("profile_transparent_area_too_small".to_string());
            }
            if input.touches_edge {
                failures.push("subject_touches_edge".to_string());
            }
            if input.largest_component_ratio < 0.92 || input.alpha_noise_score > 0.08 {
                failures.push("too_many_stray_pixels".to_string());
            }
            if let Some(score) = input.matte_residue_score
                && score > 0.18
            {
                failures.push("matte_residue_too_high".to_string());
            }
        }
        TransparentProfile::Translucent | TransparentProfile::Glow | TransparentProfile::Shadow => {
            if input.partial_pixels == 0 {
                failures.push("profile_requires_partial_alpha".to_string());
            }
            if input.transparent_ratio < 0.02 {
                failures.push("profile_transparent_area_too_small".to_string());
            }
            if input.touches_edge {
                failures.push("effect_touches_edge".to_string());
            }
        }
    }
    (failures.is_empty(), failures)
}

fn quality_score(
    passed: bool,
    touches_edge: bool,
    alpha_noise_score: f64,
    matte_residue_score: Option<f64>,
    halo_score: f64,
    checkerboard_detected: bool,
    transparent_rgb_scrubbed: bool,
) -> f64 {
    let mut score = if passed { 1.0 } else { 0.65 };
    if touches_edge {
        score -= 0.2;
    }
    if checkerboard_detected {
        score -= 0.45;
    }
    if !transparent_rgb_scrubbed {
        score -= 0.2;
    }
    score -= alpha_noise_score.min(1.0) * 0.25;
    score -= matte_residue_score.unwrap_or(0.0).min(1.0) * 0.25;
    score -= halo_score.min(1.0) * 0.10;
    score.clamp(0.0, 1.0)
}

fn is_png_file(path: &Path) -> bool {
    fs::read(path)
        .map(|bytes| bytes.starts_with(b"\x89PNG\r\n\x1a\n"))
        .unwrap_or(false)
}

fn transparent_rgb_scrubbed(image: &RgbaImage) -> bool {
    image
        .pixels()
        .filter(|pixel| pixel.0[3] <= TRANSPARENT_ALPHA_MAX)
        .all(|pixel| pixel.0[0] <= 2 && pixel.0[1] <= 2 && pixel.0[2] <= 2)
}

fn scrub_transparent_rgb(image: &mut RgbaImage) {
    for pixel in image.pixels_mut() {
        if pixel.0[3] <= TRANSPARENT_ALPHA_MAX {
            *pixel = Rgba([0, 0, 0, 0]);
        }
    }
}

fn matte_residue_score(image: &RgbaImage, matte: [u8; 3]) -> f64 {
    let max_matte = matte.iter().copied().max().unwrap_or(0);
    let min_matte = matte.iter().copied().min().unwrap_or(0);
    let dominant_channels = (0..3)
        .filter(|&channel| matte[channel] >= max_matte.saturating_sub(8))
        .collect::<Vec<_>>();
    let other_channels = (0..3)
        .filter(|channel| !dominant_channels.contains(channel))
        .collect::<Vec<_>>();
    if max_matte >= 192 && max_matte.saturating_sub(min_matte) >= 128 && !other_channels.is_empty()
    {
        return saturated_matte_residue_score(image, &dominant_channels, &other_channels);
    }

    let mut weighted_score = 0.0f64;
    let mut total_weight = 0.0f64;
    for pixel in image.pixels() {
        let [red, green, blue, alpha] = pixel.0;
        if alpha <= TRANSPARENT_ALPHA_MAX || alpha >= MIN_OPAQUE_ALPHA {
            continue;
        }
        let alpha_weight = 1.0 - f64::from(alpha) / 255.0;
        let similarity = 1.0
            - f64::from(color_distance([red, green, blue], matte)) / (255.0_f64 * 3.0_f64.sqrt());
        weighted_score += similarity.clamp(0.0, 1.0) * alpha_weight;
        total_weight += alpha_weight;
    }
    if total_weight == 0.0 {
        0.0
    } else {
        weighted_score / total_weight
    }
}

fn saturated_matte_residue_score(
    image: &RgbaImage,
    dominant_channels: &[usize],
    other_channels: &[usize],
) -> f64 {
    let mut weighted_score = 0.0f64;
    let mut total_weight = 0.0f64;
    for pixel in image.pixels() {
        let [red, green, blue, alpha] = pixel.0;
        if alpha <= TRANSPARENT_ALPHA_MAX || alpha >= MIN_OPAQUE_ALPHA {
            continue;
        }
        let rgb = [red, green, blue];
        let alpha_weight = 1.0 - f64::from(alpha) / 255.0;
        let reference = other_channels
            .iter()
            .map(|&channel| rgb[channel])
            .max()
            .unwrap_or(0);
        let excess = dominant_channels
            .iter()
            .map(|&channel| rgb[channel].saturating_sub(reference))
            .map(f64::from)
            .sum::<f64>()
            / dominant_channels.len() as f64;
        weighted_score += (excess / 255.0) * alpha_weight;
        total_weight += alpha_weight;
    }
    if total_weight == 0.0 {
        0.0
    } else {
        weighted_score / total_weight
    }
}

fn halo_score(image: &RgbaImage) -> f64 {
    let mut halo_pixels = 0u64;
    let mut sampled_pixels = 0u64;
    for pixel in image.pixels() {
        let [red, green, blue, alpha] = pixel.0;
        if alpha <= TRANSPARENT_ALPHA_MAX || alpha >= MIN_OPAQUE_ALPHA {
            continue;
        }
        sampled_pixels += 1;
        let luma = (0.2126 * f64::from(red) + 0.7152 * f64::from(green) + 0.0722 * f64::from(blue))
            / 255.0;
        let chroma = f64::from(red.max(green).max(blue) - red.min(green).min(blue)) / 255.0;
        if !(0.04..=0.96).contains(&luma) && chroma < 0.08 {
            halo_pixels += 1;
        }
    }
    ratio(halo_pixels, sampled_pixels)
}

fn detect_checkerboard(image: &RgbaImage) -> bool {
    let width = image.width();
    let height = image.height();
    if width < 32 || height < 32 {
        return false;
    }
    [8u32, 16, 32]
        .into_iter()
        .any(|cell_size| checkerboard_at_cell_size(image, cell_size))
}

fn checkerboard_at_cell_size(image: &RgbaImage, cell_size: u32) -> bool {
    let cells_x = image.width() / cell_size;
    let cells_y = image.height() / cell_size;
    if cells_x < 4 || cells_y < 4 {
        return false;
    }
    let mut sums = [[0f64; 3]; 2];
    let mut counts = [0f64; 2];
    let mut cell_colors = Vec::with_capacity((cells_x * cells_y) as usize);
    for cy in 0..cells_y {
        for cx in 0..cells_x {
            let color = average_cell_color(image, cx * cell_size, cy * cell_size, cell_size);
            let parity = ((cx + cy) % 2) as usize;
            for channel in 0..3 {
                sums[parity][channel] += f64::from(color[channel]);
            }
            counts[parity] += 1.0;
            cell_colors.push((parity, color));
        }
    }
    if counts[0] == 0.0 || counts[1] == 0.0 {
        return false;
    }
    let means = [
        [
            sums[0][0] / counts[0],
            sums[0][1] / counts[0],
            sums[0][2] / counts[0],
        ],
        [
            sums[1][0] / counts[1],
            sums[1][1] / counts[1],
            sums[1][2] / counts[1],
        ],
    ];
    let mean_distance = color_distance_f64(means[0], means[1]);
    if mean_distance < 25.0 {
        return false;
    }
    let mut squared_error = 0.0f64;
    let mut samples = 0.0f64;
    for (parity, color) in cell_colors {
        for channel in 0..3 {
            let delta = f64::from(color[channel]) - means[parity][channel];
            squared_error += delta * delta;
            samples += 1.0;
        }
    }
    let rmse = (squared_error / samples.max(1.0)).sqrt();
    rmse < 18.0
}

fn average_cell_color(image: &RgbaImage, start_x: u32, start_y: u32, cell_size: u32) -> [u8; 3] {
    let end_x = (start_x + cell_size).min(image.width());
    let end_y = (start_y + cell_size).min(image.height());
    let mut sums = [0u64; 3];
    let mut count = 0u64;
    for y in start_y..end_y {
        for x in start_x..end_x {
            let pixel = image.get_pixel(x, y).0;
            for channel in 0..3 {
                sums[channel] += u64::from(pixel[channel]);
            }
            count += 1;
        }
    }
    if count == 0 {
        return [0, 0, 0];
    }
    [
        (sums[0] / count) as u8,
        (sums[1] / count) as u8,
        (sums[2] / count) as u8,
    ]
}

fn color_distance_f64(a: [f64; 3], b: [f64; 3]) -> f64 {
    let red = a[0] - b[0];
    let green = a[1] - b[1];
    let blue = a[2] - b[2];
    (red * red + green * green + blue * blue).sqrt()
}

fn dual_alignment_report(dark: &RgbaImage, light: &RgbaImage) -> DualAlignmentReport {
    let mut negative_channels = 0u64;
    let mut total_channels = 0u64;
    let mut noise_sum = 0.0f64;
    let mut pixel_count = 0u64;
    for (dark_pixel, light_pixel) in dark.pixels().zip(light.pixels()) {
        let dark_rgb = dark_pixel.0;
        let light_rgb = light_pixel.0;
        let deltas = [
            f64::from(light_rgb[0]) - f64::from(dark_rgb[0]),
            f64::from(light_rgb[1]) - f64::from(dark_rgb[1]),
            f64::from(light_rgb[2]) - f64::from(dark_rgb[2]),
        ];
        for delta in deltas {
            if delta < -2.0 {
                negative_channels += 1;
            }
            total_channels += 1;
        }
        let mean = (deltas[0] + deltas[1] + deltas[2]) / 3.0;
        let variance = deltas
            .iter()
            .map(|delta| {
                let centered = delta - mean;
                centered * centered
            })
            .sum::<f64>()
            / 3.0;
        noise_sum += variance.sqrt() / 255.0;
        pixel_count += 1;
    }
    let negative_delta_ratio = ratio(negative_channels, total_channels);
    let delta_channel_noise = if pixel_count == 0 {
        0.0
    } else {
        noise_sum / pixel_count as f64
    };
    let score = (1.0 - negative_delta_ratio * 1.5 - delta_channel_noise * 1.2).clamp(0.0, 1.0);
    DualAlignmentReport {
        score,
        passed: score >= 0.55,
        negative_delta_ratio,
        delta_channel_noise,
        color_space: "srgb".to_string(),
    }
}

fn read_image(path: &Path) -> Result<DynamicImage, AppError> {
    ImageReader::open(path)
        .map_err(|error| {
            AppError::new("image_read_failed", "Unable to open image file.").with_detail(json!({
                "path": path.display().to_string(),
                "error": error.to_string(),
            }))
        })?
        .with_guessed_format()
        .map_err(|error| {
            AppError::new("image_read_failed", "Unable to detect image format.").with_detail(
                json!({
                    "path": path.display().to_string(),
                    "error": error.to_string(),
                }),
            )
        })?
        .decode()
        .map_err(|error| {
            AppError::new("image_decode_failed", "Unable to decode image file.").with_detail(
                json!({
                    "path": path.display().to_string(),
                    "error": error.to_string(),
                }),
            )
        })
}

fn save_rgba_png(path: &Path, image: &RgbaImage) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            AppError::new("output_write_failed", "Unable to create output directory.").with_detail(
                json!({ "error": error.to_string(), "path": parent.display().to_string() }),
            )
        })?;
    }
    image.save(path).map_err(|error| {
        AppError::new("output_write_failed", "Unable to write transparent PNG.")
            .with_detail(json!({ "error": error.to_string(), "path": path.display().to_string() }))
    })
}

fn decontaminate_pixel(
    source: [u8; 4],
    matte: [u8; 3],
    alpha: u8,
    spill_suppression: f32,
) -> Rgba<u8> {
    if alpha <= TRANSPARENT_ALPHA_MAX {
        return Rgba([0, 0, 0, 0]);
    }
    let alpha_f = f32::from(alpha) / 255.0;
    let mut output = [0u8; 4];
    for channel in 0..3 {
        output[channel] = ((f32::from(source[channel])
            - f32::from(matte[channel]) * (1.0 - alpha_f))
            / alpha_f.max(0.001))
        .round()
        .clamp(0.0, 255.0) as u8;
    }
    suppress_matte_spill(&mut output, matte, alpha, spill_suppression);
    output[3] = alpha.min(source[3]);
    Rgba(output)
}

fn suppress_matte_spill(rgb_alpha: &mut [u8; 4], matte: [u8; 3], alpha: u8, amount: f32) {
    let amount = amount.clamp(0.0, 1.0);
    if amount <= 0.0 || alpha <= TRANSPARENT_ALPHA_MAX {
        return;
    }
    let max_matte = matte.iter().copied().max().unwrap_or(0);
    let min_matte = matte.iter().copied().min().unwrap_or(0);
    if max_matte < 192 || max_matte.saturating_sub(min_matte) < 128 {
        return;
    }
    let dominant_channels = (0..3)
        .filter(|&channel| matte[channel] >= max_matte.saturating_sub(8))
        .collect::<Vec<_>>();
    let other_channels = (0..3)
        .filter(|channel| !dominant_channels.contains(channel))
        .collect::<Vec<_>>();
    if dominant_channels.is_empty() || other_channels.is_empty() {
        return;
    }

    let rgb = [rgb_alpha[0], rgb_alpha[1], rgb_alpha[2]];
    let max_distance = 255.0_f32 * 3.0_f32.sqrt();
    let matte_similarity = (1.0 - color_distance(rgb, matte) / max_distance).clamp(0.0, 1.0);
    let alpha_edge_factor = (1.0 - f32::from(alpha) / 255.0).clamp(0.0, 1.0).sqrt();
    let strength = amount * matte_similarity.sqrt().max(alpha_edge_factor);
    if strength <= 0.01 {
        return;
    }

    let reference = other_channels
        .iter()
        .map(|&channel| rgb_alpha[channel])
        .max()
        .unwrap_or(0);
    for channel in dominant_channels {
        if rgb_alpha[channel] <= reference {
            continue;
        }
        let excess = f32::from(rgb_alpha[channel] - reference);
        rgb_alpha[channel] = (f32::from(rgb_alpha[channel]) - excess * strength)
            .round()
            .clamp(0.0, 255.0) as u8;
    }
}

fn estimate_matte_color(image: &RgbaImage) -> [u8; 3] {
    let width = image.width();
    let height = image.height();
    let sample = width.min(height).clamp(1, 32);
    let mut red = Vec::new();
    let mut green = Vec::new();
    let mut blue = Vec::new();
    for y in 0..sample {
        for x in 0..sample {
            push_rgb(image.get_pixel(x, y).0, &mut red, &mut green, &mut blue);
            push_rgb(
                image.get_pixel(width - 1 - x, y).0,
                &mut red,
                &mut green,
                &mut blue,
            );
            push_rgb(
                image.get_pixel(x, height - 1 - y).0,
                &mut red,
                &mut green,
                &mut blue,
            );
            push_rgb(
                image.get_pixel(width - 1 - x, height - 1 - y).0,
                &mut red,
                &mut green,
                &mut blue,
            );
        }
    }
    [median(red), median(green), median(blue)]
}

fn push_rgb(pixel: [u8; 4], red: &mut Vec<u8>, green: &mut Vec<u8>, blue: &mut Vec<u8>) {
    red.push(pixel[0]);
    green.push(pixel[1]);
    blue.push(pixel[2]);
}

fn median(mut values: Vec<u8>) -> u8 {
    if values.is_empty() {
        return 0;
    }
    values.sort_unstable();
    values[values.len() / 2]
}

fn color_distance(a: [u8; 3], b: [u8; 3]) -> f32 {
    let r = f32::from(a[0]) - f32::from(b[0]);
    let g = f32::from(a[1]) - f32::from(b[1]);
    let b = f32::from(a[2]) - f32::from(b[2]);
    (r * r + g * g + b * b).sqrt()
}

fn parse_matte_color(value: &str) -> Result<[u8; 3], AppError> {
    let normalized = value.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "black" => return Ok([0, 0, 0]),
        "white" => return Ok([255, 255, 255]),
        "green" | "chroma-green" => return Ok([0, 255, 0]),
        "magenta" => return Ok([255, 0, 255]),
        "cyan" => return Ok([0, 255, 255]),
        "blue" => return Ok([0, 0, 255]),
        _ => {}
    }
    let hex = normalized.strip_prefix('#').unwrap_or(&normalized);
    if hex.len() != 6 {
        return Err(AppError::new(
            "invalid_argument",
            "Matte color must be a named color or #RRGGBB.",
        )
        .with_detail(json!({ "value": value })));
    }
    let red = u8::from_str_radix(&hex[0..2], 16).map_err(|_| invalid_color_error(value))?;
    let green = u8::from_str_radix(&hex[2..4], 16).map_err(|_| invalid_color_error(value))?;
    let blue = u8::from_str_radix(&hex[4..6], 16).map_err(|_| invalid_color_error(value))?;
    Ok([red, green, blue])
}

fn invalid_color_error(value: &str) -> AppError {
    AppError::new(
        "invalid_argument",
        "Matte color must be a named color or #RRGGBB.",
    )
    .with_detail(json!({ "value": value }))
}

fn parse_unit_float(value: &str) -> Result<f32, String> {
    let parsed = value
        .parse::<f32>()
        .map_err(|error| format!("must be a number from 0 to 1: {error}"))?;
    if (0.0..=1.0).contains(&parsed) {
        Ok(parsed)
    } else {
        Err("must be between 0 and 1".to_string())
    }
}

fn color_to_hex(color: [u8; 3]) -> String {
    format!("#{:02x}{:02x}{:02x}", color[0], color[1], color[2])
}

fn output_file_value(path: &Path) -> Value {
    let bytes = fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    json!({
        "path": path.display().to_string(),
        "bytes": bytes,
        "files": [{
            "index": 0,
            "path": path.display().to_string(),
            "bytes": bytes,
        }]
    })
}

fn normalize_png_output_path(path: &Path) -> PathBuf {
    if path.extension().is_none() {
        path.with_extension("png")
    } else {
        path.to_path_buf()
    }
}

fn source_output_path(
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

fn controlled_matte_prompt(prompt: &str, matte: [u8; 3]) -> String {
    format!(
        "{prompt}\n\nExtraction setup: render exactly one isolated asset, centered with a clear margin, on a perfectly flat uniform matte background of pure {matte}. Do not use gradients, texture, vignette, shadows, reflections, contact shadows, scenery, props, labels, frames, or background-colored details. Keep the full subject visible and separated from the matte.",
        matte = color_to_hex(matte)
    )
}

fn ratio(count: u64, total: u64) -> f64 {
    if total == 0 {
        0.0
    } else {
        count as f64 / total as f64
    }
}

fn verification_failed_error(verification: &TransparentVerification) -> AppError {
    AppError::new(
        "transparent_verification_failed",
        "Transparent PNG verification failed.",
    )
    .with_detail(json!({ "verification": verification }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chroma_extraction_creates_real_alpha() {
        let temp_dir = tempfile::tempdir().unwrap();
        let input_path = temp_dir.path().join("input.png");
        let output_path = temp_dir.path().join("output.png");
        let mut input = RgbaImage::from_pixel(64, 64, Rgba([0, 255, 0, 255]));
        for y in 18..46 {
            for x in 18..46 {
                input.put_pixel(x, y, Rgba([220, 20, 20, 255]));
            }
        }
        input.save(&input_path).unwrap();

        extract_chroma_file(
            &input_path,
            &output_path,
            Some([0, 255, 0]),
            DEFAULT_CHROMA_THRESHOLD,
            DEFAULT_CHROMA_SOFTNESS,
            DEFAULT_SPILL_SUPPRESSION,
        )
        .unwrap();
        let verification = verify_transparent_file(
            &output_path,
            VerificationOptions {
                expected_matte_color: Some([0, 255, 0]),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(verification.passed);
        assert_eq!(verification.alpha_min, 0);
        assert_eq!(verification.alpha_max, 255);
        assert!(verification.matte_residue_checked);
    }

    #[test]
    fn chroma_spill_suppression_reduces_green_edge() {
        let temp_dir = tempfile::tempdir().unwrap();
        let weak_path = temp_dir.path().join("weak.png");
        let strong_path = temp_dir.path().join("strong.png");
        let mut input = RgbaImage::from_pixel(64, 64, Rgba([0, 255, 0, 255]));
        for y in 16..48 {
            for x in 16..48 {
                input.put_pixel(x, y, Rgba([20, 230, 40, 255]));
            }
        }

        let mut weak = extract_chroma(
            &input,
            [0, 255, 0],
            DEFAULT_CHROMA_THRESHOLD,
            DEFAULT_CHROMA_SOFTNESS,
            0.0,
        );
        let mut strong = extract_chroma(
            &input,
            [0, 255, 0],
            DEFAULT_CHROMA_THRESHOLD,
            DEFAULT_CHROMA_SOFTNESS,
            1.0,
        );
        scrub_transparent_rgb(&mut weak);
        scrub_transparent_rgb(&mut strong);
        weak.save(&weak_path).unwrap();
        strong.save(&strong_path).unwrap();

        let weak_verification = verify_transparent_file(
            &weak_path,
            VerificationOptions {
                profile: TransparentProfile::Icon,
                expected_matte_color: Some([0, 255, 0]),
            },
        )
        .unwrap();
        let strong_verification = verify_transparent_file(
            &strong_path,
            VerificationOptions {
                profile: TransparentProfile::Icon,
                expected_matte_color: Some([0, 255, 0]),
            },
        )
        .unwrap();
        assert!(
            strong_verification.matte_residue_score.unwrap_or_default()
                < weak_verification.matte_residue_score.unwrap_or_default()
        );
    }

    #[test]
    fn verification_reports_when_matte_residue_was_not_checked() {
        let temp_dir = tempfile::tempdir().unwrap();
        let input_path = temp_dir.path().join("soft.png");
        let mut input = RgbaImage::from_pixel(64, 64, Rgba([0, 0, 0, 0]));
        for y in 18..46 {
            for x in 18..46 {
                let alpha = if x == 18 || x == 45 || y == 18 || y == 45 {
                    128
                } else {
                    255
                };
                input.put_pixel(x, y, Rgba([220, 20, 20, alpha]));
            }
        }
        input.save(&input_path).unwrap();

        let verification = verify_transparent_file(
            &input_path,
            VerificationOptions {
                profile: TransparentProfile::Icon,
                ..Default::default()
            },
        )
        .unwrap();
        assert!(verification.passed);
        assert!(!verification.matte_residue_checked);
        assert!(
            verification
                .warnings
                .iter()
                .any(|warning| warning.contains("matte residue was not checked"))
        );
    }

    #[test]
    fn dual_extraction_recovers_semi_transparent_alpha() {
        let temp_dir = tempfile::tempdir().unwrap();
        let dark_path = temp_dir.path().join("dark.png");
        let light_path = temp_dir.path().join("light.png");
        let output_path = temp_dir.path().join("output.png");
        let mut dark = RgbaImage::from_pixel(16, 16, Rgba([0, 0, 0, 255]));
        let mut light = RgbaImage::from_pixel(16, 16, Rgba([255, 255, 255, 255]));
        let alpha = 0.5f32;
        for y in 4..12 {
            for x in 4..12 {
                let fg = [200f32, 40f32, 20f32];
                dark.put_pixel(
                    x,
                    y,
                    Rgba([
                        (fg[0] * alpha).round() as u8,
                        (fg[1] * alpha).round() as u8,
                        (fg[2] * alpha).round() as u8,
                        255,
                    ]),
                );
                light.put_pixel(
                    x,
                    y,
                    Rgba([
                        (fg[0] * alpha + 255.0 * (1.0 - alpha)).round() as u8,
                        (fg[1] * alpha + 255.0 * (1.0 - alpha)).round() as u8,
                        (fg[2] * alpha + 255.0 * (1.0 - alpha)).round() as u8,
                        255,
                    ]),
                );
            }
        }
        dark.save(&dark_path).unwrap();
        light.save(&light_path).unwrap();

        extract_dual_file(&dark_path, &light_path, &output_path).unwrap();
        let output = read_image(&output_path).unwrap().to_rgba8();
        let center = output.get_pixel(8, 8).0;
        assert!((i16::from(center[3]) - 128).abs() <= 2);
        let verification = verify_transparent_file(
            &output_path,
            VerificationOptions {
                profile: TransparentProfile::Translucent,
                ..Default::default()
            },
        )
        .unwrap();
        assert!(verification.passed);
        assert!(verification.partial_pixels > 0);
    }

    #[test]
    fn verification_rejects_fully_opaque_png() {
        let temp_dir = tempfile::tempdir().unwrap();
        let input_path = temp_dir.path().join("opaque.png");
        RgbaImage::from_pixel(16, 16, Rgba([10, 20, 30, 255]))
            .save(&input_path)
            .unwrap();
        let verification =
            verify_transparent_file(&input_path, VerificationOptions::default()).unwrap();
        assert!(!verification.passed);
        assert_eq!(verification.transparent_pixels, 0);
    }

    #[test]
    fn verification_detects_checkerboard_fake_transparency() {
        let temp_dir = tempfile::tempdir().unwrap();
        let input_path = temp_dir.path().join("checker.png");
        let mut input = RgbaImage::new(64, 64);
        for y in 0..64 {
            for x in 0..64 {
                let value = if (x / 8 + y / 8) % 2 == 0 { 238 } else { 196 };
                input.put_pixel(x, y, Rgba([value, value, value, 255]));
            }
        }
        input.save(&input_path).unwrap();
        let verification =
            verify_transparent_file(&input_path, VerificationOptions::default()).unwrap();
        assert!(!verification.passed);
        assert!(verification.checkerboard_detected);
        assert!(
            verification
                .failure_reasons
                .contains(&"checkerboard_detected".to_string())
        );
    }

    #[test]
    fn glow_profile_requires_partial_alpha() {
        let temp_dir = tempfile::tempdir().unwrap();
        let input_path = temp_dir.path().join("hard.png");
        let mut input = RgbaImage::from_pixel(64, 64, Rgba([0, 0, 0, 0]));
        for y in 18..46 {
            for x in 18..46 {
                input.put_pixel(x, y, Rgba([220, 20, 20, 255]));
            }
        }
        input.save(&input_path).unwrap();
        let verification = verify_transparent_file(
            &input_path,
            VerificationOptions {
                profile: TransparentProfile::Glow,
                ..Default::default()
            },
        )
        .unwrap();
        assert!(!verification.passed);
        assert!(
            verification
                .failure_reasons
                .contains(&"profile_requires_partial_alpha".to_string())
        );
    }
}
