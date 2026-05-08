import { useEffect, useState } from "react";
import { loadEditDraft, saveEditDraft } from "@/lib/drafts";
import type { MaskMode, MaskTool } from "./mask-canvas";
import type { EditMode, RefWithFile } from "./shared";

export function useEditDraft({
  brushSize,
  editMode,
  format,
  maskMode,
  maskSnapshots,
  maskTool,
  n,
  persist,
  prompt,
  provider,
  quality,
  refs,
  selectedRef,
  setBrushSize,
  setEditMode,
  setFormat,
  setMaskSnapshots,
  setMaskTool,
  setN,
  setPrompt,
  setProvider,
  setQuality,
  setRefs,
  setSelectedRef,
  setSize,
  setTargetRefId,
  size,
  targetRefId,
}: {
  brushSize: number;
  editMode: EditMode;
  format: string;
  maskMode: MaskMode;
  maskSnapshots: Record<string, string>;
  maskTool: MaskTool;
  n: number;
  persist: boolean;
  prompt: string;
  provider: string;
  quality: string;
  refs: RefWithFile[];
  selectedRef: string | null;
  setBrushSize: (value: number) => void;
  setEditMode: (value: EditMode) => void;
  setFormat: (value: string) => void;
  setMaskSnapshots: (value: Record<string, string>) => void;
  setMaskTool: (value: MaskTool) => void;
  setN: (value: number) => void;
  setPrompt: (value: string) => void;
  setProvider: (value: string) => void;
  setQuality: (value: string) => void;
  setRefs: (updater: (prev: RefWithFile[]) => RefWithFile[]) => void;
  setSelectedRef: (value: string | null) => void;
  setSize: (value: string) => void;
  setTargetRefId: (value: string | null) => void;
  size: string;
  targetRefId: string | null;
}) {
  const [draftLoaded, setDraftLoaded] = useState(false);

  useEffect(() => {
    if (!persist) {
      setDraftLoaded(true);
      return;
    }
    let cancelled = false;
    void loadEditDraft()
      .then((draft) => {
        if (cancelled || !draft) return;
        setEditMode(draft.editMode);
        setPrompt(draft.prompt);
        setProvider(draft.provider);
        setSize(draft.size);
        setFormat(draft.format);
        setQuality(draft.quality);
        setN(draft.n);
        setRefs((prev) => {
          prev.forEach((ref) => URL.revokeObjectURL(ref.url));
          return draft.refs;
        });
        setSelectedRef(draft.selectedRef);
        setTargetRefId(draft.targetRefId);
        setBrushSize(draft.brushSize === 28 ? 12 : draft.brushSize);
        setMaskTool(
          draft.maskTool ?? (draft.maskMode === "erase" ? "erase" : "brush"),
        );
        setMaskSnapshots(draft.maskSnapshots);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setDraftLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [
    persist,
    setBrushSize,
    setEditMode,
    setFormat,
    setMaskSnapshots,
    setMaskTool,
    setN,
    setPrompt,
    setProvider,
    setQuality,
    setRefs,
    setSelectedRef,
    setSize,
    setTargetRefId,
  ]);

  useEffect(() => {
    if (!draftLoaded || !persist) return;
    const handle = window.setTimeout(() => {
      void saveEditDraft({
        editMode,
        prompt,
        provider,
        size,
        quality,
        format,
        n,
        refs,
        selectedRef,
        targetRefId,
        brushSize,
        maskTool,
        maskMode,
        maskSnapshots,
      }).catch(() => undefined);
    }, 500);
    return () => window.clearTimeout(handle);
  }, [
    brushSize,
    draftLoaded,
    editMode,
    format,
    maskMode,
    maskTool,
    maskSnapshots,
    n,
    persist,
    prompt,
    provider,
    quality,
    refs,
    selectedRef,
    size,
    targetRefId,
  ]);
}
