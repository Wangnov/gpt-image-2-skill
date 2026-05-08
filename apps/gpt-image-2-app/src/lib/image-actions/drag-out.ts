import type { DragEvent } from "react";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { api } from "@/lib/api";
import type { ImageAsset } from "./types";

/**
 * Native drag-out support backed by `@crabnebula/tauri-plugin-drag`. The
 * plugin replaces the webview's default drag payload with a platform-native
 * file drag that drops into Finder, iMessage, Photoshop, etc. as a real PNG.
 *
 * Tauri only — there's no Web equivalent that can pass binary file data,
 * since browsers won't elevate a `text/uri-list` to a real file. The helper
 * hook returns no-op props on non-Tauri runtimes.
 */
export function imageDragProps(
  asset: ImageAsset,
): {
  draggable: boolean;
  onDragStart?: (event: DragEvent<HTMLElement>) => void;
} {
  if (api.kind !== "tauri" || !asset.path) {
    return { draggable: false };
  }
  const path = asset.path;
  return {
    draggable: true,
    onDragStart: (event) => {
      // Cancel the webview's own drag (which would carry just an asset:// URL)
      // so the platform's native drag service starts clean. The plugin then
      // injects file-flavored pasteboard items.
      event.preventDefault();
      event.stopPropagation();
      void startDrag({ item: [path], icon: path });
    },
  };
}
