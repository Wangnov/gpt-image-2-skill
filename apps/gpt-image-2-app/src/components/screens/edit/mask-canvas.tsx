import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { PlaceholderImage } from "@/components/screens/shared/placeholder-image";

export type MaskMode = "paint" | "erase";
export type MaskExport = {
  targetImage: Blob;
  nativeMask: Blob;
  selectionHint: Blob;
  hasSelection: boolean;
};

export function MaskCanvas({
  imageUrl,
  seed,
  brushSize,
  mode,
  snapshot,
  snapshotKey,
  onSnapshotChange,
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
  snapshot?: string;
  snapshotKey?: string;
  onSnapshotChange?: (snapshot: string | null) => void;
  exportKey?: number;
  onExport?: (payload: MaskExport | null) => void;
  clearKey?: number;
  onClear?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [painting, setPainting] = useState(false);
  const [cursor, setCursor] = useState({ x: 512, y: 512 });
  const [imageSize, setImageSize] = useState({ width: 1024, height: 1024 });
  const W = imageSize.width;
  const H = imageSize.height;

  useEffect(() => {
    if (!imageUrl) {
      setImageSize({ width: 1024, height: 1024 });
      return;
    }
    let cancelled = false;
    loadImage(imageUrl)
      .then((image) => {
        if (cancelled) return;
        setImageSize({
          width: Math.max(1, image.naturalWidth),
          height: Math.max(1, image.naturalHeight),
        });
      })
      .catch(() => {
        if (!cancelled) setImageSize({ width: 1024, height: 1024 });
      });
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  const commitSnapshot = () => {
    const c = canvasRef.current;
    if (!c) return;
    onSnapshotChange?.(c.toDataURL("image/png"));
  };

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    onClear?.();
    onSnapshotChange?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearKey, H, W]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    if (!snapshot) return;
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(image, 0, 0, W, H);
    };
    image.src = snapshot;
    return () => {
      cancelled = true;
    };
  }, [H, W, snapshot, snapshotKey]);

  useEffect(() => {
    if (exportKey == null) return;
    const c = canvasRef.current;
    if (!c) {
      onExport?.(null);
      return;
    }
    exportMaskPayload(c, imageUrl)
      .then((payload) => onExport?.(payload))
      .catch(() => onExport?.(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportKey]);

  const getPos = (e: PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (W / rect.width),
      y: (e.clientY - rect.top) * (H / rect.height),
    };
  };

  const drawAt = (x: number, y: number) => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.globalCompositeOperation =
      mode === "erase" ? "destination-out" : "source-over";
    ctx.fillStyle = "rgba(16,160,108,0.85)";
    ctx.beginPath();
    ctx.arc(x, y, brushSize, 0, Math.PI * 2);
    ctx.fill();
  };

  const draw = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!painting) return;
    const p = getPos(e);
    setCursor(p);
    drawAt(p.x, p.y);
  };

  const handleKey = (event: KeyboardEvent<HTMLCanvasElement>) => {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      const c = canvasRef.current;
      const ctx = c?.getContext("2d");
      if (c && ctx) {
        ctx.clearRect(0, 0, W, H);
        onSnapshotChange?.(null);
        onClear?.();
      }
    } else if (event.key === "Escape") {
      (event.currentTarget as HTMLCanvasElement).blur();
    } else if (
      ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)
    ) {
      event.preventDefault();
      const step = event.shiftKey ? 48 : 16;
      setCursor((current) => ({
        x: Math.max(
          0,
          Math.min(
            W,
            current.x +
              (event.key === "ArrowRight"
                ? step
                : event.key === "ArrowLeft"
                  ? -step
                  : 0),
          ),
        ),
        y: Math.max(
          0,
          Math.min(
            H,
            current.y +
              (event.key === "ArrowDown"
                ? step
                : event.key === "ArrowUp"
                  ? -step
                  : 0),
          ),
        ),
      }));
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      drawAt(cursor.x, cursor.y);
      commitSnapshot();
    }
  };

  return (
    <div
      className="relative w-full overflow-hidden rounded-[10px] border border-border bg-sunken"
      style={{ aspectRatio: `${W} / ${H}`, touchAction: "none" }}
    >
      <div className="absolute inset-0">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            aria-hidden="true"
            loading="lazy"
            decoding="async"
            className="h-full w-full object-contain"
          />
        ) : (
          <PlaceholderImage seed={seed ?? 7} />
        )}
      </div>
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: "var(--mask-dim)" }}
        aria-hidden="true"
      />
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        tabIndex={0}
        role="application"
        aria-label={`选区绘制画布（${mode === "erase" ? "擦除模式" : "绘制模式"}）。拖动指针涂抹；键盘可用方向键移动，空格绘制，Delete 清除。`}
        onKeyDown={handleKey}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture(e.pointerId);
          setPainting(true);
          const p = getPos(e);
          setCursor(p);
          drawAt(p.x, p.y);
        }}
        onPointerMove={draw}
        onPointerUp={(e) => {
          (e.target as Element).releasePointerCapture(e.pointerId);
          setPainting(false);
          commitSnapshot();
        }}
        onPointerCancel={() => {
          setPainting(false);
          commitSnapshot();
        }}
        onPointerLeave={() => {
          if (painting) commitSnapshot();
          setPainting(false);
        }}
        className="absolute inset-0 w-full h-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--accent)]"
        style={{ cursor: mode === "erase" ? "cell" : "crosshair" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute rounded-full border border-foreground/90 shadow-[0_0_0_1px_var(--k-35)]"
        style={{
          width: Math.max(12, brushSize * 2 * 0.1),
          height: Math.max(12, brushSize * 2 * 0.1),
          left: `${(cursor.x / W) * 100}%`,
          top: `${(cursor.y / H) * 100}%`,
          transform: "translate(-50%, -50%)",
        }}
      />
    </div>
  );
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Canvas export failed"));
    }, "image/png");
  });
}

