import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { cn } from "@/lib/cn";

const VIEWPORT_PADDING = 8;

export type SelectionCapture =
  | {
      kind: "input";
      element: HTMLInputElement | HTMLTextAreaElement;
      selectionStart: number;
      selectionEnd: number;
      selectedText: string;
    }
  | { kind: "document"; selectedText: string };

type SelectionMenuState = {
  x: number;
  y: number;
  capture: SelectionCapture;
};

type Listener = (state: SelectionMenuState) => void;
let activeListener: Listener | null = null;

/**
 * Imperative entry point used by `useDisableWebviewContextMenu`. Captures
 * the live selection (input/textarea offset pair, or window.getSelection
 * text) so menu actions don't fight with selection-loss when the menu
 * itself takes focus.
 */
export function openTextSelectionMenu(state: SelectionMenuState) {
  activeListener?.(state);
}

/**
 * Replaces the webview's native Cut/Copy/Paste/Select All menu on editable
 * surfaces and over plain text selections. Implemented entirely on top of
 * `navigator.clipboard` and the captured selection — `document.execCommand`
 * is unreliable in modern WebKit when the menu portal pulls focus away
 * from the source element.
 */
export function TextSelectionContextMenu() {
  const [state, setState] = useState<SelectionMenuState | null>(null);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    ready: boolean;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    activeListener = setState;
    return () => {
      if (activeListener === setState) activeListener = null;
    };
  }, []);

  useEffect(() => {
    if (!state) return;
    const close = () => setState(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [state]);

  // Reset to the click position synchronously when a new state arrives so
  // the first frame paints near the cursor (off-screen clamping happens in
  // the next pass once we've measured the menu).
  useLayoutEffect(() => {
    if (!state) {
      setPosition(null);
      return;
    }
    setPosition({ top: state.y, left: state.x, ready: false });
  }, [state]);

  // After the menu paints, measure its real size and clamp into the
  // viewport. Avoids the right-click-near-the-edge "menu is half off-screen"
  // problem the user hit.
  useLayoutEffect(() => {
    if (!state || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    let left = state.x;
    let top = state.y;
    if (left + rect.width + VIEWPORT_PADDING > window.innerWidth) {
      left = window.innerWidth - rect.width - VIEWPORT_PADDING;
    }
    if (top + rect.height + VIEWPORT_PADDING > window.innerHeight) {
      top = window.innerHeight - rect.height - VIEWPORT_PADDING;
    }
    if (left < VIEWPORT_PADDING) left = VIEWPORT_PADDING;
    if (top < VIEWPORT_PADDING) top = VIEWPORT_PADDING;
    setPosition({ top, left, ready: true });
  }, [state]);

  if (!state || !position) return null;

  const close = () => setState(null);
  const { capture } = state;
  const hasSelection = capture.selectedText.length > 0;
  const isEditable = capture.kind === "input";

  const onCopy = async () => {
    if (!hasSelection) return close();
    try {
      await navigator.clipboard.writeText(capture.selectedText);
    } catch (error) {
      toast.error("复制失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
    close();
  };

  const onCut = async () => {
    if (capture.kind !== "input" || !hasSelection) return close();
    const { element, selectionStart, selectionEnd, selectedText } = capture;
    try {
      await navigator.clipboard.writeText(selectedText);
    } catch (error) {
      toast.error("剪切失败", {
        description: error instanceof Error ? error.message : String(error),
      });
      return close();
    }
    replaceInputRange(element, selectionStart, selectionEnd, "");
    close();
  };

  const onPaste = async () => {
    if (capture.kind !== "input") return close();
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      // User denied clipboard access (or macOS prompt was dismissed).
      // No toast — Apple's own prompt is enough signal.
      return close();
    }
    const { element, selectionStart, selectionEnd } = capture;
    replaceInputRange(element, selectionStart, selectionEnd, text);
    close();
  };

  const onSelectAll = () => {
    if (capture.kind === "input") {
      capture.element.focus();
      capture.element.select();
    } else {
      // contenteditable / generic: re-select via Range API
      const range = document.createRange();
      const target = document.activeElement ?? document.body;
      try {
        range.selectNodeContents(target);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      } catch {
        /* ignore — node not selectable */
      }
    }
    close();
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      onMouseDown={(event) => event.stopPropagation()}
      className="fixed z-[1000] min-w-[180px] overflow-hidden rounded-xl border p-1 outline-none"
      style={{
        top: position.top,
        left: position.left,
        // Hide the first paint at the user's cursor position so they don't
        // see the menu pop, then jump to the clamped location. Once
        // useLayoutEffect commits the measured position, opacity flips on.
        opacity: position.ready ? 1 : 0,
        background: "var(--surface-floating)",
        borderColor: "var(--surface-floating-border)",
        backdropFilter: "blur(28px) saturate(150%)",
        WebkitBackdropFilter: "blur(28px) saturate(150%)",
        boxShadow: "var(--shadow-floating)",
      }}
    >
      {isEditable ? (
        <MenuButton
          label="剪切"
          shortcut="⌘X"
          disabled={!hasSelection}
          onSelect={onCut}
        />
      ) : null}
      <MenuButton
        label="复制"
        shortcut="⌘C"
        disabled={!hasSelection}
        onSelect={onCopy}
      />
      {isEditable ? (
        <MenuButton label="粘贴" shortcut="⌘V" onSelect={onPaste} />
      ) : null}
      <div
        className="my-1 h-px"
        style={{ background: "var(--border-faint)" }}
      />
      <MenuButton label="全选" shortcut="⌘A" onSelect={onSelectAll} />
    </div>,
    document.body,
  );
}

/**
 * Insert / replace text inside an input or textarea.
 *
 * Uses `document.execCommand("insertText")` so the mutation participates in
 * the webview's native undo stack — ⌘Z after our menu's paste/cut should
 * undo the menu's change, just like a native paste/cut would. The
 * prototype-setter fallback (synthetic) only runs if execCommand fails,
 * which on modern WebKit is essentially never for plain inputs.
 */
function replaceInputRange(
  element: HTMLInputElement | HTMLTextAreaElement,
  start: number,
  end: number,
  insert: string,
) {
  element.focus();
  try {
    element.setSelectionRange(start, end);
  } catch {
    /* some input types (number, color) don't support setSelectionRange */
  }
  let nativeOk = false;
  try {
    nativeOk = document.execCommand("insertText", false, insert);
  } catch {
    nativeOk = false;
  }
  if (nativeOk) return;

  // Fallback for environments where execCommand is gone — synthetic value
  // mutation. This bypasses the undo stack but at least leaves the input
  // and React state consistent.
  const next = element.value.slice(0, start) + insert + element.value.slice(end);
  const proto = Object.getPrototypeOf(element);
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) {
    setter.call(element, next);
  } else {
    element.value = next;
  }
  element.dispatchEvent(new Event("input", { bubbles: true }));
  const caret = start + insert.length;
  try {
    element.setSelectionRange(caret, caret);
  } catch {
    /* */
  }
}

type MenuButtonProps = {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onSelect: () => void;
};

function MenuButton({ label, shortcut, disabled, onSelect }: MenuButtonProps) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-[13px] outline-none",
        "text-[color:var(--text)]",
        "hover:bg-[color:var(--bg-hover)]",
        "disabled:pointer-events-none disabled:opacity-40",
      )}
    >
      <span>{label}</span>
      {shortcut ? (
        <span className="text-[11px] tabular-nums text-[color:var(--text-faint)]">
          {shortcut}
        </span>
      ) : null}
    </button>
  );
}
