import { Suspense, lazy, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useTweaks } from "@/hooks/use-tweaks";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { THEME_PRESETS, type ThemePresetId } from "@/lib/theme-presets";

const LiquidChrome = lazy(
  () => import("@/components/reactbits/backgrounds/LiquidChrome"),
);
const Plasma = lazy(() => import("@/components/reactbits/backgrounds/Plasma"));
const Beams = lazy(() => import("@/components/reactbits/backgrounds/Beams"));
const DotGrid = lazy(
  () => import("@/components/reactbits/backgrounds/DotGrid"),
);
const LetterGlitch = lazy(
  () => import("@/components/reactbits/backgrounds/LetterGlitch"),
);
const Grainient = lazy(
  () => import("@/components/reactbits/backgrounds/Grainient"),
);

/**
 * Render the active theme preset's background. Each kind reads only
 * the params it cares about from preset.background; everything else
 * falls back to the component's own defaults. accent / accent-2 hex
 * values are forwarded so the background tints match the rest of the
 * app's chrome (e.g. Plasma's color, Beams's lightColor).
 */
function ThemeBackground({ presetId }: { presetId: ThemePresetId }) {
  const preset = THEME_PRESETS[presetId];
  const bg = preset.background;
  switch (bg.kind) {
    case "grainient":
      return (
        <Grainient
          color1={bg.color1}
          color2={bg.color2}
          color3={bg.color3}
          timeSpeed={bg.timeSpeed}
          colorBalance={bg.colorBalance}
          warpStrength={bg.warpStrength}
          warpFrequency={bg.warpFrequency}
          warpSpeed={bg.warpSpeed}
          warpAmplitude={bg.warpAmplitude}
          blendAngle={bg.blendAngle}
          blendSoftness={bg.blendSoftness}
          rotationAmount={bg.rotationAmount}
          noiseScale={bg.noiseScale}
          grainAmount={bg.grainAmount}
          grainScale={bg.grainScale}
          grainAnimated={bg.grainAnimated}
          contrast={bg.contrast}
          gamma={bg.gamma}
          saturation={bg.saturation}
          centerX={bg.centerX}
          centerY={bg.centerY}
          zoom={bg.zoom}
        />
      );
    case "liquid":
      return (
        <LiquidChrome
          baseColor={bg.baseColor ?? [0.18, 0.16, 0.32]}
          speed={bg.speed}
          amplitude={bg.amplitude}
          frequencyX={bg.frequencyX}
          frequencyY={bg.frequencyY}
          interactive={false}
        />
      );
    case "plasma":
      return (
        <Plasma
          color={preset.accent2Solid}
          speed={bg.speed}
          mouseInteractive={false}
        />
      );
    case "beams":
      return (
        <Beams
          beamWidth={bg.beamWidth}
          beamHeight={bg.beamHeight}
          beamNumber={bg.beamNumber}
          lightColor={bg.lightColor ?? preset.accentSolid}
          speed={bg.speed}
          noiseIntensity={bg.noiseIntensity}
          scale={bg.scale}
          rotation={bg.rotation}
        />
      );
    case "dotgrid":
      return (
        <DotGrid
          dotSize={bg.dotSize}
          gap={bg.gap}
          baseColor={preset.accent2Solid}
          activeColor={preset.accentSolid}
          proximity={bg.proximity}
        />
      );
    case "letterglitch":
      return (
        <LetterGlitch
          glitchColors={bg.glitchColors}
          glitchSpeed={bg.glitchSpeed}
          smooth={bg.smooth}
          centerVignette={bg.centerVignette}
          outerVignette={bg.outerVignette}
        />
      );
    default:
      return null;
  }
}

/**
 * Top-level window chrome.
 *
 * Renders the active theme preset's animated background under a veil
 * layer that dims it so glass panels stay readable. Switching preset
 * crossfades the old → new background over 450ms via AnimatePresence
 * (`mode="sync"` keeps both layers mounted across the transition so
 * the screen never flashes black). The veil itself reads token vars
 * (`--bg-veil-soft / --bg-veil-strong`) which the preset rewrites,
 * so it tints to match.
 *
 * The animated layer is force-disabled whenever the OS "reduce motion"
 * preference is set — vestibular triggers should never depend on a
 * per-app opt-out. In that mode we fall back to the static accent
 * radials + noise overlay below.
 */
export function WindowChrome({ children }: { children: ReactNode }) {
  const { tweaks } = useTweaks();
  const reducedMotion = useReducedMotion();
  const animated = !reducedMotion;
  const presetId = tweaks.themePreset;

  return (
    <div className="relative h-full w-full overflow-hidden bg-background">
      {/* Animated background layer — mounts the preset's background
          component and crossfades on preset change */}
      {animated && (
        <div className="pointer-events-none absolute inset-0 z-0">
          <AnimatePresence mode="sync">
            <motion.div
              key={presetId}
              className="absolute inset-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.45, ease: [0.32, 0.72, 0, 1] }}
            >
              <Suspense fallback={null}>
                <ThemeBackground presetId={presetId} />
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </div>
      )}

      {/* Veil layer — dims the animated output so foreground panels
          stay readable. When animation is off, replaced by accent
          radials so the static dark bg still has some color depth. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[1]"
        style={
          animated
            ? {
                background:
                  "radial-gradient(120% 90% at 50% 50%, var(--bg-veil-soft) 0%, var(--bg-veil-strong) 100%)",
              }
            : {
                backgroundImage:
                  "radial-gradient(60% 50% at 0% 0%, var(--accent-10) 0%, transparent 60%)," +
                  "radial-gradient(50% 50% at 100% 100%, var(--accent-2-06) 0%, transparent 60%)",
              }
        }
      />
      {!animated && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-[1] opacity-[0.5] mix-blend-overlay"
          style={{
            backgroundImage:
              "radial-gradient(var(--w-noise) 1px, transparent 1px)",
            backgroundSize: "3px 3px",
          }}
        />
      )}

      <div className="relative z-[2] h-full w-full">{children}</div>
    </div>
  );
}
