#![allow(unused_imports)]

use super::*;

pub(crate) fn resolve_chroma_settings(
    material: Option<TransparentMaterial>,
    threshold: Option<f32>,
    softness: Option<f32>,
    spill_suppression: Option<f32>,
) -> ChromaSettings {
    let preset = material
        .map(TransparentMaterial::chroma_settings)
        .unwrap_or_default();
    ChromaSettings {
        threshold: threshold.unwrap_or(preset.threshold),
        softness: softness.unwrap_or(preset.softness),
        spill_suppression: spill_suppression.unwrap_or(preset.spill_suppression),
        material,
    }
}

pub(crate) fn extract_chroma_file(
    input_path: &Path,
    output_path: &Path,
    matte_color: Option<[u8; 3]>,
    settings: ChromaSettings,
) -> Result<ExtractionReport, AppError> {
    let image = read_image(input_path)?.to_rgba8();
    let (matte, matte_color_source) = match matte_color {
        Some(color) => (color, "provided"),
        None => (estimate_matte_color(&image), "auto-sampled"),
    };
    let mut output = extract_chroma(
        &image,
        matte,
        settings.threshold,
        settings.softness,
        settings.spill_suppression,
    );
    scrub_transparent_rgb(&mut output);
    save_rgba_png(output_path, &output)?;
    Ok(ExtractionReport {
        method: "chroma".to_string(),
        inputs: json!({
            "input": input_path.display().to_string(),
        }),
        output: output_file_value(output_path),
        matte_color: Some(color_to_hex(matte)),
        matte_color_source: Some(matte_color_source.to_string()),
        threshold: Some(settings.threshold),
        softness: Some(settings.softness),
        spill_suppression: Some(settings.spill_suppression),
        material: settings
            .material
            .map(TransparentMaterial::as_str)
            .map(ToString::to_string),
        matte_decontamination_applied: true,
        rgb_scrubbed: true,
        dual_alignment: None,
    })
}

pub(crate) fn extract_dual_file(
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
        matte_color_source: None,
        threshold: None,
        softness: None,
        spill_suppression: None,
        material: None,
        matte_decontamination_applied: false,
        rgb_scrubbed: true,
        dual_alignment: Some(dual_alignment),
    })
}

pub(crate) fn extract_chroma(
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

pub(crate) fn extract_dual(dark: &RgbaImage, light: &RgbaImage) -> RgbaImage {
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

pub(crate) fn dual_alignment_report(dark: &RgbaImage, light: &RgbaImage) -> DualAlignmentReport {
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

pub(crate) fn decontaminate_pixel(
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

pub(crate) fn suppress_matte_spill(
    rgb_alpha: &mut [u8; 4],
    matte: [u8; 3],
    alpha: u8,
    amount: f32,
) {
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
