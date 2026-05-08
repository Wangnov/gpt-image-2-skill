import { type DragEvent, type RefObject, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { isTauriRuntime, useGlobalImagePaste, useTauriImageDrop } from "@/hooks/use-image-ingest";
import {
  dataTransferHasImage,
  imageFilesFromDataTransfer,
  normalizeImageFiles,
  type ImageFileSource,
} from "@/lib/image-input";
import {
  SEND_TO_EDIT_EVENT,
  type SendToEditPayload,
} from "@/lib/job-navigation";
import {
  transferredImageFile,
  type RefWithFile,
} from "./shared";

export function useReferenceImages({
  refs,
  setRefs,
  refsRef,
  dragDepthRef,
  maxReferenceImages,
  selectedRef,
  setSelectedRef,
  targetRefId,
  setTargetRefId,
  setPrompt,
  setMaskSnapshots,
  setIsDraggingImages,
}: {
  refs: RefWithFile[];
  setRefs: (value: RefWithFile[] | ((current: RefWithFile[]) => RefWithFile[])) => void;
  refsRef: RefObject<RefWithFile[]>;
  dragDepthRef: RefObject<number>;
  maxReferenceImages: number;
  selectedRef: string | null;
  setSelectedRef: (value: string | null | ((current: string | null) => string | null)) => void;
  targetRefId: string | null;
  setTargetRefId: (value: string | null | ((current: string | null) => string | null)) => void;
  setPrompt: (value: string) => void;
  setMaskSnapshots: (
    value:
      | Record<string, string>
      | ((current: Record<string, string>) => Record<string, string>),
  ) => void;
  setIsDraggingImages: (value: boolean) => void;
}) {
  const addRefFiles = useCallback(
    (imageFiles: File[], source: ImageFileSource, ignored = 0) => {
      if (ignored > 0) {
        toast.warning("已忽略非图片文件", {
          description: `跳过 ${ignored} 个不支持的文件。`,
        });
      }
      if (imageFiles.length === 0) {
        if (ignored > 0) {
          toast.error("没有可添加的图片", {
            description: "请拖入、粘贴或选择图片文件。",
          });
        }
        return;
      }

      const additions = imageFiles.map((file, index) => ({
        id: `r-${Date.now()}-${index}`,
        name: file.name,
        url: URL.createObjectURL(file),
        file,
      }));
      const currentRefs = refsRef.current;
      const available = Math.max(0, maxReferenceImages - currentRefs.length);
      if (available === 0) {
        additions.forEach((ref) => URL.revokeObjectURL(ref.url));
        toast.error("参考图已达上限", {
          description: `最多上传 ${maxReferenceImages} 张。`,
        });
        return;
      }

      const accepted = additions.slice(0, available);
      additions.slice(available).forEach((ref) => URL.revokeObjectURL(ref.url));
      const nextRefs = [...currentRefs, ...accepted];
      refsRef.current = nextRefs;
      setRefs(nextRefs);

      const firstAcceptedId = accepted[0]?.id;
      if (firstAcceptedId) {
        setSelectedRef((current) => current ?? firstAcceptedId);
        setTargetRefId((current) => current ?? firstAcceptedId);
      }
      if (accepted.length < additions.length) {
        toast.warning("已按上限添加参考图", {
          description: `最多上传 ${maxReferenceImages} 张。`,
        });
      }
      if (source === "drop") {
        toast.success(`已添加 ${accepted.length} 张参考图`, {
          description: "来自拖拽上传。",
        });
      }
      if (source === "paste") {
        toast.success(`已添加 ${accepted.length} 张参考图`, {
          description: "来自剪贴板。",
        });
      }
    },
    [maxReferenceImages, refsRef, setRefs, setSelectedRef, setTargetRefId],
  );

  const addRef = (
    files: FileList | null,
    source: ImageFileSource = "picker",
  ) => {
    const result = normalizeImageFiles(files, { source });
    addRefFiles(result.files, source, result.ignored);
  };

  const handleSendToEdit = useCallback(
    async (payload: SendToEditPayload) => {
      if (refsRef.current.length >= maxReferenceImages) {
        toast.error("参考图已达上限", {
          description: `最多上传 ${maxReferenceImages} 张。`,
        });
        return;
      }
      const toastId = toast.loading("正在发送到编辑");
      try {
        const file = await transferredImageFile(payload);
        if (refsRef.current.length >= maxReferenceImages) {
          toast.error("参考图已达上限", {
            id: toastId,
            description: `最多上传 ${maxReferenceImages} 张。`,
          });
          return;
        }
        addRefFiles([file], "picker");
        if (payload.prompt && payload.prompt.trim().length > 0) {
          setPrompt(payload.prompt);
        }
        toast.success("已发送到编辑", {
          id: toastId,
          description: "已作为新的参考图添加。",
        });
      } catch (error) {
        toast.error("发送到编辑失败", {
          id: toastId,
          description: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [addRefFiles, maxReferenceImages, refsRef, setPrompt],
  );

  useEffect(() => {
    const onSendToEdit = (event: Event) => {
      const detail = (event as CustomEvent<SendToEditPayload>).detail;
      if (!detail) return;
      void handleSendToEdit(detail);
    };
    window.addEventListener(SEND_TO_EDIT_EVENT, onSendToEdit);
    return () => window.removeEventListener(SEND_TO_EDIT_EVENT, onSendToEdit);
  }, [handleSendToEdit]);

  useGlobalImagePaste(addRefFiles);
  useTauriImageDrop(addRefFiles, setIsDraggingImages);

  const handleCanvasDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (isTauriRuntime()) {
      event.preventDefault();
      return;
    }
    if (!dataTransferHasImage(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingImages(true);
  };

  const handleCanvasDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (isTauriRuntime()) {
      event.preventDefault();
      return;
    }
    if (!dataTransferHasImage(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleCanvasDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (isTauriRuntime()) {
      event.preventDefault();
      return;
    }
    if (!dataTransferHasImage(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingImages(false);
  };

  const handleCanvasDrop = (event: DragEvent<HTMLDivElement>) => {
    if (isTauriRuntime()) {
      event.preventDefault();
      return;
    }
    if (!dataTransferHasImage(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingImages(false);
    const result = imageFilesFromDataTransfer(event.dataTransfer, "drop");
    addRefFiles(result.files, "drop", result.ignored);
  };

  const removeRef = (id: string) => {
    setRefs((prev) => {
      const removed = prev.find((ref) => ref.id === id);
      if (removed) URL.revokeObjectURL(removed.url);
      const next = prev.filter((ref) => ref.id !== id);
      if (id === selectedRef) setSelectedRef(next[0]?.id ?? null);
      if (id === targetRefId) setTargetRefId(next[0]?.id ?? null);
      setMaskSnapshots((snapshots) => {
        const { [id]: _removed, ...rest } = snapshots;
        return rest;
      });
      return next;
    });
  };

  useEffect(() => {
    refsRef.current = refs;
  }, [refs, refsRef]);

  useEffect(() => {
    return () => {
      refsRef.current.forEach((ref) => URL.revokeObjectURL(ref.url));
    };
  }, [refsRef]);

  return {
    addRef,
    handleCanvasDragEnter,
    handleCanvasDragOver,
    handleCanvasDragLeave,
    handleCanvasDrop,
    removeRef,
  };
}
