import type { Tweaks } from "./types";

/**
 * Theme preset registry.
 *
 * Each preset is a self-contained bundle: which background component
 * to render, three RGB triplets that drive the accent alpha ramps in
 * `index.css`, the surface style for `.surface-panel`, and the
 * suggested font/density. Switching preset rewrites all of these via
 * `TweaksProvider`'s effect so the entire app retints in one frame.
 *
 * Adding a new preset only requires:
 *   1. New entry in THEME_PRESETS below.
 *   2. (optional) Matching background component in
 *      `components/reactbits/backgrounds/` if `kind` is new.
 *   3. (optional) New `[data-surface="…"]` CSS rule if `surfaceStyle`
 *      is new.
 *
 * Hidden presets (e.g. letter-matrix) don't show in the Appearance
 * gallery until unlocked by the user (see `gpt2.unlocks` localStorage).
 */
export type ThemePresetId =
  | "logo-grainient"
  | "liquid-violet"
  | "plasma-sunset"
  | "beams-cyan"
  | "mesh-mono"
  | "letter-matrix";

export type SurfaceStyle = "glass" | "paper" | "neon";
export type BackgroundKind =
  | "grainient"
  | "liquid"
  | "plasma"
  | "beams"
  | "dotgrid"
  | "letterglitch";

/**
 * Discriminated union — each background reads only the params it
 * cares about. Keeping a wide bag (rather than per-kind shapes) lets
 * `WindowChrome` switch on `kind` and forward the rest as props
 * without needing per-kind type guards everywhere downstream.
 */
export interface BackgroundParams {
  kind: BackgroundKind;
  // OGL backgrounds (liquid)
  baseColor?: [number, number, number];
  speed?: number;
  amplitude?: number;
  frequencyX?: number;
  frequencyY?: number;
  // Plasma
  hueShift?: number;
  // Beams
  beamWidth?: number;
  beamHeight?: number;
  beamNumber?: number;
  lightColor?: string;
  noiseIntensity?: number;
  scale?: number;
  rotation?: number;
  // DotGrid
  dotSize?: number;
  gap?: number;
  proximity?: number;
  shockRadius?: number;
  shockStrength?: number;
  // LetterGlitch
  glitchColors?: string[];
  glitchSpeed?: number;
  smooth?: boolean;
  centerVignette?: boolean;
  outerVignette?: boolean;
  // Grainient
  color1?: string;
  color2?: string;
  color3?: string;
  timeSpeed?: number;
  colorBalance?: number;
  warpStrength?: number;
  warpFrequency?: number;
  warpSpeed?: number;
  warpAmplitude?: number;
  blendAngle?: number;
  blendSoftness?: number;
  rotationAmount?: number;
  noiseScale?: number;
  grainAmount?: number;
  grainScale?: number;
  grainAnimated?: boolean;
  contrast?: number;
  gamma?: number;
  saturation?: number;
  centerX?: number;
  centerY?: number;
  zoom?: number;
}

export interface ThemePreset {
  id: ThemePresetId;
  displayName: string;
  description: string;
  hidden?: boolean;
  background: BackgroundParams;
  // RGB triplets — written to `--accent-rgb` etc. Drive every alpha
  // ramp in index.css via `rgba(var(--accent-rgb), 0.NN)`.
  accentRgb: string;
  accent2Rgb: string;
  accent3Rgb: string;
  // Solid hex written to `--accent` etc. Used by places that can't
  // accept `rgba(var(--accent-rgb), 1)` (e.g. SVG `fill`, gradient
  // anchor stops written verbatim).
  accentSolid: string;
  accent2Solid: string;
  accent3Solid: string;
  // Pre-computed gradient string for `--accent-gradient`.
  accentGradient: string;
  surfaceStyle: SurfaceStyle;
  // Suggested defaults applied when user picks the preset; user can
  // still override font/density independently afterwards.
  suggestedFont: Tweaks["font"];
  suggestedDensity: Tweaks["density"];
  // Veil layer over the WebGL/canvas background — written to
  // `--bg-veil-soft / --bg-veil-strong`. Lighter veil = background
  // bleeds through more strongly.
  veil: { soft: string; strong: string };
}

