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
        ChromaSettings::default(),
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
fn chroma_extraction_auto_samples_near_matte() {
    let temp_dir = tempfile::tempdir().unwrap();
    let input_path = temp_dir.path().join("input.png");
    let output_path = temp_dir.path().join("output.png");
    let matte = [240, 8, 224];
    let mut input = RgbaImage::from_pixel(64, 64, Rgba([matte[0], matte[1], matte[2], 255]));
    for y in 18..46 {
        for x in 18..46 {
            input.put_pixel(x, y, Rgba([230, 180, 40, 255]));
        }
    }
    input.save(&input_path).unwrap();

    let report =
        extract_chroma_file(&input_path, &output_path, None, ChromaSettings::default()).unwrap();
    assert_eq!(report.matte_color.as_deref(), Some("#f008e0"));
    assert_eq!(report.matte_color_source.as_deref(), Some("auto-sampled"));

    let verification = verify_transparent_file(
        &output_path,
        VerificationOptions {
            profile: TransparentProfile::Icon,
            expected_matte_color: Some(matte),
        },
    )
    .unwrap();
    assert!(verification.passed);
}

#[test]
fn material_preset_can_be_overridden_per_field() {
    let settings =
        resolve_chroma_settings(Some(TransparentMaterial::Soft3d), Some(35.0), None, None);
    assert_eq!(settings.threshold, 35.0);
    assert_eq!(settings.softness, 40.0);
    assert_eq!(settings.spill_suppression, 0.20);
    assert_eq!(settings.material, Some(TransparentMaterial::Soft3d));
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
fn seal_profile_allows_deliberate_multi_component_marks() {
    let temp_dir = tempfile::tempdir().unwrap();
    let input_path = temp_dir.path().join("seal.png");
    let mut input = RgbaImage::from_pixel(80, 80, Rgba([0, 0, 0, 0]));
    for y in 18..62 {
        for x in 18..30 {
            input.put_pixel(x, y, Rgba([200, 20, 20, 255]));
        }
    }
    for y in 18..62 {
        for x in 50..62 {
            input.put_pixel(x, y, Rgba([200, 20, 20, 255]));
        }
    }
    input.save(&input_path).unwrap();

    let icon_verification = verify_transparent_file(
        &input_path,
        VerificationOptions {
            profile: TransparentProfile::Icon,
            ..Default::default()
        },
    )
    .unwrap();
    assert!(!icon_verification.passed);
    assert!(
        icon_verification
            .failure_reasons
            .contains(&"too_many_stray_pixels".to_string())
    );

    let seal_verification = verify_transparent_file(
        &input_path,
        VerificationOptions {
            profile: TransparentProfile::Seal,
            ..Default::default()
        },
    )
    .unwrap();
    assert!(seal_verification.passed);
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

#[test]
fn effect_profile_allows_hard_alpha_particles() {
    let temp_dir = tempfile::tempdir().unwrap();
    let input_path = temp_dir.path().join("particles.png");
    let mut input = RgbaImage::from_pixel(80, 80, Rgba([0, 0, 0, 0]));
    for &(cx, cy) in &[(24, 24), (40, 36), (56, 52)] {
        for y in cy - 4..=cy + 4 {
            for x in cx - 4..=cx + 4 {
                input.put_pixel(x, y, Rgba([255, 220, 80, 255]));
            }
        }
    }
    input.save(&input_path).unwrap();

    let verification = verify_transparent_file(
        &input_path,
        VerificationOptions {
            profile: TransparentProfile::Effect,
            ..Default::default()
        },
    )
    .unwrap();
    assert!(verification.passed);
    assert_eq!(verification.partial_pixels, 0);
}
