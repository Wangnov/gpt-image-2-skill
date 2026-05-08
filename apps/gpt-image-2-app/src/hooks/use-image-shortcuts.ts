import { useEffect } from "react";
import { useFocusedImage } from "@/lib/image-actions/focused-image";
import { isEditableTarget } from "./use-disable-webview-contextmenu";

/**
 * Global keyboard shortcuts for the focused image. Mounted once at app root.
 *
 * The handler short-circuits when:
 *   - the active key event target is editable (input/textarea/contenteditable)
 *   - there is no focused image asset
 *
 * Real key handling lands in successor commits:
 *   - C2: ⌘⌫ / Delete → soft delete with undo toast
 *   - C2/C5: ⌘C → copy image
 *   - C3: Space → open Quick Look
 *
 * Reserved here so successor commits register handlers in one obvious place
 * instead of scattering keydown listeners across components.
 */
export function useImageShortcuts() {
  const focused = useFocusedImage();

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && isEditableTarget(target)) return;
      if (!focused) return;
      // Successor commits attach action-id dispatch here.
      void event;
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [focused]);
}
