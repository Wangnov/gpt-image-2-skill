import { useEffect } from "react";
import { toast } from "sonner";
import { openQuickLook } from "@/components/ui/quick-look";
import { api } from "@/lib/api";
import { useFocusedImage } from "@/lib/image-actions/focused-image";
import { findAction } from "@/lib/image-actions/registry";
import type {
  ImageActionContext,
  ImageActionId,
} from "@/lib/image-actions/types";
import {
  hasNonEmptySelection,
  isEditableTarget,
} from "./use-disable-webview-contextmenu";

/**
 * Global keyboard shortcuts for the focused image. Mounted once at app root.
 *
 * Bindings:
 *   - Space        → open Quick Look on the focused asset
 *   - ⌘C / Ctrl+C  → copy-image (skipped when text is selected so the
 *                    native text-copy gesture wins)
 *   - ⇧⌘C          → copy-prompt
 *   - ⌘⌫ / Delete  → soft delete with undo
 *
 * The handler short-circuits when:
 *   - the active key event target is editable (input/textarea/contenteditable)
 *     so Space inside the prompt textarea inserts a space, not Quick Look
 *   - there is no focused image asset
 */
export function useImageShortcuts() {
  const focused = useFocusedImage();

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      // If a closer-scoped handler already claimed this keypress (e.g.
      // OutputTile binds Space/Enter to onSelect and calls preventDefault),
      // don't double-activate from the bubbled event up here.
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target && isEditableTarget(target)) return;
      if (!focused) return;

      const ctx: ImageActionContext = {
        asset: focused,
        runtime: api.kind,
        // Use the command-palette surface so actions which are gated to
        // the right-click menu (Copy Path, Edit with Prompt, etc.) still
        // resolve through `findAction` if a future binding wants them.
        surface: "command-palette",
      };

      if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        openQuickLook({ asset: focused });
        return;
      }

      const meta = event.metaKey || event.ctrlKey;
      const isC = event.key === "c" || event.key === "C";
      if (meta && isC) {
        // Don't fight a real text-selection copy.
        if (hasNonEmptySelection()) return;
        event.preventDefault();
        const id: ImageActionId = event.shiftKey
          ? "copy-prompt"
          : "copy-image";
        runActionById(id, ctx);
        return;
      }

      if (
        meta &&
        (event.key === "Backspace" || event.key === "Delete")
      ) {
        event.preventDefault();
        runActionById("delete", ctx);
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [focused]);
}

function runActionById(id: ImageActionId, ctx: ImageActionContext) {
  const action = findAction(id);
  if (!action) return;
  if (!action.isAvailable(ctx)) return;
  if (action.isEnabled && !action.isEnabled(ctx)) return;
  // Mirror the error handling in `useImageActions().run` — keyboard-driven
  // executors otherwise emit unhandled promise rejections (clipboard
  // permission denied, fetch failures, etc.) and the user gets no feedback
  // about why nothing happened.
  void Promise.resolve(action.execute(ctx)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    toast.error("操作失败", { description: message });
  });
}
