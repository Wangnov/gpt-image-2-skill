import { type ReactNode, Suspense, lazy } from "react";
import "./liquid.css";

const LiquidChrome = lazy(
  () => import("@/components/reactbits/backgrounds/LiquidChrome"),
);

export type LiquidPreset = "violet" | "midnight" | "graphite" | "amethyst";

const PRESETS: Record<
  LiquidPreset,
  {
    baseColor: [number, number, number];
    speed: number;
    amplitude: number;
    frequencyX: number;
    frequencyY: number;
    veil: "soft" | "mid" | "strong";
  }
> = {
  // generate-mockup — silvery violet, the brand hero
  violet: {
    baseColor: [0.16, 0.14, 0.28],
    speed: 0.18,
    amplitude: 0.55,
    frequencyX: 3.2,
    frequencyY: 2.4,
    veil: "soft",
  },
  // history-mockup — deep glass with faint movement
  midnight: {
    baseColor: [0.05, 0.06, 0.1],
    speed: 0.08,
    amplitude: 0.32,
    frequencyX: 2.6,
    frequencyY: 2.0,
    veil: "strong",
  },
  // edit-mockup — graphite metal, photographic mood
  graphite: {
    baseColor: [0.13, 0.14, 0.18],
    speed: 0.12,
    amplitude: 0.42,
    frequencyX: 2.8,
    frequencyY: 2.2,
    veil: "mid",
  },
  // settings-mockup — amethyst quiet
  amethyst: {
    baseColor: [0.12, 0.1, 0.2],
    speed: 0.1,
    amplitude: 0.36,
    frequencyX: 3.0,
    frequencyY: 2.0,
    veil: "mid",
  },
};

export function LiquidShell({
  preset = "violet",
  interactive = false,
  children,
}: {
  preset?: LiquidPreset;
  interactive?: boolean;
  children: ReactNode;
}) {
  const cfg = PRESETS[preset];
  return (
    <div className="liquid-shell">
      <div className="liquid-bg">
        <Suspense fallback={<div className="h-full w-full bg-[#0a0a12]" />}>
          <LiquidChrome
            baseColor={cfg.baseColor}
            speed={cfg.speed}
            amplitude={cfg.amplitude}
            frequencyX={cfg.frequencyX}
            frequencyY={cfg.frequencyY}
            interactive={interactive}
          />
        </Suspense>
      </div>
      <div className={`liquid-veil liquid-veil--${cfg.veil}`} />
      <div className="liquid-content">{children}</div>
    </div>
  );
}
