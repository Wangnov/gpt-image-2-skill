import type { CSSProperties } from "react";

const HUES: readonly [string, string, string][] = [
  ["#f5e4d0", "#d9946a", "#8b4a2b"],
  ["#dce5ee", "#7a9ec4", "#3a5877"],
  ["#e4ecd8", "#88a866", "#3e553a"],
  ["#f1dde1", "#c782a1", "#704055"],
  ["#e8e1f0", "#9888c2", "#473867"],
  ["#f4e9cf", "#d0a94b", "#7a5c22"],
];

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
  const h = HUES[Math.abs(seed) % HUES.length];
  const gId = `g-${seed}-${variant}`;
  const rId = `r-${seed}-${variant}`;
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 400 400"
      preserveAspectRatio="xMidYMid slice"
      style={{ display: "block", ...style }}
    >
      <defs>
        <linearGradient id={gId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={h[0]} />
          <stop offset="0.55" stopColor={h[1]} />
          <stop offset="1" stopColor={h[2]} />
        </linearGradient>
        <radialGradient id={rId} cx={`${(seed * 13) % 100}%`} cy={`${(seed * 7) % 100}%`} r="60%">
          <stop offset="0" stopColor="white" stopOpacity="0.5" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="400" height="400" fill={`url(#${gId})`} />
      <rect width="400" height="400" fill={`url(#${rId})`} />
      <g opacity="0.85">
        <ellipse cx={120 + ((seed * 37) % 160)} cy={260 + ((seed * 23) % 80)} rx="80" ry="24" fill={h[2]} opacity="0.3" />
        <circle cx={200 + ((seed * 11) % 50)} cy={180 + ((seed * 17) % 40)} r={40 + (seed % 20)} fill={h[2]} opacity="0.55" />
        <path
          d={`M${60 + (seed % 50)} 320 Q200 ${220 + (seed % 60)} ${360 - (seed % 50)} 320 L400 400 L0 400 Z`}
          fill={h[2]}
          opacity="0.45"
        />
      </g>
      {label && (
        <text x="14" y="24" fontFamily="var(--f-mono)" fontSize="11" fill={h[2]} opacity="0.7">
          {label}
        </text>
      )}
    </svg>
  );
}