export const THEME_PRESETS: Record<ThemePresetId, ThemePreset> = {
  "logo-grainient": {
    id: "logo-grainient",
    displayName: "彩晶雾",
    description: "Logo 晶面抽色,颗粒渐变流动",
    background: {
      kind: "grainient",
      color1: "#66f5ff",
      color2: "#5b2dff",
      color3: "#ff8a3d",
      timeSpeed: 0.18,
      colorBalance: -0.16,
      warpStrength: 0.95,
      warpFrequency: 4.8,
      warpSpeed: 1.55,
      warpAmplitude: 56,
      blendAngle: -34,
      blendSoftness: 0.14,
      rotationAmount: 460,
      noiseScale: 1.65,
      grainAmount: 0.075,
      grainScale: 2.8,
      grainAnimated: false,
      contrast: 1.28,
      gamma: 0.96,
      saturation: 1.22,
      centerX: -0.08,
      centerY: 0.04,
      zoom: 1.08,
    },
    accentRgb: "109, 92, 255",
    accent2Rgb: "32, 231, 255",
    accent3Rgb: "255, 138, 61",
    accentSolid: "#6d5cff",
    accent2Solid: "#20e7ff",
    accent3Solid: "#ff8a3d",
    accentGradient:
      "linear-gradient(135deg, #6d5cff 0%, #20e7ff 58%, #ff8a3d 100%)",
    surfaceStyle: "glass",
    suggestedFont: "system",
    suggestedDensity: "comfortable",
    veil: {
      soft: "rgba(6, 6, 10, 0.12)",
      strong: "rgba(6, 6, 10, 0.66)",
    },
  },
  "liquid-violet": {
    id: "liquid-violet",
    displayName: "液态紫",
    description: "默认液态玻璃,紫青粉渐变",
    background: {
      kind: "liquid",
      baseColor: [0.18, 0.16, 0.32],
      speed: 0.16,
      amplitude: 0.52,
      frequencyX: 3.0,
      frequencyY: 2.2,
    },
    accentRgb: "167, 139, 250",
    accent2Rgb: "103, 232, 249",
    accent3Rgb: "240, 171, 252",
    accentSolid: "#a78bfa",
    accent2Solid: "#67e8f9",
    accent3Solid: "#f0abfc",
    accentGradient:
      "linear-gradient(135deg, #a78bfa 0%, #67e8f9 60%, #f0abfc 100%)",
    surfaceStyle: "glass",
    suggestedFont: "system",
    suggestedDensity: "comfortable",
    veil: {
      soft: "rgba(6, 6, 10, 0.18)",
      strong: "rgba(6, 6, 10, 0.62)",
    },
  },
  "plasma-sunset": {
    id: "plasma-sunset",
    displayName: "等离子日落",
    description: "粉橙等离子脉冲,海报感",
    background: {
      kind: "plasma",
      speed: 1.0,
      hueShift: 0,
    },
    accentRgb: "251, 113, 133",
    accent2Rgb: "251, 191, 36",
    accent3Rgb: "244, 114, 182",
    accentSolid: "#fb7185",
    accent2Solid: "#fbbf24",
    accent3Solid: "#f472b6",
    accentGradient:
      "linear-gradient(135deg, #fb7185 0%, #fbbf24 60%, #f472b6 100%)",
    surfaceStyle: "neon",
    suggestedFont: "system",
    suggestedDensity: "comfortable",
    veil: {
      soft: "rgba(20, 8, 14, 0.20)",
      strong: "rgba(20, 8, 14, 0.62)",
    },
  },
  "beams-cyan": {
    id: "beams-cyan",
    displayName: "光束青",
    description: "Beams 光束扫过,科技工程感",
    background: {
      kind: "beams",
      beamWidth: 3,
      beamHeight: 30,
      beamNumber: 20,
      lightColor: "#7dd3fc",
      speed: 2,
      noiseIntensity: 1.75,
      scale: 0.2,
      rotation: 30,
    },
    accentRgb: "56, 189, 248",
    accent2Rgb: "16, 185, 129",
    accent3Rgb: "132, 204, 250",
    accentSolid: "#38bdf8",
    accent2Solid: "#10b981",
    accent3Solid: "#84ccfa",
    accentGradient:
      "linear-gradient(135deg, #38bdf8 0%, #10b981 60%, #84ccfa 100%)",
    surfaceStyle: "glass",
    suggestedFont: "system",
    suggestedDensity: "comfortable",
    veil: {
      soft: "rgba(4, 12, 20, 0.08)",
      strong: "rgba(4, 12, 20, 0.48)",
    },
  },
  "mesh-mono": {
    id: "mesh-mono",
    displayName: "网格灰",
    description: "静态点阵,纸感面板,省 GPU",
    background: {
      kind: "dotgrid",
      dotSize: 2,
      gap: 24,
      proximity: 0,
    },
    accentRgb: "230, 232, 235",
    accent2Rgb: "156, 163, 175",
    accent3Rgb: "209, 213, 219",
    accentSolid: "#e6e8eb",
    accent2Solid: "#9ca3af",
    accent3Solid: "#d1d5db",
    accentGradient:
      "linear-gradient(135deg, #e6e8eb 0%, #9ca3af 60%, #d1d5db 100%)",
    surfaceStyle: "paper",
    suggestedFont: "mono",
    suggestedDensity: "compact",
    veil: {
      soft: "rgba(6, 6, 10, 0.10)",
      strong: "rgba(6, 6, 10, 0.40)",
    },
  },
  "letter-matrix": {
    id: "letter-matrix",
    displayName: "字符矩阵",
    description: "终端数字雨,隐藏彩蛋",
    hidden: true,
    background: {
      kind: "letterglitch",
      glitchColors: ["#4ade80", "#22d3ee", "#facc15"],
      glitchSpeed: 50,
      smooth: true,
      centerVignette: false,
      outerVignette: true,
    },
    accentRgb: "52, 211, 153",
    accent2Rgb: "110, 231, 183",
    accent3Rgb: "134, 239, 172",
    accentSolid: "#34d399",
    accent2Solid: "#6ee7b7",
    accent3Solid: "#86efac",
    accentGradient:
      "linear-gradient(135deg, #34d399 0%, #6ee7b7 60%, #86efac 100%)",
    surfaceStyle: "neon",
    suggestedFont: "mono",
    suggestedDensity: "compact",
    veil: {
      soft: "rgba(0, 8, 4, 0.30)",
      strong: "rgba(0, 8, 4, 0.72)",
    },
  },
};

