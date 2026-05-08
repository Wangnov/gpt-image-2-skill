import { useEffect } from "react";
import { openQuickLook } from "@/components/ui/quick-look";
import { useFocusedImage } from "@/lib/image-actions/focused-image";
import { isEditableTarget } from "./use-disable-webview-contextmenu";

/**
 * Global keyboard shortcuts for the focused image. Mounted once at app root.
 *
 * The handler short-circuits when:
 *   - the active key event target is editable (input/textarea/contenteditable)
 *     so a Space inside the prompt textarea inserts a space, not Quick Look
 *   - there is no focused image asset
 *
 * Currently bound:
 *   - Space → open Quick Look on the focused asset
 *
 * Successor commits add: ⌘⌫ → soft delete with undo (C5), ⌘C → copy image
 * (C5/C6), j/k → cycle through peer outputs (C6).
 */
export function useImageShortcuts() {
  const focused = useFocusedImage();

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && isEditableTarget(target)) return;
      if (!focused) return;
      if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        openQuickLook({ asset: focused });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [focused]);
}