function loadImage(src?: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    if (!src) {
      reject(new Error("Missing image"));
      return;
    }
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

async function exportMaskPayload(
  selectionCanvas: HTMLCanvasElement,
  imageUrl?: string,
): Promise<MaskExport> {
  const width = selectionCanvas.width;
  const height = selectionCanvas.height;
  const image = await loadImage(imageUrl);

  const targetCanvas = document.createElement("canvas");
  targetCanvas.width = width;
  targetCanvas.height = height;
  const targetCtx = targetCanvas.getContext("2d");
  if (!targetCtx) throw new Error("Canvas unavailable");
  targetCtx.drawImage(image, 0, 0, width, height);

  const selectionCtx = selectionCanvas.getContext("2d");
  if (!selectionCtx) throw new Error("Canvas unavailable");
  const selectionData = selectionCtx.getImageData(0, 0, width, height);

  const nativeMaskCanvas = document.createElement("canvas");
  nativeMaskCanvas.width = width;
  nativeMaskCanvas.height = height;
  const nativeMaskCtx = nativeMaskCanvas.getContext("2d");
  if (!nativeMaskCtx) throw new Error("Canvas unavailable");
  const nativeMask = nativeMaskCtx.createImageData(width, height);
  let selectedPixels = 0;
  for (let i = 0; i < nativeMask.data.length; i += 4) {
    const selected = selectionData.data[i + 3] > 8;
    if (selected) selectedPixels += 1;
    nativeMask.data[i] = 255;
    nativeMask.data[i + 1] = 255;
    nativeMask.data[i + 2] = 255;
    nativeMask.data[i + 3] = selected ? 0 : 255;
  }
  nativeMaskCtx.putImageData(nativeMask, 0, 0);

  const hintCanvas = document.createElement("canvas");
  hintCanvas.width = width;
  hintCanvas.height = height;
  const hintCtx = hintCanvas.getContext("2d");
  if (!hintCtx) throw new Error("Canvas unavailable");
  hintCtx.drawImage(targetCanvas, 0, 0);
  hintCtx.drawImage(selectionCanvas, 0, 0);

  return {
    targetImage: await canvasToBlob(targetCanvas),
    nativeMask: await canvasToBlob(nativeMaskCanvas),
    selectionHint: await canvasToBlob(hintCanvas),
    hasSelection: selectedPixels > 0,
  };
}
