import { type DragEvent, type RefObject } from "react";
import { motion } from "motion/react";
import { Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { cn } from "@/lib/cn";
import {
  MaskCanvas,
  type MaskExport,
  type MaskHistoryState,
  type MaskMode,
  type MaskTool,
} from "./mask-canvas";
import { MaskToolbar } from "./mask-toolbar";
import { clampZoom, type RefWithFile } from "./shared";

export function EditCanvasStage({
  usesRegion,
  targetRef,
  selectedRefObj,
  refs,
  fileInputRef,
  isDraggingImages,
  reducedMotion,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  maskToolbarHostRef,
  maskToolbarRef,
  maskToolbarScale,
  maskTool,
  setMaskTool,
  brushSize,
  setBrushSize,
  maskHistory,
  onMaskHistoryChange,
  triggerMaskUndo,
  triggerMaskRedo,
  setClearKey,
  fitCanvasToViewport,
  zoom,
  setZoom,
  panPinned,
  setPanPinned,
  canvasViewportRef,
  maskMode,
  clearKey,
  undoKey,
  redoKey,
  maskSnapshots,
  setMaskSnapshots,
  exportKey,
  onExport,
  panMode,
  handleMaskImageSize,
}: {
  usesRegion: boolean;
  targetRef?: RefWithFile;
  selectedRefObj?: RefWithFile;
  refs: RefWithFile[];
  fileInputRef: RefObject<HTMLInputElement | null>;
  isDraggingImages: boolean;
  reducedMotion: boolean;
  onDragEnter: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  maskToolbarHostRef: RefObject<HTMLDivElement | null>;
  maskToolbarRef: RefObject<HTMLDivElement | null>;
  maskToolbarScale: number;
  maskTool: MaskTool;
  setMaskTool: (tool: MaskTool) => void;
  brushSize: number;
  setBrushSize: (size: number) => void;
  maskHistory: MaskHistoryState;
  onMaskHistoryChange: (state: MaskHistoryState) => void;
  triggerMaskUndo: () => void;
  triggerMaskRedo: () => void;
  setClearKey: (value: number | ((current: number) => number)) => void;
  fitCanvasToViewport: () => void;
  zoom: number;
  setZoom: (value: number | ((current: number) => number)) => void;
  panPinned: boolean;
  setPanPinned: (value: boolean | ((current: boolean) => boolean)) => void;
  canvasViewportRef: RefObject<HTMLDivElement | null>;
  maskMode: MaskMode;
  clearKey: number;
  undoKey: number;
  redoKey: number;
  maskSnapshots: Record<string, string>;
  setMaskSnapshots: (
    value:
      | Record<string, string>
      | ((current: Record<string, string>) => Record<string, string>),
  ) => void;
  exportKey: number | null;
  onExport: (payload: MaskExport | null) => void;
  panMode: boolean;
  handleMaskImageSize: (size: { width: number; height: number }) => void;
}) {
  return (
    <main className="flex-1 min-h-0 px-4 py-2 flex items-center justify-center overflow-hidden">
      <div
        className="surface-panel relative flex h-full w-full items-center justify-center overflow-hidden p-0"
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <motion.div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-[inherit] border border-dashed",
            "bg-[color:var(--w-08)] backdrop-blur-md transition-[border-color,box-shadow] duration-200 ease-out",
            isDraggingImages
              ? "border-[color:var(--accent)] shadow-[0_0_0_1px_var(--accent-faint),var(--shadow-accent-glow)]"
              : "border-transparent",
          )}
          animate={
            reducedMotion
              ? { opacity: isDraggingImages ? 1 : 0 }
              : {
                  opacity: isDraggingImages ? 1 : 0,
                  scale: isDraggingImages ? 1 : 0.985,
                  y: isDraggingImages ? 0 : 2,
                }
          }
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        >
          <motion.div
            className="flex flex-col items-center gap-2 rounded-xl border border-border-faint bg-[color:var(--w-08)] px-4 py-3 text-center shadow-popover"
            animate={
              reducedMotion ? undefined : { scale: isDraggingImages ? 1.02 : 1 }
            }
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <ImageIcon size={20} style={{ color: "var(--accent)" }} />
            <div className="text-[13px] font-semibold text-foreground">
              松开添加参考图
            </div>
            <div className="text-[11px] text-muted">
              支持拖拽图片，也支持直接粘贴剪贴板图片
            </div>
          </motion.div>
        </motion.div>
        {usesRegion ? (
          targetRef ? (
            <div className="h-full w-full">
              <MaskToolbar
                hostRef={maskToolbarHostRef}
                toolbarRef={maskToolbarRef}
                scale={maskToolbarScale}
                maskTool={maskTool}
                setMaskTool={setMaskTool}
                brushSize={brushSize}
                setBrushSize={setBrushSize}
                maskHistory={maskHistory}
                triggerUndo={triggerMaskUndo}
                triggerRedo={triggerMaskRedo}
                clearMask={() => setClearKey((key) => key + 1)}
                fitCanvasToViewport={fitCanvasToViewport}
                zoom={zoom}
                zoomOut={() =>
                  setZoom((current) => clampZoom(current * 0.88))
                }
                zoomIn={() => setZoom((current) => clampZoom(current * 1.14))}
                panPinned={panPinned}
                setPanPinned={setPanPinned}
              />
              <div
                ref={canvasViewportRef}
                className="h-full w-full overflow-auto p-4 scrollbar-thin"
                onWheel={(event) => {
                  if (!event.metaKey && !event.ctrlKey) return;
                  event.preventDefault();
                  const next = event.deltaY < 0 ? 1.08 : 0.92;
                  setZoom((current) => clampZoom(current * next));
                }}
              >
                <div className="flex min-h-full min-w-full items-center justify-center">
                  <MaskCanvas
                    imageUrl={targetRef.url}
                    seed={0}
                    brushSize={brushSize}
                    mode={maskMode}
                    tool={maskTool}
                    clearKey={clearKey}
                    undoKey={undoKey}
                    redoKey={redoKey}
                    snapshot={maskSnapshots[targetRef.id]}
                    snapshotKey={targetRef.id}
                    zoom={zoom}
                    interactionMode={panMode ? "pan" : "paint"}
                    scrollContainerRef={canvasViewportRef}
                    onImageSizeChange={handleMaskImageSize}
                    onHistoryChange={onMaskHistoryChange}
                    onSnapshotChange={(snapshot) => {
                      setMaskSnapshots((current) => {
                        if (snapshot)
                          return { ...current, [targetRef.id]: snapshot };
                        const { [targetRef.id]: _removed, ...rest } = current;
                        return rest;
                      });
                    }}
                    exportKey={exportKey ?? undefined}
                    onExport={(payload) => onExport(payload)}
                  />
                </div>
              </div>
            </div>
          ) : (
            <Empty
              icon="mask"
              title="请上传并设定目标图"
              subtitle="或拖入图片、粘贴剪贴板图片。"
              action={
                <Button
                  variant="primary"
                  size="md"
                  icon="plus"
                  onClick={() => fileInputRef.current?.click()}
                >
                  选择图片
                </Button>
              }
            />
          )
        ) : selectedRefObj || refs[0] ? (
          <img
            src={(selectedRefObj ?? refs[0]).url}
            alt={(selectedRefObj ?? refs[0]).name}
            className="max-h-full max-w-full object-contain rounded-md"
          />
        ) : (
          <Empty
            icon="image"
            title="请上传至少一张参考图"
            subtitle="或拖入图片、粘贴剪贴板图片。"
            action={
              <Button
                variant="primary"
                size="md"
                icon="plus"
                onClick={() => fileInputRef.current?.click()}
              >
                选择图片
              </Button>
            }
          />
        )}
      </div>
    </main>
  );
}
