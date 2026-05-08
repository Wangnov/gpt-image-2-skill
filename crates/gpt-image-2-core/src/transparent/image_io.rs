#![allow(unused_imports)]

use super::*;

pub(crate) fn is_png_file(path: &Path) -> bool {
    fs::read(path)
        .map(|bytes| bytes.starts_with(b"\x89PNG\r\n\x1a\n"))
        .unwrap_or(false)
}

pub(crate) fn scrub_transparent_rgb(image: &mut RgbaImage) {
    for pixel in image.pixels_mut() {
        if pixel.0[3] <= TRANSPARENT_ALPHA_MAX {
            *pixel = Rgba([0, 0, 0, 0]);
        }
    }
}

pub(crate) fn read_image(path: &Path) -> Result<DynamicImage, AppError> {
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

pub(crate) fn save_rgba_png(path: &Path, image: &RgbaImage) -> Result<(), AppError> {
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

pub(crate) fn output_file_value(path: &Path) -> Value {
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

pub(crate) fn normalize_png_output_path(path: &Path) -> PathBuf {
    if path.extension().is_none() {
        path.with_extension("png")
    } else {
        path.to_path_buf()
    }
}
