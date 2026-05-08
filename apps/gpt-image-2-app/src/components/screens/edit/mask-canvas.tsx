import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import { PlaceholderImage } from "@/components/screens/shared/placeholder-image";
import { exportMaskPayload, loadImage } from "./mask-export";

export type MaskMode = "paint" | "erase";
export type MaskTool = "brush" | "erase" | "rect" | "ellipse";
export type MaskExport = {
  targetImage: Blob;
  nativeMask: Blob;
  selectionHint: Blob;
  hasSelection: boolean;
};
export type MaskHistoryState = {
  canUndo: boolean;
  canRedo: boolean;
};
type MaskSnapshot = string | null;

export function MaskCanvas({
  imageUrl,
  seed,
  brushSize,
  mode,
  tool,
  snapshot,
  snapshotKey,
  onSnapshotChange,
  /** export trigger — when this value changes, we produce a Blob and fire `onExport` */
  exportKey,
  onExport,
  onClear,
  clearKey,
  undoKey,
  redoKey,
  onHistoryChange,
  zoom = 1,
  interactionMode = "paint",
  scrollContainerRef,
  onImageSizeChange,
}: {
  imageUrl?: string;
  seed?: number;
  brushSize: number;
  mode: MaskMode;
  tool?: MaskTool;
  snapshot?: string;
  snapshotKey?: string;
  onSnapshotChange?: (snapshot: string | null) => void;
  exportKey?: number;
  onExport?: (payload: MaskExport | null) => void;
  clearKey?: number;
  undoKey?: number;
  redoKey?: number;
  onClear?: () => void;
  onHistoryChange?: (state: MaskHistoryState) => void;
  zoom?: number;
  interactionMode?: "paint" | "pan";
  scrollContainerRef?: RefObject<HTMLElement | null>;
  onImageSizeChange?: (size: { width: number; height: number }) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const undoStackRef = useRef<MaskSnapshot[]>([]);
  const redoStackRef = useRef<MaskSnapshot[]>([]);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const lastClearKeyRef = useRef(clearKey);
  const lastUndoKeyRef = useRef(undoKey);
  const lastRedoKeyRef = useRef(redoKey);
  const shapeStartRef = useRef<{ x: number; y: number } | null>(null);
  const shapeBaseRef = useRef<ImageData | null>(null);
  const panStartRef = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const [painting, setPainting] = useState(false);
  const [panning, setPanning] = useState(false);
  const [historyState, setHistoryState] = useState<MaskHistoryState>({
    canUndo: false,
    canRedo: false,
  });
  const [cursor, setCursor] = useState({ x: 512, y: 512 });
  const [imageSize, setImageSize] = useState({ width: 1024, height: 1024 });
  const W = imageSize.width;
  const H = imageSize.height;
  const activeTool = tool ?? (mode === "erase" ? "erase" : "brush");
  const strokeWidth = tool ? brushSize : brushSize * 2;
  const displayWidth = Math.max(1, Math.round(W * zoom));
  const displayHeight = Math.max(1, Math.round(H * zoom));

  useEffect(() => {
    if (!imageUrl) {
      const fallback = { width: 1024, height: 1024 };
      setImageSize(fallback);
      onImageSizeChange?.(fallback);
      return;
    }
    let cancelled = false;
    loadImage(imageUrl)
      .then((image) => {
        if (cancelled) return;
        const next = {
          width: Math.max(1, image.naturalWidth),
          height: Math.max(1, image.naturalHeight),
        };
        setImageSize(next);
        onImageSizeChange?.(next);
      })
      .catch(() => {
        if (!cancelled) {
          const fallback = { width: 1024, height: 1024 };
          setImageSize(fallback);
          onImageSizeChange?.(fallback);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [imageUrl, onImageSizeChange]);

  const commitSnapshot = () => {
    const c = canvasRef.current;
    if (!c) return;
    onSnapshotChange?.(canvasSnapshot(c));
  };

  const hasMaskPixels = (
    c: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
  ) => {
    try {
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 8) return true;
      }
    } catch {
      return true;
    }
    return false;
  };

  const canvasSnapshot = (c: HTMLCanvasElement) => {
    const ctx = c.getContext("2d");
    if (!ctx || !hasMaskPixels(c, ctx)) return null;
    return c.toDataURL("image/png");
  };

  const syncHistoryState = () => {
    const next = {
      canUndo: undoStackRef.current.length > 0,
      canRedo: redoStackRef.current.length > 0,
    };
    setHistoryState((current) =>
      current.canUndo === next.canUndo && current.canRedo === next.canRedo
        ? current
        : next,
    );
  };

  const pushUndoSnapshot = (options: { skipEmpty?: boolean } = {}) => {
    const c = canvasRef.current;
    if (!c) return;
    const snapshot = canvasSnapshot(c);
    if (options.skipEmpty && snapshot == null) {
      redoStackRef.current = [];
      syncHistoryState();
      return;
    }
    const undoStack = undoStackRef.current;
    if (
      undoStack.length === 0 ||
      undoStack[undoStack.length - 1] !== snapshot
    ) {
      undoStack.push(snapshot);
      if (undoStack.length > 30) undoStack.shift();
    }
    redoStackRef.current = [];
    syncHistoryState();
  };

  const applySnapshot = (nextSnapshot: string | null) => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, W, H);
    if (!nextSnapshot) {
      onSnapshotChange?.(null);
      onClear?.();
      return;
    }
    const image = new Image();
    image.onload = () => {
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(image, 0, 0, W, H);
      onSnapshotChange?.(nextSnapshot);
    };
    image.src = nextSnapshot;
  };

  const undo = () => {
    const previous = undoStackRef.current.pop();
    if (previous === undefined) return;
    const c = canvasRef.current;
    if (c) {
      redoStackRef.current.push(canvasSnapshot(c));
      if (redoStackRef.current.length > 30) redoStackRef.current.shift();
    }
    applySnapshot(previous);
    syncHistoryState();
  };

  const redo = () => {
    const next = redoStackRef.current.pop();
    if (next === undefined) return;
    const c = canvasRef.current;
    if (c) {
      undoStackRef.current.push(canvasSnapshot(c));
      if (undoStackRef.current.length > 30) undoStackRef.current.shift();
    }
    applySnapshot(next);
    syncHistoryState();
  };

  useEffect(() => {
    onHistoryChange?.(historyState);
  }, [historyState, onHistoryChange]);

  useEffect(() => {
    const shouldClear =
      lastClearKeyRef.current !== clearKey && clearKey !== undefined;
    lastClearKeyRef.current = clearKey;
    if (!shouldClear) return;
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    pushUndoSnapshot({ skipEmpty: true });
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, c.width, c.height);
    onClear?.();
    onSnapshotChange?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearKey]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, W, H);
    if (!snapshot) return;
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(image, 0, 0, W, H);
    };
    image.src = snapshot;
    return () => {
      cancelled = true;
    };
  }, [H, W, snapshot, snapshotKey]);

  useEffect(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    syncHistoryState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [H, W, imageUrl]);

  useEffect(() => {
    if (lastUndoKeyRef.current === undoKey) return;
    lastUndoKeyRef.current = undoKey;
    if (undoKey === undefined) return;
    undo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undoKey]);

  useEffect(() => {
    if (lastRedoKeyRef.current === redoKey) return;
    lastRedoKeyRef.current = redoKey;
    if (redoKey === undefined) return;
    redo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [redoKey]);

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

  const context = () => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    return c && ctx ? { c, ctx } : null;
  };

  const configureStroke = (ctx: CanvasRenderingContext2D) => {
    ctx.globalCompositeOperation =
      activeTool === "erase" ? "destination-out" : "source-over";
    ctx.fillStyle = "rgba(16,160,108,0.85)";
    ctx.strokeStyle = "rgba(16,160,108,0.88)";
    ctx.lineWidth = Math.max(1, strokeWidth);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  };

  const drawAt = (x: number, y: number) => {
    const target = context();
    if (!target) return;
    const { ctx } = target;
    ctx.save();
    configureStroke(ctx);
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1, strokeWidth / 2), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  const drawLine = (
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) => {
    const target = context();
    if (!target) return;
    const { ctx } = target;
    ctx.save();
    configureStroke(ctx);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
  };

  const drawShape = (
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) => {
    const target = context();
    if (!target) return;
    const { ctx } = target;
    ctx.save();
    configureStroke(ctx);
    ctx.globalCompositeOperation = "source-over";
    const x = Math.min(from.x, to.x);
    const y = Math.min(from.y, to.y);
    const width = Math.abs(to.x - from.x);
    const height = Math.abs(to.y - from.y);
    if (width < 1 || height < 1) {
      ctx.restore();
      return;
    }
    ctx.beginPath();
    if (activeTool === "rect") {
      ctx.rect(x, y, width, height);
    } else {
      ctx.ellipse(
        x + width / 2,
        y + height / 2,
        width / 2,
        height / 2,
        0,
        0,
        Math.PI * 2,
      );
    }
    ctx.stroke();
    ctx.restore();
  };

  const draw = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!painting) return;
    const p = getPos(e);
    setCursor(p);
    if (activeTool === "rect" || activeTool === "ellipse") {
      const target = context();
      const start = shapeStartRef.current;
      const base = shapeBaseRef.current;
      if (!target || !start || !base) return;
      target.ctx.putImageData(base, 0, 0);
      drawShape(start, p);
      return;
    }
    const last = lastPointRef.current;
    if (last) drawLine(last, p);
    else drawAt(p.x, p.y);
    lastPointRef.current = p;
  };

  const startPan = (event: PointerEvent<HTMLCanvasElement>) => {
    const scrollContainer = scrollContainerRef?.current;
    if (!scrollContainer) return false;
    panStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      left: scrollContainer.scrollLeft,
      top: scrollContainer.scrollTop,
    };
    setPanning(true);
    return true;
  };

  const pan = (event: PointerEvent<HTMLCanvasElement>) => {
    const start = panStartRef.current;
    const scrollContainer = scrollContainerRef?.current;
    if (!start || !scrollContainer) return;
    scrollContainer.scrollLeft = start.left - (event.clientX - start.x);
    scrollContainer.scrollTop = start.top - (event.clientY - start.y);
  };

  const endGesture = () => {
    if (painting) commitSnapshot();
    setPainting(false);
    setPanning(false);
    panStartRef.current = null;
    lastPointRef.current = null;
    shapeStartRef.current = null;
    shapeBaseRef.current = null;
  };

  const handleKey = (event: KeyboardEvent<HTMLCanvasElement>) => {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      const c = canvasRef.current;
      const ctx = c?.getContext("2d");
      if (c && ctx) {
        pushUndoSnapshot({ skipEmpty: true });
        ctx.globalCompositeOperation = "source-over";
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
      if (activeTool === "brush" || activeTool === "erase") {
        pushUndoSnapshot();
        drawAt(cursor.x, cursor.y);
        commitSnapshot();
      }
    }
  };

  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-[10px] border border-border bg-sunken"
      style={{
        width: displayWidth,
        height: displayHeight,
        touchAction: "none",
      }}
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
        aria-label={`选区绘制画布（${activeTool === "erase" ? "擦除模式" : "绘制模式"}）。拖动指针涂抹；键盘可用方向键移动，空格绘制，Delete 清除。`}
        onKeyDown={handleKey}
        onPointerDown={(e) => {
          if (interactionMode === "pan" || e.button === 1) {
            e.preventDefault();
            (e.target as Element).setPointerCapture(e.pointerId);
            startPan(e);
            return;
          }
          if (e.button !== 0) return;
          (e.target as Element).setPointerCapture(e.pointerId);
          pushUndoSnapshot();
          setPainting(true);
          const p = getPos(e);
          setCursor(p);
          if (activeTool === "rect" || activeTool === "ellipse") {
            const target = context();
            if (target) {
              shapeStartRef.current = p;
              shapeBaseRef.current = target.ctx.getImageData(0, 0, W, H);
            }
          } else {
            lastPointRef.current = p;
            drawAt(p.x, p.y);
          }
        }}
        onPointerMove={(e) => {
          if (panning) {
            pan(e);
            return;
          }
          draw(e);
        }}
        onPointerUp={(e) => {
          (e.target as Element).releasePointerCapture(e.pointerId);
          if (painting && !panning) {
            draw(e);
          }
          endGesture();
        }}
        onPointerCancel={endGesture}
        className="absolute inset-0 w-full h-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--accent)]"
        style={{
          cursor: panning
            ? "grabbing"
            : interactionMode === "pan"
              ? "grab"
              : activeTool === "erase"
                ? "cell"
                : "crosshair",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute rounded-full border border-foreground/90 shadow-[0_0_0_1px_var(--k-35)]"
        style={{
          width: Math.max(8, strokeWidth * zoom),
          height: Math.max(8, strokeWidth * zoom),
          left: `${(cursor.x / W) * 100}%`,
          top: `${(cursor.y / H) * 100}%`,
          transform: "translate(-50%, -50%)",
        }}
      />
    </div>
  );
}
