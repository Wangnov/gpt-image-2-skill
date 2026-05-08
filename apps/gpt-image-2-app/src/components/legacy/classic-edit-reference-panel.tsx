import { type RefObject } from "react";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import type { RefWithFile } from "@/components/screens/edit/shared";
import { ClassicEditReferenceTile } from "./classic-edit-reference-tile";

export function ClassicEditReferencePanel({
  addRef,
  fileInputRef,
  maskSnapshots,
  maxReferenceImages,
  refs,
  removeRef,
  selectedRef,
  setSelectedRef,
  setTargetRefId,
  targetRef,
  usesRegion,
}: {
  addRef: (files: FileList | null) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  maskSnapshots: Record<string, string>;
  maxReferenceImages: number;
  refs: RefWithFile[];
  removeRef: (id: string) => void;
  selectedRef: string | null;
  setSelectedRef: (id: string) => void;
  setTargetRefId: (id: string) => void;
  targetRef?: RefWithFile;
  usesRegion: boolean;
}) {
  return (
    <section className="edit-refs surface-panel flex min-h-0 flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-border-faint px-3 py-2.5">
        <div>
          <div className="t-h3">参考图</div>
          <div className="t-small">
            {refs.length}/{maxReferenceImages} · 可拖拽或粘贴
          </div>
        </div>
        <Button
          variant="ghost"
          size="iconSm"
          icon="plus"
          onClick={() => fileInputRef.current?.click()}
          disabled={refs.length >= maxReferenceImages}
          aria-label="添加参考图"
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            addRef(event.target.files);
            if (fileInputRef.current) fileInputRef.current.value = "";
          }}
        />
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {refs.length === 0 ? (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex min-h-[132px] w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong bg-[color:var(--w-02)] p-4 text-center text-muted hover:border-foreground/30 hover:text-foreground"
          >
            <Icon name="upload" size={22} />
            <span className="text-[13px] font-semibold">添加参考图</span>
            <span className="max-w-[220px] text-[11.5px]">
              拖进这里，或直接粘贴剪贴板图片。
            </span>
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {refs.map((ref) => (
              <ClassicEditReferenceTile
                key={ref.id}
                ref_={ref}
                active={ref.id === selectedRef}
                role={
                  usesRegion
                    ? ref.id === targetRef?.id
                      ? "target"
                      : "reference"
                    : undefined
                }
                hasMask={Boolean(maskSnapshots[ref.id])}
                onSelect={() => setSelectedRef(ref.id)}
                onSetTarget={
                  usesRegion
                    ? () => {
                        setTargetRefId(ref.id);
                        setSelectedRef(ref.id);
                      }
                    : undefined
                }
                onRemove={() => removeRef(ref.id)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
