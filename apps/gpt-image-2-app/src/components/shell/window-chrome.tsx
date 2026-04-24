import { useEffect, useState, type ReactNode } from "react";

export function WindowChrome({ children }: { children: ReactNode }) {
  const MIN_W = 1180;
  const MIN_H = 760;
  const [dim, setDim] = useState({ w: 1360, h: 860 });
  useEffect(() => {
    const calc = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const targetW = 1360;
      const targetH = 860;
      const pad = 40;
      if (vw >= targetW + pad && vh >= targetH + pad) setDim({ w: targetW, h: targetH });
      else setDim({ w: Math.max(MIN_W, Math.min(vw - 20, targetW)), h: Math.max(MIN_H, Math.min(vh - 20, targetH)) });
    };
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);

  return (
    <div
      style={{
        width: dim.w,
        height: dim.h,
        borderRadius: 12,
        overflow: "hidden",
        display: "flex",
        background: "var(--bg)",
        boxShadow: "0 0 0 1px rgba(0,0,0,0.2), 0 24px 60px rgba(0,0,0,0.3)",
      }}
    >
      {children}
    </div>
  );
}
