import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Subscribe to the system "reduce motion" preference.
 *
 * Returns true when the user has opted into reduced motion via OS settings
 * (macOS: Accessibility → Display → Reduce motion; Windows: Settings →
 * Accessibility → Visual effects → Animation effects).
 *
 * Components that drive their own animation loop (WebGL, GSAP, requestAnimationFrame)
 * cannot rely on the global CSS `@media (prefers-reduced-motion: reduce)` rule —
 * they must consult this hook and skip / pause the loop themselves.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(QUERY);
    const handler = (event: MediaQueryListEvent) => setReduced(event.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return reduced;
}
