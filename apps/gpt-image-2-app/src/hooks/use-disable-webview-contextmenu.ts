import { useEffect } from "react";
import {
  openTextSelectionMenu,
  type SelectionCapture,
} from "@/components/ui/text-selection-context-menu";

const TRIGGER_OPT_OUT_ATTR = "data-image-action-trigger";

/**
 * Replace the webview's default contextmenu with our app-controlled surfaces.
 *
 * - Image triggers (Radix ContextMenu Trigger over an image) handle the event
 *   themselves; their handler calls preventDefault, so we exit early when the
 *   bubbled event has `defaultPrevented`. We also honor an explicit opt-out
 *   marker (`data-image-action-trigger`) for any non-Radix surfaces that want
 *   to keep their own contextmenu logic.
 * - Editable inputs / textareas / contenteditable surfaces and any other
 *   target with a non-collapsed text selection get a small
 *   "Cut / Copy / Paste / Select All" menu rendered by
 *   <TextSelectionContextMenu />.
 * - Everything else simply has the default menu suppressed.
 *
 * In dev builds, holding Option (⌥) when right-clicking lets the underlying
 * webview's native menu show — that's how you reach the devtools "Inspect"
 * shortcut without unmounting the hook.
 */
export function useDisableWebviewContextMenu() {
  useEffect(() => {
    // WebKit will auto-select the word under the cursor when you right-click
    // an input/textarea. By the time the `contextmenu` event fires, the
    // input's `selectionStart`/`selectionEnd` already point at that word
    // — which is wrong for paste (we want to insert at the user-set caret,
    // not replace a word). Stash the selection on capture-phase mousedown
    // *before* the user agent gets to mutate it.
    let stashed: SelectionCapture | null = null;

    const onMouseDownCapture = (event: MouseEvent) => {
      if (event.button !== 2) {
        stashed = null;
        return;
      }
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest(`[${TRIGGER_OPT_OUT_ATTR}]`)) {
        stashed = null;
        return;
      }
      stashed = captureSelection(target);
    };

    const onContextMenu = (event: MouseEvent) => {
      // Dev escape hatch: ⌥ + right-click = native inspect menu.
      if (import.meta.env.DEV && event.altKey) {
        stashed = null;
        return;
      }

      const target = event.target as HTMLElement | null;
      if (!target) {
        stashed = null;
        return;
      }

      // Surfaces that opt out (Radix ContextMenu Trigger over an image,
      // or anything else marked with `data-image-action-trigger`) handle
      // the event themselves.
      if (target.closest(`[${TRIGGER_OPT_OUT_ATTR}]`)) {
        stashed = null;
        return;
      }
      if (event.defaultPrevented) {
        stashed = null;
        return;
      }

      event.preventDefault();

      const capture = stashed ?? captureSelection(target);
      stashed = null;
      if (capture) {
        openTextSelectionMenu({
          x: event.clientX,
          y: event.clientY,
          capture,
        });
      }
    };

    window.addEventListener("mousedown", onMouseDownCapture, true);
    window.addEventListener("contextmenu", onContextMenu);
    return () => {
      window.removeEventListener("mousedown", onMouseDownCapture, true);
      window.removeEventListener("contextmenu", onContextMenu);
    };
  }, []);
}

export const IMAGE_ACTION_TRIGGER_ATTR = TRIGGER_OPT_OUT_ATTR;

export function isEditableTarget(el: HTMLElement): boolean {
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return true;
  if (el.isContentEditable) return true;
  // Walk up a few levels in case the click landed on an inline span inside a
  // contenteditable surface.
  let parent = el.parentElement;
  for (let i = 0; i < 4 && parent; i += 1) {
    if (parent.isContentEditable) return true;
    parent = parent.parentElement;
  }
  return false;
}

export function hasNonEmptySelection(): boolean {
  const selection = window.getSelection();
  if (!selection) return false;
  if (selection.isCollapsed) return false;
  return selection.toString().length > 0;
}

/**
 * Capture the right snapshot for the text-selection menu so its handlers
 * don't depend on focus or selection still being live by the time the user
 * clicks an item. Returns null when the click target has nothing actionable
 * (no selection AND not an editable surface).
 */
function captureSelection(target: HTMLElement): SelectionCapture | null {
  const inputLike = nearestEditableInput(target);
  if (inputLike) {
    const start = inputLike.selectionStart ?? 0;
    const end = inputLike.selectionEnd ?? 0;
    return {
      kind: "input",
      element: inputLike,
      selectionStart: start,
      selectionEnd: end,
      selectedText: inputLike.value.slice(start, end),
    };
  }
  const text = window.getSelection()?.toString() ?? "";
  if (text.length > 0) {
    return { kind: "document", selectedText: text };
  }
  return null;
}

function nearestEditableInput(
  el: HTMLElement,
): HTMLInputElement | HTMLTextAreaElement | null {
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") {
    return el as HTMLInputElement | HTMLTextAreaElement;
  }
  return null;
}
