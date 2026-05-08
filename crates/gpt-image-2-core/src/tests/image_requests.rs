use super::*;

#[test]
fn parse_image_size_accepts_aliases() {
    assert_eq!(parse_image_size("2K").unwrap(), "2048x2048");
    assert_eq!(parse_image_size("4k").unwrap(), "3840x2160");
}

#[test]
fn parse_image_size_accepts_valid_dimensions() {
    assert_eq!(parse_image_size("1024x640").unwrap(), "1024x640");
    assert_eq!(parse_image_size("2880x2880").unwrap(), "2880x2880");
    assert_eq!(parse_image_size("2160x3840").unwrap(), "2160x3840");
}

#[test]
fn parse_image_size_rejects_oversized_square() {
    assert!(parse_image_size("4096x4096").is_err());
}

#[test]
fn parse_image_size_rejects_too_few_pixels() {
    assert!(parse_image_size("512x512").is_err());
}

#[test]
fn build_openai_image_body_for_edit_includes_mask_and_images() {
    let body = build_openai_image_body(
        "edit",
        "edit this image",
        "gpt-image-2",
        &["data:image/png;base64,AAAA".to_string()],
        Some("data:image/png;base64,BBBB"),
        Some(InputFidelity::High),
        Background::Auto,
        Some("1024x1024"),
        Some(Quality::High),
        Some(OutputFormat::Png),
        None,
        Some(1),
        Some(Moderation::Auto),
    );
    assert_eq!(body["images"][0]["image_url"], "data:image/png;base64,AAAA");
    assert_eq!(body["mask"]["image_url"], "data:image/png;base64,BBBB");
    assert_eq!(body["input_fidelity"], "high");
    assert_eq!(body["model"], "gpt-image-2");
}

#[test]
fn build_openai_edit_form_contains_required_parts() {
    let body = json!({
        "model": "gpt-image-2",
        "prompt": "Edit this image",
        "images": [{"image_url": "data:image/png;base64,YWJjZA=="}],
        "mask": {"image_url": "data:image/png;base64,YWJjZA=="},
        "size": "1024x1024",
    });
    assert!(build_openai_edit_form(&body).is_ok());
}
