import { useEffect } from "react";
import { toast } from "sonner";
import {
  imageFilesFromDataTransfer,
  type ImageFileSource,
} from "@/lib/image-input";

type AddImages = (
  imageFiles: File[],
  source: ImageFileSource,
  ignored?: number,
) => void;

type TauriDroppedImage = {
  name: string;
  mime?: string;
  bytes: number[];
};

type TauriDroppedImages = {
  files: TauriDroppedImage[];
  ignored: number;
};

function isTauriRuntime() {
  if (typeof window === "undefined") return false;
  return Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__);
}

function tauriDroppedFileToFile(file: TauriDroppedImage) {
  return new File([new Uint8Array(file.bytes)], file.name, {
    type: file.mime || "application/octet-stream",
  });
}

async function readTauriDroppedImages(paths: string[]) {
  const { invoke } = await import("@tauri-apps/api/core");
  const payload = await invoke<TauriDroppedImages>("read_dropped_image_files", {
    paths,
  });
  return {
    files: payload.files.map(tauriDroppedFileToFile),
    ignored: payload.ignored,
  };
}

export function useGlobalImagePaste(onImages: AddImages) {
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const result = imageFilesFromDataTransfer(event.clipboardData, "paste");
      if (result.files.length === 0 && result.ignored === 0) return;
      event.preventDefault();
      event.stopPropagation();
      onImages(result.files, "paste", result.ignored);
    };

    window.addEventListener("paste", handlePaste, true);
    return () => window.removeEventListener("paste", handlePaste, true);
  }, [onImages]);
}

export function useTauriImageDrop(
  onImages: AddImages,
  onDragActiveChange?: (active: boolean) => void,
) {
  useEffect(() => {
    if (!isTauriRuntime()) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    void import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent((event) => {
          const payload = event.payload;
          if (payload.type === "enter" || payload.type === "over") {
            onDragActiveChange?.(true);
            return;
          }
          if (payload.type === "leave") {
            onDragActiveChange?.(false);
            return;
          }
          if (payload.type !== "drop") return;

          onDragActiveChange?.(false);
          void readTauriDroppedImages(payload.paths)
            .then((result) => {
              if (disposed) return;
              onImages(result.files, "drop", result.ignored);
            })
            .catch((error) => {
              if (disposed) return;
              toast.error("无法读取拖入的图片", {
                description:
                  error instanceof Error ? error.message : String(error),
              });
            });
        }),
      )
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch((error) => {
        if (disposed) return;
        toast.error("无法启用 Tauri 拖拽上传", {
          description: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      disposed = true;
      onDragActiveChange?.(false);
      unlisten?.();
    };
  }, [onDragActiveChange, onImages]);
}
