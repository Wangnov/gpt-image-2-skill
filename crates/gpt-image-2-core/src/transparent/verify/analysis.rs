#![allow(unused_imports)]

use super::*;

#[derive(Debug, Clone, Copy)]
pub(crate) struct ComponentStats {
    pub(crate) component_count: u64,
    pub(crate) largest_component_pixels: u64,
    pub(crate) largest_component_ratio: f64,
    pub(crate) stray_pixel_count: u64,
    pub(crate) alpha_noise_score: f64,
}

pub(crate) fn component_stats(image: &RgbaImage) -> ComponentStats {
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

pub(crate) struct TransparencyGateInput {
    pub(crate) profile: TransparentProfile,
    pub(crate) is_png: bool,
    pub(crate) has_alpha: bool,
    pub(crate) alpha_min: u8,
    pub(crate) alpha_max: u8,
    pub(crate) nontransparent_pixels: u64,
    pub(crate) transparent_ratio: f64,
    pub(crate) partial_pixels: u64,
    pub(crate) touches_edge: bool,
    pub(crate) largest_component_ratio: f64,
    pub(crate) alpha_noise_score: f64,
    pub(crate) matte_residue_score: Option<f64>,
    pub(crate) checkerboard_detected: bool,
    pub(crate) transparent_rgb_scrubbed: bool,
}

pub(crate) fn evaluate_transparency_gate(input: TransparencyGateInput) -> (bool, Vec<String>) {
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
        TransparentProfile::Sticker => {
            if input.alpha_max < MIN_OPAQUE_ALPHA {
                failures.push("profile_requires_opaque_pixels".to_string());
            }
            if input.transparent_ratio < STRICT_MIN_TRANSPARENT_RATIO {
                failures.push("profile_transparent_area_too_small".to_string());
            }
            if input.touches_edge {
                failures.push("subject_touches_edge".to_string());
            }
            if input.largest_component_ratio < 0.75 || input.alpha_noise_score > 0.25 {
                failures.push("too_many_stray_pixels".to_string());
            }
            if let Some(score) = input.matte_residue_score
                && score > 0.22
            {
                failures.push("matte_residue_too_high".to_string());
            }
        }
        TransparentProfile::Seal => {
            if input.alpha_max < MIN_OPAQUE_ALPHA {
                failures.push("profile_requires_opaque_pixels".to_string());
            }
            if input.transparent_ratio < STRICT_MIN_TRANSPARENT_RATIO {
                failures.push("profile_transparent_area_too_small".to_string());
            }
            if input.touches_edge {
                failures.push("subject_touches_edge".to_string());
            }
            if input.alpha_noise_score > 0.60 {
                failures.push("too_many_stray_pixels".to_string());
            }
            if let Some(score) = input.matte_residue_score
                && score > 0.24
            {
                failures.push("matte_residue_too_high".to_string());
            }
        }
        TransparentProfile::Effect => {
            if input.transparent_ratio < 0.02 {
                failures.push("profile_transparent_area_too_small".to_string());
            }
            if input.touches_edge {
                failures.push("effect_touches_edge".to_string());
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

pub(crate) fn quality_score(
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

pub(crate) struct AlphaHealthInput {
    pub(crate) is_png: bool,
    pub(crate) has_alpha: bool,
    pub(crate) alpha_min: u8,
    pub(crate) alpha_max: u8,
    pub(crate) nontransparent_pixels: u64,
    pub(crate) transparent_ratio: f64,
    pub(crate) checkerboard_detected: bool,
    pub(crate) transparent_rgb_scrubbed: bool,
}

pub(crate) fn alpha_health_score(input: AlphaHealthInput) -> f64 {
    let mut score: f64 = 1.0;
    if !input.is_png {
        score -= 0.2;
    }
    if !input.has_alpha {
        score -= 0.45;
    }
    if input.nontransparent_pixels == 0 {
        score -= 0.35;
    }
    if input.alpha_min > TRANSPARENT_ALPHA_MAX {
        score -= 0.2;
    }
    if input.alpha_max < NONTRANSPARENT_ALPHA_MIN {
        score -= 0.25;
    }
    if input.transparent_ratio < MIN_TRANSPARENT_RATIO {
        score -= 0.2;
    }
    if input.checkerboard_detected {
        score -= 0.35;
    }
    if !input.transparent_rgb_scrubbed {
        score -= 0.12;
    }
    score.clamp(0.0, 1.0)
}

pub(crate) fn residue_score(
    alpha_noise_score: f64,
    matte_residue_score: Option<f64>,
    halo_score: f64,
    touches_edge: bool,
) -> f64 {
    let mut score: f64 = 1.0;
    score -= alpha_noise_score.min(1.0) * 0.35;
    score -= matte_residue_score.unwrap_or(0.0).min(1.0) * 0.35;
    score -= halo_score.min(1.0) * 0.15;
    if touches_edge {
        score -= 0.15;
    }
    score.clamp(0.0, 1.0)
}

pub(crate) fn transparent_rgb_scrubbed(image: &RgbaImage) -> bool {
    image
        .pixels()
        .filter(|pixel| pixel.0[3] <= TRANSPARENT_ALPHA_MAX)
        .all(|pixel| pixel.0[0] <= 2 && pixel.0[1] <= 2 && pixel.0[2] <= 2)
}

pub(crate) fn matte_residue_score(image: &RgbaImage, matte: [u8; 3]) -> f64 {
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

pub(crate) fn saturated_matte_residue_score(
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

pub(crate) fn halo_score(image: &RgbaImage) -> f64 {
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

pub(crate) fn detect_checkerboard(image: &RgbaImage) -> bool {
    let width = image.width();
    let height = image.height();
    if width < 32 || height < 32 {
        return false;
    }
    [8u32, 16, 32]
        .into_iter()
        .any(|cell_size| checkerboard_at_cell_size(image, cell_size))
}

pub(crate) fn checkerboard_at_cell_size(image: &RgbaImage, cell_size: u32) -> bool {
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

pub(crate) fn average_cell_color(
    image: &RgbaImage,
    start_x: u32,
    start_y: u32,
    cell_size: u32,
) -> [u8; 3] {
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