export const DEFAULT_PRESET: ThemePresetId = "logo-grainient";

export const VISIBLE_PRESETS: ThemePresetId[] = (
  Object.keys(THEME_PRESETS) as ThemePresetId[]
).filter((id) => !THEME_PRESETS[id].hidden);

export const HIDDEN_PRESETS: ThemePresetId[] = (
  Object.keys(THEME_PRESETS) as ThemePresetId[]
).filter((id) => Boolean(THEME_PRESETS[id].hidden));

export function isThemePresetId(value: unknown): value is ThemePresetId {
  return typeof value === "string" && value in THEME_PRESETS;
}

const UNLOCK_KEY = "gpt2.unlocks";

/** Read which hidden presets the user has unlocked (Easter eggs). */
export function readUnlockedPresets(): Set<ThemePresetId> {
  try {
    const raw = localStorage.getItem(UNLOCK_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter(isThemePresetId));
  } catch {
    return new Set();
  }
}

/** Persist a hidden preset as unlocked. Idempotent. */
export function unlockPreset(id: ThemePresetId): Set<ThemePresetId> {
  const current = readUnlockedPresets();
  current.add(id);
  try {
    localStorage.setItem(UNLOCK_KEY, JSON.stringify([...current]));
  } catch {
    /* ignore */
  }
  return current;
}
