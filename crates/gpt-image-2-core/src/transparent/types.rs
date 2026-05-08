#![allow(unused_imports)]

use super::*;

pub(crate) const DEFAULT_MATTE_COLOR: &str = "#00ff00";

pub(crate) const DEFAULT_CHROMA_THRESHOLD: f32 = 28.0;

pub(crate) const DEFAULT_CHROMA_SOFTNESS: f32 = 34.0;

pub(crate) const DEFAULT_SPILL_SUPPRESSION: f32 = 0.85;

pub(crate) const TRANSPARENT_ALPHA_MAX: u8 = 5;

pub(crate) const NONTRANSPARENT_ALPHA_MIN: u8 = 20;

pub(crate) const MIN_TRANSPARENT_RATIO: f64 = 0.005;

pub(crate) const STRICT_MIN_TRANSPARENT_RATIO: f64 = 0.05;

pub(crate) const MIN_OPAQUE_ALPHA: u8 = 250;

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
    pub(crate) fn as_str(self) -> &'static str {
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
    Sticker,
    Seal,
    Translucent,
    Glow,
    Shadow,
    Effect,
}

impl TransparentProfile {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Generic => "generic",
            Self::Icon => "icon",
            Self::Product => "product",
            Self::Sticker => "sticker",
            Self::Seal => "seal",
            Self::Translucent => "translucent",
            Self::Glow => "glow",
            Self::Shadow => "shadow",
            Self::Effect => "effect",
        }
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, ValueEnum)]
pub enum TransparentMaterial {
    Standard,
    #[value(name = "soft-3d", alias = "soft3d")]
    Soft3d,
    FlatIcon,
    Sticker,
    Glow,
}

impl TransparentMaterial {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Standard => "standard",
            Self::Soft3d => "soft-3d",
            Self::FlatIcon => "flat-icon",
            Self::Sticker => "sticker",
            Self::Glow => "glow",
        }
    }

    pub(crate) fn chroma_settings(self) -> ChromaSettings {
        match self {
            Self::Standard => ChromaSettings::default(),
            Self::Soft3d => ChromaSettings {
                threshold: 60.0,
                softness: 40.0,
                spill_suppression: 0.20,
                material: Some(self),
            },
            Self::FlatIcon => ChromaSettings {
                threshold: 32.0,
                softness: 28.0,
                spill_suppression: 0.75,
                material: Some(self),
            },
            Self::Sticker => ChromaSettings {
                threshold: 45.0,
                softness: 38.0,
                spill_suppression: 0.45,
                material: Some(self),
            },
            Self::Glow => ChromaSettings {
                threshold: 18.0,
                softness: 62.0,
                spill_suppression: 0.15,
                material: Some(self),
            },
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct ChromaSettings {
    pub(crate) threshold: f32,
    pub(crate) softness: f32,
    pub(crate) spill_suppression: f32,
    pub(crate) material: Option<TransparentMaterial>,
}

impl Default for ChromaSettings {
    fn default() -> Self {
        Self {
            threshold: DEFAULT_CHROMA_THRESHOLD,
            softness: DEFAULT_CHROMA_SOFTNESS,
            spill_suppression: DEFAULT_SPILL_SUPPRESSION,
            material: None,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct VerificationOptions {
    pub(crate) profile: TransparentProfile,
    pub(crate) expected_matte_color: Option<[u8; 3]>,
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
    #[arg(long, value_enum)]
    pub material: Option<TransparentMaterial>,
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
    #[arg(long)]
    pub threshold: Option<f32>,
    #[arg(long)]
    pub softness: Option<f32>,
    #[arg(long, value_parser = parse_unit_float)]
    pub spill_suppression: Option<f32>,
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
    #[arg(long, value_enum)]
    pub material: Option<TransparentMaterial>,
    #[arg(long)]
    pub matte_color: Option<String>,
    #[arg(long)]
    pub threshold: Option<f32>,
    #[arg(long)]
    pub softness: Option<f32>,
    #[arg(long, value_parser = parse_unit_float)]
    pub spill_suppression: Option<f32>,
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
pub(crate) struct AlphaBoundingBox {
    pub(crate) x: u32,
    pub(crate) y: u32,
    pub(crate) width: u32,
    pub(crate) height: u32,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct TransparentVerification {
    pub(crate) path: String,
    pub(crate) profile: String,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) is_png: bool,
    pub(crate) color_type: String,
    pub(crate) has_alpha: bool,
    pub(crate) input_has_alpha: bool,
    pub(crate) alpha_min: u8,
    pub(crate) alpha_max: u8,
    pub(crate) transparent_pixels: u64,
    pub(crate) partial_pixels: u64,
    pub(crate) opaque_pixels: u64,
    pub(crate) nontransparent_pixels: u64,
    pub(crate) transparent_ratio: f64,
    pub(crate) partial_ratio: f64,
    pub(crate) opaque_ratio: f64,
    pub(crate) edge_nontransparent_pixels: u64,
    pub(crate) edge_nontransparent_ratio: f64,
    pub(crate) touches_edge: bool,
    pub(crate) edge_margin_px: Option<u32>,
    pub(crate) component_count: u64,
    pub(crate) largest_component_pixels: u64,
    pub(crate) largest_component_ratio: f64,
    pub(crate) stray_pixel_count: u64,
    pub(crate) alpha_noise_score: f64,
    pub(crate) matte_residue_score: Option<f64>,
    pub(crate) matte_residue_checked: bool,
    pub(crate) halo_score: f64,
    pub(crate) transparent_rgb_scrubbed: bool,
    pub(crate) checkerboard_detected: bool,
    pub(crate) alpha_health_score: f64,
    pub(crate) residue_score: f64,
    pub(crate) quality_score: f64,
    pub(crate) bbox: Option<AlphaBoundingBox>,
    pub(crate) passed: bool,
    pub(crate) failure_reasons: Vec<String>,
    pub(crate) warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct ExtractionReport {
    pub(crate) method: String,
    pub(crate) inputs: Value,
    pub(crate) output: Value,
    pub(crate) matte_color: Option<String>,
    pub(crate) matte_color_source: Option<String>,
    pub(crate) threshold: Option<f32>,
    pub(crate) softness: Option<f32>,
    pub(crate) spill_suppression: Option<f32>,
    pub(crate) material: Option<String>,
    pub(crate) matte_decontamination_applied: bool,
    pub(crate) rgb_scrubbed: bool,
    pub(crate) dual_alignment: Option<DualAlignmentReport>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct DualAlignmentReport {
    pub(crate) score: f64,
    pub(crate) passed: bool,
    pub(crate) negative_delta_ratio: f64,
    pub(crate) delta_channel_noise: f64,
    pub(crate) color_space: String,
}
