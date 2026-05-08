#![allow(unused_imports)]

use super::*;

pub(crate) fn verify_transparent_file(
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
            TransparentProfile::Icon
                | TransparentProfile::Product
                | TransparentProfile::Sticker
                | TransparentProfile::Seal
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
    let alpha_health_score = alpha_health_score(AlphaHealthInput {
        is_png,
        has_alpha: input_has_alpha,
        alpha_min,
        alpha_max,
        nontransparent_pixels,
        transparent_ratio,
        checkerboard_detected,
        transparent_rgb_scrubbed,
    });
    let residue_score = residue_score(
        component_stats.alpha_noise_score,
        matte_residue_score,
        halo_score,
        touches_edge,
    );
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
        alpha_health_score,
        residue_score,
        quality_score,
        bbox,
        passed,
        failure_reasons,
        warnings,
    })
}
