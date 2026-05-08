import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

type SelectionMenuState = {
  x: number;
  y: number;
  hasEditableTarget: boolean;
  hasSelection: boolean;
};

type Listener = (state: SelectionMenuState) => void;
let activeListener: Listener | null = null;

/**
 * Imperative entry point used by `useDisableWebviewContextMenu`. The hook
 * decides when (input/textarea/contenteditable target, or any element with a
 * non-empty selection), this component renders the actual menu.
 */
export function openTextSelectionMenu(state: SelectionMenuState) {
  activeListener?.(state);
}

/**
 * Tiny self-rendered "Cut / Copy / Paste / Select All" menu. Shown when the
 * user right-clicks on editable surfaces or text selections — replacing the
 * webview's native menu after `useDisableWebviewContextMenu` suppresses it.
 *
 * Mounted once at app root.
 */
export function TextSelectionContextMenu() {
  const [state, setState] = useState<SelectionMenuState | null>(null);

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

  if (!state) return null;

  const close = () => setState(null);

  return createPortal(
    <div
      role="menu"
      onMouseDown={(event) => event.stopPropagation()}
      className="fixed z-[1000] min-w-[180px] overflow-hidden rounded-xl border p-1 outline-none"
      style={{
        top: state.y,
        left: state.x,
        background: "var(--surface-floating)",
        borderColor: "var(--surface-floating-border)",
        backdropFilter: "blur(28px) saturate(150%)",
        WebkitBackdropFilter: "blur(28px) saturate(150%)",
        boxShadow: "var(--shadow-floating)",
      }}
    >
      {state.hasEditableTarget ? (
        <MenuButton
          label="剪切"
          shortcut="⌘X"
          disabled={!state.hasSelection}
          onSelect={() => {
            document.execCommand("cut");
            close();
          }}
        />
      ) : null}
      <MenuButton
        label="复制"
        shortcut="⌘C"
        disabled={!state.hasSelection}
        onSelect={() => {
          document.execCommand("copy");
          close();
        }}
      />
      {state.hasEditableTarget ? (
        <MenuButton
          label="粘贴"
          shortcut="⌘V"
          onSelect={async () => {
            try {
              const text = await navigator.clipboard.readText();
              document.execCommand("insertText", false, text);
            } catch {
              document.execCommand("paste");
            }
            close();
          }}
        />
      ) : null}
      <div
        className="my-1 h-px"
        style={{ background: "var(--border-faint)" }}
      />
      <MenuButton
        label="全选"
        shortcut="⌘A"
        onSelect={() => {
          document.execCommand("selectAll");
          close();
        }}
      />
    </div>,
    document.body,
  );
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
