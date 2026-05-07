import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/lib/api";
import {
  DEFAULT_PRESET,
  THEME_PRESETS,
  isThemePresetId,
  readUnlockedPresets,
  type ThemePresetId,
} from "@/lib/theme-presets";
import type { InterfaceMode, Tweaks } from "@/lib/types";

const DEFAULT_TWEAKS: Tweaks = {
  theme: "dark",
  accent: "violet",
  font: "system",
  density: "comfortable",
  maxParallel: 2,
  notifyOnComplete: true,
  notifyOnFailure: true,
  liquidBackground: true,
  glassOpacity: 42,
  themePreset: DEFAULT_PRESET,
  interfaceMode: "modern",
  persistCreativeDrafts: true,
};

function clampOpacity(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_TWEAKS.glassOpacity;
  return Math.min(95, Math.max(5, Math.round(n)));
}

const STORAGE_KEY = "gpt2.tweaks";

type Ctx = {
  tweaks: Tweaks;
  setTweaks: (partial: Partial<Tweaks>) => void;
};

const TweaksContext = createContext<Ctx | undefined>(undefined);

function clampParallel(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_TWEAKS.maxParallel;
  return Math.min(8, Math.max(1, Math.round(n)));
}

function normalizeInterfaceMode(value: unknown): InterfaceMode {
  return value === "legacy" ? "legacy" : "modern";
}

function normalizeTheme(value: unknown): Tweaks["theme"] {
  return value === "light" ? "light" : "dark";
}

function isStaticBrowserRuntime(): boolean {
  if (typeof window === "undefined") return false;
  if (window.__TAURI_INTERNALS__ || window.__TAURI__) return false;
  const configuredHttpApi =
    window.__GPT_IMAGE_2_API_BASE__?.trim() ||
    import.meta.env.VITE_GPT_IMAGE_2_API_BASE?.trim();
  return window.__GPT_IMAGE_2_RUNTIME__ !== "http" && !configuredHttpApi;
}

function normalizeInitialInterfaceMode(parsed: unknown): InterfaceMode {
  if (
    parsed &&
    typeof parsed === "object" &&
    !("interfaceMode" in parsed) &&
    isStaticBrowserRuntime()
  ) {
    return "legacy";
  }
  return normalizeInterfaceMode(
    (parsed as { interfaceMode?: unknown })?.interfaceMode,
  );
}

export function __resolveInitialInterfaceModeForTests(
  parsed: unknown,
): InterfaceMode {
  return normalizeInitialInterfaceMode(parsed);
}

export function __loadTweaksForTests(): Tweaks {
  return load();
}

function load(): Tweaks {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_TWEAKS;
    const parsed = JSON.parse(raw);
    // Migration: payloads written before themePreset exists fall back
    // to the default preset; payloads with a hidden preset that hasn't
    // been unlocked also fall back so a leaked localStorage key can't
    // skip the Easter egg gate.
    // Explicit annotation — narrowing through `parsed?.themePreset`
    // doesn't propagate from the type guard because `parsed` itself
    // is `any` after JSON.parse.
    let presetId: ThemePresetId = isThemePresetId(parsed?.themePreset)
      ? (parsed.themePreset as ThemePresetId)
      : DEFAULT_PRESET;
    const presetMeta = THEME_PRESETS[presetId];
    if (presetMeta.hidden) {
      const unlocked = readUnlockedPresets();
      if (!unlocked.has(presetId)) {
        presetId = DEFAULT_PRESET;
      }
    }
    return {
      ...DEFAULT_TWEAKS,
      ...parsed,
      maxParallel: clampParallel(parsed?.maxParallel),
      theme: normalizeTheme(parsed?.theme),
      accent: "violet",
      liquidBackground:
        typeof parsed?.liquidBackground === "boolean"
          ? parsed.liquidBackground
          : true,
      glassOpacity: clampOpacity(parsed?.glassOpacity),
      themePreset: presetId,
      interfaceMode: normalizeInitialInterfaceMode(parsed),
      persistCreativeDrafts:
        typeof parsed?.persistCreativeDrafts === "boolean"
          ? parsed.persistCreativeDrafts
          : true,
    };
  } catch {
    return DEFAULT_TWEAKS;
  }
}

