import {
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/cn";

type GlassChannel = "R" | "G" | "B";
type GlassBlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity"
  | "plus-darker"
  | "plus-lighter";

export interface GlassSurfaceProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  children?: ReactNode;
  width?: number | string;
  height?: number | string;
  borderRadius?: number;
  borderWidth?: number;
  brightness?: number;
  opacity?: number;
  blur?: number;
  displace?: number;
  backgroundOpacity?: number;
  saturation?: number;
  distortionScale?: number;
  redOffset?: number;
  greenOffset?: number;
  blueOffset?: number;
  xChannel?: GlassChannel;
  yChannel?: GlassChannel;
  mixBlendMode?: GlassBlendMode;
  surfaceBackground?: string;
  contentClassName?: string;
}

export default function GlassSurface({
  children,
  width = "auto",
  height = "auto",
  borderRadius = 24,
  borderWidth = 0.08,
  brightness = 42,
  opacity = 0.88,
  blur = 11,
  displace = 0,
  backgroundOpacity = 0.16,
  saturation = 1.45,
  distortionScale = -125,
  redOffset = 0,
  greenOffset = 8,
  blueOffset = 16,
  xChannel = "R",
  yChannel = "G",
  mixBlendMode = "screen",
  surfaceBackground = "var(--surface-nav)",
  className,
  contentClassName,
  style,
  ...rest
}: GlassSurfaceProps) {
  const uniqueId = useId().replace(/:/g, "-");
  const filterId = `glass-surface-${uniqueId}`;
  const redGradientId = `glass-red-${uniqueId}`;
  const blueGradientId = `glass-blue-${uniqueId}`;
  const containerRef = useRef<HTMLDivElement>(null);
  const feImageRef = useRef<SVGFEImageElement>(null);
  const redChannelRef = useRef<SVGFEDisplacementMapElement>(null);
  const greenChannelRef = useRef<SVGFEDisplacementMapElement>(null);
  const blueChannelRef = useRef<SVGFEDisplacementMapElement>(null);
  const gaussianBlurRef = useRef<SVGFEGaussianBlurElement>(null);
  const [svgSupported, setSvgSupported] = useState(false);

  const generateDisplacementMap = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    const actualWidth = Math.max(rect?.width ?? 320, 1);
    const actualHeight = Math.max(rect?.height ?? 64, 1);
    const edgeSize = Math.min(actualWidth, actualHeight) * borderWidth;

    const svgContent = `
      <svg viewBox="0 0 ${actualWidth} ${actualHeight}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="${redGradientId}" x1="100%" y1="0%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#0000"/>
            <stop offset="100%" stop-color="red"/>
          </linearGradient>
          <linearGradient id="${blueGradientId}" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#0000"/>
            <stop offset="100%" stop-color="blue"/>
          </linearGradient>
        </defs>
        <rect width="${actualWidth}" height="${actualHeight}" fill="black"/>
        <rect width="${actualWidth}" height="${actualHeight}" rx="${borderRadius}" fill="url(#${redGradientId})"/>
        <rect width="${actualWidth}" height="${actualHeight}" rx="${borderRadius}" fill="url(#${blueGradientId})" style="mix-blend-mode:${mixBlendMode}"/>
        <rect x="${edgeSize}" y="${edgeSize}" width="${actualWidth - edgeSize * 2}" height="${actualHeight - edgeSize * 2}" rx="${borderRadius}" fill="hsl(0 0% ${brightness}% / ${opacity})" style="filter:blur(${blur}px)"/>
      </svg>
    `;

    return `data:image/svg+xml,${encodeURIComponent(svgContent)}`;
  };

  const updateDisplacementMap = () => {
    feImageRef.current?.setAttribute("href", generateDisplacementMap());
    [
      { ref: redChannelRef, offset: redOffset },
      { ref: greenChannelRef, offset: greenOffset },
      { ref: blueChannelRef, offset: blueOffset },
    ].forEach(({ ref, offset }) => {
      ref.current?.setAttribute("scale", `${distortionScale + offset}`);
      ref.current?.setAttribute("xChannelSelector", xChannel);
      ref.current?.setAttribute("yChannelSelector", yChannel);
    });
    gaussianBlurRef.current?.setAttribute("stdDeviation", `${displace}`);
  };

  useEffect(() => {
    setSvgSupported(supportsSvgBackdropFilter(filterId));
  }, [filterId]);

  useEffect(() => {
    updateDisplacementMap();
    if (!containerRef.current) return;

    const observer = new ResizeObserver(() => {
      window.requestAnimationFrame(updateDisplacementMap);
    });
    observer.observe(containerRef.current);

    return () => observer.disconnect();
    // updateDisplacementMap intentionally closes over visual props so the
    // generated SVG stays aligned with token/theme changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    width,
    height,
    borderRadius,
    borderWidth,
    brightness,
    opacity,
    blur,
    displace,
    distortionScale,
    redOffset,
    greenOffset,
    blueOffset,
    xChannel,
    yChannel,
    mixBlendMode,
  ]);

  const baseStyle: CSSProperties = {
    ...style,
    width: typeof width === "number" ? `${width}px` : width,
    height: typeof height === "number" ? `${height}px` : height,
    borderRadius,
    ["--glass-surface-frost" as string]: backgroundOpacity,
  };

  const glassStyle: CSSProperties = svgSupported
    ? {
        ...baseStyle,
        background: surfaceBackground,
        backdropFilter: `url(#${filterId}) saturate(${saturation})`,
        WebkitBackdropFilter: `url(#${filterId}) saturate(${saturation})`,
        border: "1px solid var(--w-12)",
        boxShadow:
          "inset 0 1px 0 var(--w-14), inset 0 -1px 0 var(--k-20), 0 14px 40px -24px var(--k-70)",
      }
    : {
        ...baseStyle,
        background: surfaceBackground,
        backdropFilter: "blur(18px) saturate(145%)",
        WebkitBackdropFilter: "blur(18px) saturate(145%)",
        border: "1px solid var(--w-10)",
        boxShadow: "inset 0 1px 0 var(--w-10), 0 12px 32px -24px var(--k-70)",
      };

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative overflow-hidden transition-opacity duration-300 ease-out",
        className,
      )}
      style={glassStyle}
      {...rest}
    >
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <filter
            id={filterId}
            colorInterpolationFilters="sRGB"
            x="0%"
            y="0%"
            width="100%"
            height="100%"
          >
            <feImage
              ref={feImageRef}
              x="0"
              y="0"
              width="100%"
              height="100%"
              preserveAspectRatio="none"
              result="map"
            />
            <feDisplacementMap
              ref={redChannelRef}
              in="SourceGraphic"
              in2="map"
              result="dispRed"
            />
            <feColorMatrix
              in="dispRed"
              type="matrix"
              values="1 0 0 0 0
                      0 0 0 0 0
                      0 0 0 0 0
                      0 0 0 1 0"
              result="red"
            />
            <feDisplacementMap
              ref={greenChannelRef}
              in="SourceGraphic"
              in2="map"
              result="dispGreen"
            />
            <feColorMatrix
              in="dispGreen"
              type="matrix"
              values="0 0 0 0 0
                      0 1 0 0 0
                      0 0 0 0 0
                      0 0 0 1 0"
              result="green"
            />
            <feDisplacementMap
              ref={blueChannelRef}
              in="SourceGraphic"
              in2="map"
              result="dispBlue"
            />
            <feColorMatrix
              in="dispBlue"
              type="matrix"
              values="0 0 0 0 0
                      0 0 0 0 0
                      0 0 1 0 0
                      0 0 0 1 0"
              result="blue"
            />
            <feBlend in="red" in2="green" mode="screen" result="rg" />
            <feBlend in="rg" in2="blue" mode="screen" result="output" />
            <feGaussianBlur ref={gaussianBlurRef} in="output" stdDeviation="0" />
          </filter>
        </defs>
      </svg>
      <div
        className={cn(
          "relative z-10 flex h-full w-full items-center justify-center rounded-[inherit]",
          contentClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}

function supportsSvgBackdropFilter(filterId: string) {
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    typeof CSS === "undefined"
  ) {
    return false;
  }
  const userAgent = navigator.userAgent;
  const isWebKit = /Safari/.test(userAgent) && !/Chrome/.test(userAgent);
  const isFirefox = /Firefox/.test(userAgent);
  if (isWebKit || isFirefox) return false;

  const probe = document.createElement("div");
  probe.style.backdropFilter = `url(#${filterId})`;
  return probe.style.backdropFilter !== "" && CSS.supports("backdrop-filter", "blur(1px)");
}
