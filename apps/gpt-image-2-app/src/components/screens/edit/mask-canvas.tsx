import { useEffect, useRef, useState, type PointerEvent } from "react";
import { PlaceholderImage } from "@/components/screens/shared/placeholder-image";

export type MaskMode = "paint" | "erase";

export function MaskCanvas({
  imageUrl,
  seed,
  brushSize,
  mode,
  /** export trigger — when this value changes, we produce a Blob and fire `onExport` */
  exportKey,
  onExport,
  onClear,
  clearKey,
}: {
  imageUrl?: string;
  seed?: number;
  brushSize: number;
  mode: MaskMode;
  exportKey?: number;
  onExport?: (blob: Blob | null) => void;
  clearKey?: number;
  onClear?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [painting, setPainting] = useState(false);
  const W = 1024;
  const H = 1024;

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    onClear?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearKey]);

  useEffect(() => {
    if (exportKey == null) return;
    const c = canvasRef.current;
    if (!c) {
      onExport?.(null);
      return;
    }
    c.toBlob((blob) => onExport?.(blob), "image/png");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportKey]);

  const getPos = (e: PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (W / rect.width),
      y: (e.clientY - rect.top) * (H / rect.height),
    };
  };

  const draw = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!painting) return;
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const p = getPos(e);
    ctx.globalCompositeOperation = mode === "erase" ? "destination-out" : "source-over";
    ctx.fillStyle = "rgba(16,160,108,0.85)";
    ctx.beginPath();
    ctx.arc(p.x, p.y, brushSize, 0, Math.PI * 2);
    ctx.fill();
  };

  return (
    <div
      className="relative w-full aspect-square rounded-[10px] overflow-hidden bg-sunken border border-border"
      style={{ touchAction: "none" }}
    >
      <div className="absolute inset-0">
        {imageUrl ? (
          <img src={imageUrl} alt="reference" className="w-full h-full object-cover" />
        ) : (
          <PlaceholderImage seed={seed ?? 7} />
        )}
      </div>
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.15)" }} />
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture(e.pointerId);
          setPainting(true);
          draw(e);
        }}
        onPointerMove={draw}
        onPointerUp={(e) => {
          (e.target as Element).releasePointerCapture(e.pointerId);
          setPainting(false);
        }}
        onPointerCancel={() => setPainting(false)}
        onPointerLeave={() => setPainting(false)}
        className="absolute inset-0 w-full h-full"
        style={{ cursor: mode === "erase" ? "cell" : "crosshair" }}
      />
      <div
        className="absolute bottom-2.5 left-2.5 px-2 py-1 bg-black/55 backdrop-blur-sm text-white text-[10.5px] font-medium rounded font-mono"
      >
        涂抹要修改的区域 · 拖动指针
      </div>
    </div>
  );
}
