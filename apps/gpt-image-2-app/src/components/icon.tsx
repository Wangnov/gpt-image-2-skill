import type { CSSProperties, SVGProps } from "react";

const paths = {
  providers: (
    <>
      <path d="M4 6h12M4 10h12M4 14h12" />
      <circle cx="7" cy="6" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="13" cy="10" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="6" cy="14" r="1.5" fill="currentColor" stroke="none" />
    </>
  ),
  generate: (
    <>
      <rect x="3.25" y="3.25" width="13.5" height="13.5" rx="1.75" />
      <path d="M3.5 13l3.5-3.5 2.5 2.5L13 8l3.5 3.5" />
      <circle cx="12.5" cy="6.5" r="1.25" fill="currentColor" stroke="none" />
    </>
  ),
  edit: (
    <>
      <path d="M14.5 3.5l2 2L7 15l-3 1 1-3L14.5 3.5z" />
      <path d="M12.5 5.5l2 2" />
    </>
  ),
  history: (
    <>
      <circle cx="10" cy="10" r="6.75" />
      <path d="M10 6v4l2.5 2" />
      <path d="M3.5 8A6.75 6.75 0 0110 3.25" strokeDasharray="1.5 1.8" />
    </>
  ),
  plus: <path d="M10 4v12M4 10h12" />,
  minus: <path d="M4 10h12" />,
  x: <path d="M5 5l10 10M15 5L5 15" />,
  check: <path d="M4.5 10.5l3 3 8-8" />,
  chevdown: <path d="M5 8l5 5 5-5" />,
  chevright: <path d="M8 5l5 5-5 5" />,
  chevleft: <path d="M12 5l-5 5 5 5" />,
  arrowup: <><path d="M10 16V4M4 10l6-6 6 6" /></>,
  arrowright: <><path d="M4 10h12M10 4l6 6-6 6" /></>,
  search: (<><circle cx="9" cy="9" r="5" /><path d="M13 13l3 3" /></>),
  upload: (<><path d="M10 13V4M6 8l4-4 4 4" /><path d="M4 14v2h12v-2" /></>),
  download: (<><path d="M10 4v9M6 9l4 4 4-4" /><path d="M4 14v2h12v-2" /></>),
  copy: (<><rect x="5" y="3" width="9" height="12" rx="1" /><path d="M3 5v10a1 1 0 001 1h8" /></>),
  paste: (<><rect x="4.5" y="4" width="11" height="13" rx="1" /><rect x="7" y="2.5" width="6" height="3" rx="0.75" /></>),
  trash: <path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10" />,
  reload: (<><path d="M16 5v4h-4" /><path d="M16 9a6 6 0 10-1.5 4" /></>),
  play: <path d="M6 4l10 6-10 6V4z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="5" y="4" width="3" height="12" fill="currentColor" stroke="none" />
      <rect x="12" y="4" width="3" height="12" fill="currentColor" stroke="none" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="14" height="12" rx="1" />
      <circle cx="7.5" cy="8.5" r="1.25" />
      <path d="M3.5 14l4-4 3 3 2.5-2.5 3.5 3.5" />
    </>
  ),
  wand: (
    <>
      <path d="M4 16L14 6l1.5 1.5L5.5 17.5 4 16z" />
      <path d="M14.5 3.5v2M16 4.5h-2M16.5 7.5v1.5M17 8.5h-1.5" />
    </>
  ),
  brush: (<><path d="M4 16c0-2 2-2 2-4s-2-2-2-4 2-2 2-2" /><path d="M7 4l9 9-3 3-9-9 3-3z" /></>),
  eraser: (<><path d="M10 3l7 7-7 7H6l-3-3 7-11z" /><path d="M6.5 6.5l7 7" /></>),
  mask: (
    <>
      <rect x="3" y="3" width="14" height="14" rx="1.5" />
      <path d="M3 12c3 0 5-5 8-5s3 3 6 3" fill="currentColor" fillOpacity="0.15" />
    </>
  ),
  sparkle: <path d="M10 3l1.5 4.5L16 9l-4.5 1.5L10 15l-1.5-4.5L4 9l4.5-1.5L10 3z" />,
  gear: (
    <>
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 2.5v2M10 15.5v2M4.6 4.6l1.4 1.4M14 14l1.4 1.4M2.5 10h2M15.5 10h2M4.6 15.4L6 14M14 6l1.4-1.4" />
    </>
  ),
  command: <path d="M6 13a1.5 1.5 0 11 1.5-1.5v3a1.5 1.5 0 11-1.5-1.5h8a1.5 1.5 0 111.5 1.5v-3A1.5 1.5 0 1114 13H6z" />,
  cornerbr: <path d="M4 4v12h12" />,
  keychain: (<><circle cx="7" cy="10" r="3" /><path d="M10 10h7M14 10v2.5M17 10v3" /></>),
  envkey: (<><rect x="3" y="5" width="14" height="10" rx="1" /><path d="M3.5 6l6.5 5 6.5-5" /></>),
  filedot: (<><path d="M5 3h6l4 4v10a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z" /><path d="M11 3v4h4" /></>),
  dot: <circle cx="10" cy="10" r="3" fill="currentColor" stroke="none" />,
  circle: <circle cx="10" cy="10" r="5" />,
  info: (<><circle cx="10" cy="10" r="7" /><path d="M10 9v5M10 6.5v.01" strokeLinecap="round" /></>),
  warn: (<><path d="M10 3l8 14H2L10 3z" /><path d="M10 8v4M10 14v.01" strokeLinecap="round" /></>),
  folder: <path d="M3 6a1 1 0 011-1h3l2 2h7a1 1 0 011 1v7a1 1 0 01-1 1H4a1 1 0 01-1-1V6z" />,
  cpu: (
    <>
      <rect x="5" y="5" width="10" height="10" rx="1" />
      <rect x="8" y="8" width="4" height="4" />
      <path d="M7 3v2M10 3v2M13 3v2M7 15v2M10 15v2M13 15v2M3 7h2M3 10h2M3 13h2M15 7h2M15 10h2M15 13h2" />
    </>
  ),
  eye: (<><path d="M2 10c2-4 5-6 8-6s6 2 8 6c-2 4-5 6-8 6s-6-2-8-6z" /><circle cx="10" cy="10" r="2.5" /></>),
  eyeoff: (
    <>
      <path d="M2 10c2-4 5-6 8-6 2 0 4 0.8 5.5 2M18 10c-2 4-5 6-8 6-2 0-4-0.8-5.5-2" />
      <path d="M3 3l14 14" />
    </>
  ),
  dots: (
    <>
      <circle cx="4.5" cy="10" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="10" cy="10" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="10" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  filter: <path d="M3 5h14l-5 6v5l-4-2v-3L3 5z" />,
  arrowin: <path d="M5 10h10M10 5l5 5-5 5" />,
  external: <path d="M8 4H4v12h12v-4M10 4h6v6M16 4l-8 8" />,
  diff: (<><rect x="3" y="3" width="7" height="14" rx="1" /><rect x="10" y="3" width="7" height="14" rx="1" /></>),
  split: (<><rect x="3" y="4" width="14" height="12" rx="1" /><path d="M10 4v12" /></>),
} as const;

export type IconName = keyof typeof paths;

type Props = {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  style?: CSSProperties;
  className?: string;
} & Omit<SVGProps<SVGSVGElement>, "name">;

export function Icon({ name, size = 16, strokeWidth = 1.5, style, className, ...rest }: Props) {
  const glyph = paths[name];
  if (!glyph) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flexShrink: 0, ...style }}
      aria-hidden="true"
      {...rest}
    >
      {glyph}
    </svg>
  );
}
