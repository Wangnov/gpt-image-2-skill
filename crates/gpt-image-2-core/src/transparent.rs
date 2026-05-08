#![allow(unused_imports)]

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use clap::{ArgAction, Args, Subcommand, ValueEnum};
use image::{DynamicImage, ImageReader, Rgba, RgbaImage};
use serde::Serialize;
use serde_json::{Value, json};

use super::*;

mod color;
mod commands;
mod extract;
mod image_io;
mod types;
mod verify;

pub(crate) use color::*;
pub(crate) use commands::*;
pub(crate) use extract::*;
pub(crate) use image_io::*;
pub(crate) use types::*;
pub(crate) use verify::*;

#[cfg(test)]
mod tests;