export function TweaksProvider({ children }: { children: ReactNode }) {
  const [tweaks, setTweaksState] = useState<Tweaks>(load);

  useEffect(() => {
    const root = document.documentElement;
    const preset = THEME_PRESETS[tweaks.themePreset];
    const activeTheme =
      tweaks.interfaceMode === "legacy" ? tweaks.theme : "dark";
    root.setAttribute("data-theme", activeTheme);
    root.setAttribute("data-accent", tweaks.accent);
    root.setAttribute("data-font", tweaks.font);
    root.setAttribute("data-density", tweaks.density);
    root.setAttribute("data-theme-preset", tweaks.themePreset);
    root.setAttribute("data-interface-mode", tweaks.interfaceMode);
    root.setAttribute("data-surface", preset.surfaceStyle);

    // Token rewrites — drive every alpha ramp + gradient + veil through
    // CSS variables so a preset switch retints the entire app in one
    // frame without re-rendering React subtrees.
    //
    // OKLCH triplet is the source of truth for the alpha ramp; the
    // RGB triplet is kept current so dynamic preview cards that
    // interpolate `${preset.accentRgb}` into an inline gradient still
    // see the right color. `--accent / -2 / -3` resolve through OKLCH
    // by default (see :root in index.css); we only overwrite them
    // when a preset deviates from "match the OKLCH" (none do today).
    const [accentL, accentC, accentH] = preset.accentOklch.split(/\s+/);
    const [accent2L, accent2C, accent2H] = preset.accent2Oklch.split(/\s+/);
    const [accent3L, accent3C, accent3H] = preset.accent3Oklch.split(/\s+/);
    root.style.setProperty("--accent-l", accentL);
    root.style.setProperty("--accent-c", accentC);
    root.style.setProperty("--accent-h", accentH);
    root.style.setProperty("--accent-2-l", accent2L);
    root.style.setProperty("--accent-2-c", accent2C);
    root.style.setProperty("--accent-2-h", accent2H);
    root.style.setProperty("--accent-3-l", accent3L);
    root.style.setProperty("--accent-3-c", accent3C);
    root.style.setProperty("--accent-3-h", accent3H);
    root.style.setProperty("--accent-rgb", preset.accentRgb);
    root.style.setProperty("--accent-2-rgb", preset.accent2Rgb);
    root.style.setProperty("--accent-3-rgb", preset.accent3Rgb);
    root.style.setProperty("--accent-gradient", preset.accentGradient);
    root.style.setProperty("--bg-veil-soft", preset.veil.soft);
    root.style.setProperty("--bg-veil-strong", preset.veil.strong);

    // Glass alpha as a CSS variable so .surface-panel and friends pick it up
    root.style.setProperty("--glass-alpha", String(tweaks.glassOpacity / 100));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tweaks));
    } catch {
      /* ignore */
    }
  }, [tweaks]);

  // Trigger a brief brand-tinted veil pulse on preset change to mask
  // the hard-cut on CSS variables. The .theme-pulse class lives on
  // <body> for ~360ms, then the keyframe ends. Skipped on the very
  // first effect run (initial mount).
  const [lastPreset, setLastPreset] = useState(tweaks.themePreset);
  useEffect(() => {
    if (lastPreset === tweaks.themePreset) return;
    setLastPreset(tweaks.themePreset);
    const body = document.body;
    body.classList.remove("theme-pulse");
    // Force reflow so re-adding the class restarts the animation.
    void body.offsetWidth;
    body.classList.add("theme-pulse");
    const timer = window.setTimeout(() => {
      body.classList.remove("theme-pulse");
    }, 400);
    return () => window.clearTimeout(timer);
  }, [tweaks.themePreset, lastPreset]);

  useEffect(() => {
    void api.setQueueConcurrency(tweaks.maxParallel).catch(() => {
      /* backend will log; UI stays responsive */
    });
  }, [tweaks.maxParallel]);

  const setTweaks = useCallback((partial: Partial<Tweaks>) => {
    setTweaksState((prev) => {
      const next = { ...prev, ...partial };
      if (partial.maxParallel !== undefined) {
        next.maxParallel = clampParallel(partial.maxParallel);
      }
      if (partial.glassOpacity !== undefined) {
        next.glassOpacity = clampOpacity(partial.glassOpacity);
      }
      // When the caller switches preset, sync the suggested font and
      // density unless the same call also overrides them. Lets a tap
      // on a preset card change "the whole look" while still letting
      // a power user flip just font/density independently afterwards.
      if (
        partial.themePreset !== undefined &&
        partial.themePreset !== prev.themePreset
      ) {
        const preset = THEME_PRESETS[partial.themePreset];
        if (partial.font === undefined) next.font = preset.suggestedFont;
        if (partial.density === undefined)
          next.density = preset.suggestedDensity;
      }
      return next;
    });
  }, []);

  return createElement(
    TweaksContext.Provider,
    { value: { tweaks, setTweaks } },
    children,
  );
}

export function useTweaks() {
  const ctx = useContext(TweaksContext);
  if (!ctx) throw new Error("useTweaks must be used within TweaksProvider");
  return ctx;
}
