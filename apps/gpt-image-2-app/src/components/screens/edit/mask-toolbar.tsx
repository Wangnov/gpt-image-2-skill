import { type ReactNode, type RefObject } from "react";
import {
  Brush,
  Circle,
  Eraser,
  Maximize2,
  Move,
  Redo2,
  SlidersHorizontal,
  Square,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import type { MaskHistoryState, MaskTool } from "./mask-canvas";

function MaskToolbarTip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <span className="group/masktip relative inline-flex shrink-0">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-border-faint bg-[color:var(--bg-popover)] px-2 py-1 text-[11px] font-medium text-foreground opacity-0 shadow-popover backdrop-blur transition-opacity group-focus-within/masktip:opacity-100 group-hover/masktip:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}

export function MaskToolbar({
  hostRef,
  toolbarRef,
  scale,
  maskTool,
  setMaskTool,
  brushSize,
  setBrushSize,
  maskHistory,
  triggerUndo,
  triggerRedo,
  clearMask,
  fitCanvasToViewport,
  zoom,
  zoomOut,
  zoomIn,
  panPinned,
  setPanPinned,
}: {
  hostRef: RefObject<HTMLDivElement | null>;
  toolbarRef: RefObject<HTMLDivElement | null>;
  scale: number;
  maskTool: MaskTool;
  setMaskTool: (tool: MaskTool) => void;
  brushSize: number;
  setBrushSize: (size: number) => void;
  maskHistory: MaskHistoryState;
  triggerUndo: () => void;
  triggerRedo: () => void;
  clearMask: () => void;
  fitCanvasToViewport: () => void;
  zoom: number;
  zoomOut: () => void;
  zoomIn: () => void;
  panPinned: boolean;
  setPanPinned: (value: boolean | ((current: boolean) => boolean)) => void;
}) {
  return (
    <div
      ref={hostRef}
      className="pointer-events-none absolute inset-x-4 bottom-4 z-10 flex justify-center overflow-visible"
    >
      <div
        ref={toolbarRef}
        className="pointer-events-auto flex w-max flex-nowrap items-center justify-start gap-1.5 rounded-2xl border border-[color:var(--accent-25)] px-2 py-1.5 backdrop-blur-xl"
        style={{
          background:
            "linear-gradient(135deg, rgba(var(--accent-rgb), 0.22), rgba(var(--accent-2-rgb), 0.14)), var(--bg-raised)",
          boxShadow: "var(--shadow-floating), inset 0 1px 0 var(--w-12)",
          transform: `scale(${scale})`,
          transformOrigin: "bottom center",
          transition: "transform 140ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        <div className="flex shrink-0 items-center gap-0.5">
          <MaskToolbarTip label="画笔">
            <button
              type="button"
              onClick={() => setMaskTool("brush")}
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-[color:var(--w-08)] hover:text-foreground",
                maskTool === "brush" &&
                  "bg-[color:var(--accent-18)] text-foreground",
              )}
              aria-label="画笔"
              aria-pressed={maskTool === "brush"}
            >
              <Brush size={15} />
            </button>
          </MaskToolbarTip>
          <MaskToolbarTip label="橡皮">
            <button
              type="button"
              onClick={() => setMaskTool("erase")}
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-[color:var(--w-08)] hover:text-foreground",
                maskTool === "erase" &&
                  "bg-[color:var(--accent-18)] text-foreground",
              )}
              aria-label="橡皮"
              aria-pressed={maskTool === "erase"}
            >
              <Eraser size={15} />
            </button>
          </MaskToolbarTip>
          <MaskToolbarTip label="方形选区">
            <button
              type="button"
              onClick={() => setMaskTool("rect")}
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-[color:var(--w-08)] hover:text-foreground",
                maskTool === "rect" &&
                  "bg-[color:var(--accent-18)] text-foreground",
              )}
              aria-label="方形选区"
              aria-pressed={maskTool === "rect"}
            >
              <Square size={15} />
            </button>
          </MaskToolbarTip>
          <MaskToolbarTip label="圆形选区">
            <button
              type="button"
              onClick={() => setMaskTool("ellipse")}
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-[color:var(--w-08)] hover:text-foreground",
                maskTool === "ellipse" &&
                  "bg-[color:var(--accent-18)] text-foreground",
              )}
              aria-label="圆形选区"
              aria-pressed={maskTool === "ellipse"}
            >
              <Circle size={15} />
            </button>
          </MaskToolbarTip>
          <MaskToolbarTip label="清空选区">
            <button
              type="button"
              onClick={clearMask}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-[color:var(--status-err-10)] hover:text-[color:var(--status-err)]"
              aria-label="清空选区"
            >
              <Trash2 size={15} />
            </button>
          </MaskToolbarTip>
        </div>
        <div className="h-5 w-px shrink-0 bg-border-faint" aria-hidden />
        <div className="flex shrink-0 items-center gap-0.5">
          <MaskToolbarTip label="撤回">
            <button
              type="button"
              onClick={triggerUndo}
              disabled={!maskHistory.canUndo}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-[color:var(--w-08)] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
              aria-label="撤回"
            >
              <Undo2 size={15} />
            </button>
          </MaskToolbarTip>
          <MaskToolbarTip label="重做">
            <button
              type="button"
              onClick={triggerRedo}
              disabled={!maskHistory.canRedo}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-[color:var(--w-08)] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
              aria-label="重做"
            >
              <Redo2 size={15} />
            </button>
          </MaskToolbarTip>
        </div>
        <div className="h-5 w-px shrink-0 bg-border-faint" aria-hidden />
        <Popover>
          <MaskToolbarTip label="调整粗细">
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-[color:var(--w-08)]"
                aria-label="调整粗细"
              >
                <SlidersHorizontal size={14} />
              </button>
            </PopoverTrigger>
          </MaskToolbarTip>
          <PopoverContent side="top" align="center" className="w-[210px]">
            <div className="flex items-center justify-between gap-3">
              <span className="t-caps">粗细</span>
              <span className="font-mono text-[11px] text-muted">
                {brushSize}
              </span>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <span
                aria-hidden
                className="shrink-0 rounded-full border border-[color:var(--accent-45)] bg-[color:var(--accent-18)]"
                style={{
                  width: Math.max(6, Math.min(28, brushSize / 2)),
                  height: Math.max(6, Math.min(28, brushSize / 2)),
                }}
              />
              <input
                type="range"
                min={2}
                max={72}
                step={1}
                value={brushSize}
                onChange={(event) => setBrushSize(Number(event.target.value))}
                className="h-5 flex-1 accent-[color:var(--accent)]"
                aria-label="选区工具粗细"
              />
            </div>
          </PopoverContent>
        </Popover>
        <MaskToolbarTip label="适应窗口">
          <button
            type="button"
            onClick={fitCanvasToViewport}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-foreground hover:bg-[color:var(--w-08)]"
            aria-label="适应窗口"
          >
            <Maximize2 size={13} />
          </button>
        </MaskToolbarTip>
        <MaskToolbarTip label="缩小">
          <button
            type="button"
            onClick={zoomOut}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-foreground hover:bg-[color:var(--w-08)]"
            aria-label="缩小"
          >
            <ZoomOut size={13} />
          </button>
        </MaskToolbarTip>
        <MaskToolbarTip label="放大">
          <button
            type="button"
            onClick={zoomIn}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-foreground hover:bg-[color:var(--w-08)]"
            aria-label="放大"
          >
            <ZoomIn size={13} />
          </button>
        </MaskToolbarTip>
        <MaskToolbarTip label="平移">
          <button
            type="button"
            onClick={() => setPanPinned((current) => !current)}
            className={cn(
              "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-foreground hover:bg-[color:var(--w-08)]",
              panPinned && "bg-[color:var(--accent-18)]",
            )}
            aria-label="平移"
            aria-pressed={panPinned}
          >
            <Move size={13} />
          </button>
        </MaskToolbarTip>
        <span className="shrink-0 px-1 font-mono text-[10.5px] text-faint">
          {Math.round(zoom * 100)}%
        </span>
      </div>
    </div>
  );
}
