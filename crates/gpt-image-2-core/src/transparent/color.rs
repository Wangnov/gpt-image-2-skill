#![allow(unused_imports)]

use super::*;

pub(crate) fn color_distance_f64(a: [f64; 3], b: [f64; 3]) -> f64 {
    let red = a[0] - b[0];
    let green = a[1] - b[1];
    let blue = a[2] - b[2];
    (red * red + green * green + blue * blue).sqrt()
}

pub(crate) fn estimate_matte_color(image: &RgbaImage) -> [u8; 3] {
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

pub(crate) fn push_rgb(pixel: [u8; 4], red: &mut Vec<u8>, green: &mut Vec<u8>, blue: &mut Vec<u8>) {
    red.push(pixel[0]);
    green.push(pixel[1]);
    blue.push(pixel[2]);
}

pub(crate) fn median(mut values: Vec<u8>) -> u8 {
    if values.is_empty() {
        return 0;
    }
    values.sort_unstable();
    values[values.len() / 2]
}

pub(crate) fn color_distance(a: [u8; 3], b: [u8; 3]) -> f32 {
    let r = f32::from(a[0]) - f32::from(b[0]);
    let g = f32::from(a[1]) - f32::from(b[1]);
    let b = f32::from(a[2]) - f32::from(b[2]);
    (r * r + g * g + b * b).sqrt()
}

pub(crate) fn parse_matte_color(value: &str) -> Result<[u8; 3], AppError> {
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

pub(crate) fn parse_matte_color_or_auto(value: &str) -> Result<Option<[u8; 3]>, AppError> {
    let normalized = value.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "auto" | "sample" | "auto-sample" | "auto_sample" => Ok(None),
        _ => parse_matte_color(value).map(Some),
    }
}

pub(crate) fn invalid_color_error(value: &str) -> AppError {
    AppError::new(
        "invalid_argument",
        "Matte color must be a named color or #RRGGBB.",
    )
    .with_detail(json!({ "value": value }))
}

pub(crate) fn parse_unit_float(value: &str) -> Result<f32, String> {
    let parsed = value
        .parse::<f32>()
        .map_err(|error| format!("must be a number from 0 to 1: {error}"))?;
    if (0.0..=1.0).contains(&parsed) {
        Ok(parsed)
    } else {
        Err("must be between 0 and 1".to_string())
    }
}

pub(crate) fn color_to_hex(color: [u8; 3]) -> String {
    format!("#{:02x}{:02x}{:02x}", color[0], color[1], color[2])
}

pub(crate) fn ratio(count: u64, total: u64) -> f64 {
    if total == 0 {
        0.0
    } else {
        count as f64 / total as f64
    }
}
