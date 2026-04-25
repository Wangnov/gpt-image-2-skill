import { type ReactNode } from "react";

/**
 * Top-level window chrome. Renders the dark liquid backdrop and ambient
 * gradient glow that everything else floats on top of. Children are
 * positioned in the foreground via the `relative z-[1]` stacking context.
 */
export function WindowChrome({ children }: { children: ReactNode }) {
  return (
    <div className="relative h-full w-full overflow-hidden bg-background">
      {/* ambient color glow — top-left violet, bottom-right cyan */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          backgroundImage:
            "radial-gradient(60% 50% at 0% 0%, rgba(167,139,250,0.10) 0%, transparent 60%)," +
            "radial-gradient(50% 50% at 100% 100%, rgba(103,232,249,0.06) 0%, transparent 60%)",
        }}
      />
      {/* very subtle noise / fine grain overlay for depth */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 opacity-[0.5] mix-blend-overlay"
        style={{
          backgroundImage:
            "radial-gradient(rgba(255,255,255,0.025) 1px, transparent 1px)",
          backgroundSize: "3px 3px",
        }}
      />
      <div className="relative z-[1] h-full w-full">{children}</div>
    </div>
  );
}
