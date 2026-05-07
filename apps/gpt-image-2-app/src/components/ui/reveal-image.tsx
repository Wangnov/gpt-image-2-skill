import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "onLoad"> & {
  /**
   * Override the entrance duration in ms. Defaults to 360ms which is fast
   * enough to feel responsive on cached local files but visible enough to
   * register as "the new image just came in" on freshly generated outputs.
   */
  duration?: number;
};

/**
 * RevealImage — a thin wrapper around <img> that fades + un-blurs the
 * picture on load. Triggers fresh on every `src` change so swapping
 * candidates in the detail drawer feels intentional, not abrupt.
 *
 * Respects `prefers-reduced-motion`: in that case the image just appears
 * with no transform/blur.
 */
export function RevealImage({
  src,
  className,
  duration = 360,
  style,
  onError,
  ...rest
}: Props) {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
  }, [src]);

  return (
    <img
      src={src}
      onLoad={() => setLoaded(true)}
      onError={(event) => {
        setLoaded(true);
        onError?.(event);
      }}
      className={cn("motion-reduce:transition-none", className)}
      style={{
        opacity: loaded ? 1 : 0,
        filter: loaded ? "blur(0)" : "blur(8px)",
        transform: loaded ? "scale(1)" : "scale(1.02)",
        // Project-wide easing — `cubic-bezier(.22, 1, .36, 1)` is the
        // ease-out-quint every motion.* transition in the app uses.
        // Brings the image reveal in line with how the rest of the
        // surface moves instead of the browser default ease-out.
        transition: `opacity ${duration}ms cubic-bezier(0.22, 1, 0.36, 1), filter ${duration}ms cubic-bezier(0.22, 1, 0.36, 1), transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`,
        willChange: "opacity, filter, transform",
        ...style,
      }}
      {...rest}
    />
  );
}
