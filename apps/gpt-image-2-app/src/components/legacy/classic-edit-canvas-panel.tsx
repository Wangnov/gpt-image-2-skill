import { Empty } from "@/components/ui/empty";
import { Icon } from "@/components/icon";
import { OutputTile } from "@/components/screens/shared/output-tile";
import {
  MaskCanvas,
  type MaskExport,
  type MaskMode,
} from "@/components/screens/edit/mask-canvas";
import type { RefWithFile } from "@/components/screens/edit/shared";
import { openPath, saveImages } from "@/lib/user-actions";
import type { ClassicEditOutput } from "./classic-edit-shared";

export function ClassicEditCanvasPanel({
  brushSize,
  clearKey,
  exportKey,
  isDraggingImages,
  maskMode,
  maskSnapshots,
  outputs,
  selectedPath,
  selectedRefObj,
  setMaskSnapshots,
  setSelectedOutput,
  submit,
  targetRef,
  usesRegion,
}: {
  brushSize: number;
  clearKey: number;
  exportKey: number | null;
  isDraggingImages: boolean;
  maskMode: MaskMode;
  maskSnapshots: Record<string, string>;
  outputs: ClassicEditOutput[];
  selectedPath?: string;
  selectedRefObj?: RefWithFile;
  setMaskSnapshots: (
    updater: (prev: Record<string, string>) => Record<string, string>,
  ) => void;
  setSelectedOutput: (index: number) => void;
  submit: (payload: MaskExport | null) => void;
  targetRef?: RefWithFile;
  usesRegion: boolean;
}) {
  return (
    <section className="edit-canvas surface-panel relative flex min-h-0 flex-col overflow-hidden">
      {isDraggingImages && (
        <div className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-lg border border-dashed border-[color:var(--accent)] bg-[color:var(--accent-10)] text-[13px] font-semibold text-foreground">
          松开即可添加参考图
        </div>
      )}
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
        {usesRegion && targetRef ? (
          <div className="w-full max-w-[780px]">
            <MaskCanvas
              imageUrl={targetRef.url}
              seed={11}
              brushSize={brushSize}
              mode={maskMode}
              snapshot={maskSnapshots[targetRef.id]}
              snapshotKey={targetRef.id}
              onSnapshotChange={(snapshot) => {
                setMaskSnapshots((prev) => {
                  const next = { ...prev };
                  if (snapshot) next[targetRef.id] = snapshot;
                  else delete next[targetRef.id];
                  return next;
                });
              }}
              exportKey={exportKey ?? undefined}
              onExport={(payload) => submit(payload)}
              clearKey={clearKey}
            />
          </div>
        ) : selectedRefObj ? (
          <div className="max-h-full max-w-full overflow-hidden rounded-lg border border-border bg-sunken">
            <img
              src={selectedRefObj.url}
              alt=""
              className="max-h-[62vh] max-w-full object-contain"
              draggable={false}
            />
          </div>
        ) : (
          <Empty
            icon="image"
            title="等待参考图"
            subtitle="拖拽、粘贴或点击左侧按钮添加图片。"
          />
        )}
      </div>

      <div className="border-t border-border-faint p-3">
        {outputs.length > 0 ? (
          <div className="grid grid-cols-4 gap-2 xl:grid-cols-6">
            {outputs.map((output) => (
              <OutputTile
                key={output.index}
                output={output}
                onSelect={() => setSelectedOutput(output.index)}
                onDownload={() => saveImages([selectedPath], "图片")}
                onOpen={selectedPath ? () => void openPath(selectedPath) : undefined}
              />
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-[12px] text-faint">
            <Icon name="history" size={13} />
            输出会显示在这里，任务也会同步进入任务页。
          </div>
        )}
      </div>
    </section>
  );
}
