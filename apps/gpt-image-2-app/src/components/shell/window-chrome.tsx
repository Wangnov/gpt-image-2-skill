import { Suspense, lazy, type ReactNode } from "react";
import { useTweaks } from "@/hooks/use-tweaks";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

const LiquidChrome = lazy(
  () => import("@/components/reactbits/backgrounds/LiquidChrome"),
);

/**
 * Top-level window chrome.
 *
 * Renders the dark liquid backdrop + WebGL LiquidChrome layer (if the
 * user keeps it on in Settings → Appearance). Children float above on
 * `relative z-[2]`. The veil layer in between dims the WebGL output so
 * working-area glass panels stay readable.
 *
 * The WebGL layer is force-disabled whenever the OS "reduce motion"
 * preference is set, regardless of the user's in-app toggle — vestibular
 * triggers should never depend on a per-app opt-out.
 */
export function WindowChrome({ children }: { children: ReactNode }) {
  const { tweaks } = useTweaks();
  const reducedMotion = useReducedMotion();
  const liquid = tweaks.liquidBackground && !reducedMotion;

  return (
    <div className="relative h-full w-full overflow-hidden bg-background">
      {/* WebGL liquid layer — only when the toggle is on */}
      {liquid && (
        <div className="pointer-events-none absolute inset-0 z-0">
          <Suspense fallback={null}>
            <LiquidChrome
              baseColor={[0.18, 0.16, 0.32]}
              speed={0.16}
              amplitude={0.52}
              frequencyX={3.0}
              frequencyY={2.2}
              interactive={false}
            />
          </Suspense>
        </div>
      )}

      {/* Veil layer — dims the WebGL output so foreground panels are readable.
          Slightly stronger when liquid is on so glass cards still pop. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[1]"
        style={
          liquid
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
      {/* Subtle noise overlay (only when liquid is off — the WebGL layer
          already provides plenty of grain) */}
      {!liquid && (
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
