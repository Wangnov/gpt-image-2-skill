import type { CSSProperties } from "react";
import logoUrl from "@/assets/logo.png";

function variantSeed(seed: number, variant: string): number {
  const variantSum = Array.from(variant).reduce(
    (sum, char) => sum + char.charCodeAt(0),
    0,
  );
  return Math.abs(seed * 37 + variantSum) || 1;
}

export function PlaceholderImage({
  seed = 1,
  variant = "a",
  label,
  style,
}: {
  seed?: number;
  variant?: string;
  label?: string;
  style?: CSSProperties;
}) {
  const n = variantSeed(seed, variant);
  const bloomX = 24 + ((n * 17) % 52);
  const bloomY = 20 + ((n * 29) % 56);
  const tilt = ((n % 7) - 3) * 1.5;

  return (
    <div
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className="relative flex h-full w-full items-center justify-center overflow-hidden"
      style={{
        background: `
          radial-gradient(82% 76% at ${bloomX}% ${bloomY}%, var(--accent-35), transparent 62%),
          radial-gradient(74% 68% at ${100 - bloomX}% ${100 - bloomY}%, var(--accent-2-30), transparent 58%),
          var(--image-placeholder-bg)
        `,
        ...style,
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            "linear-gradient(135deg, var(--w-12), transparent 34%, var(--w-04) 68%, transparent)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-[16%] top-[16%] h-px opacity-70"
        style={{
          background:
            "linear-gradient(90deg, transparent, var(--w-20), transparent)",
        }}
      />
      <div
        aria-hidden="true"
        className="relative flex aspect-square w-[46%] min-w-6 max-w-[72px] items-center justify-center rounded-[var(--r-lg)] border border-[color:var(--w-16)] bg-[color:var(--w-08)]"
        style={{
          transform: `rotate(${tilt}deg)`,
          backdropFilter: "blur(12px) saturate(145%)",
          WebkitBackdropFilter: "blur(12px) saturate(145%)",
          boxShadow: "var(--shadow-accent-glow)",
        }}
      >
        <img
          src={logoUrl}
          alt=""
          className="h-[68%] w-[68%] object-contain drop-shadow-[0_0_18px_var(--accent-45)]"
          draggable={false}
        />
      </div>
      {label && (
        <span
          className="absolute bottom-2 left-2 z-10 max-w-[calc(100%-var(--d-pad))] truncate rounded-[var(--r-sm)] border border-[color:var(--w-10)] px-1.5 py-0.5 font-mono text-[10px] text-faint"
          style={{
            background: "var(--k-45)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}
        >
          {label}
        </span>
      )}
    </div>
  );
}
