import { useEffect } from "react";

type Handler = (e: KeyboardEvent) => void;

export function useShortcut(key: string, handler: Handler, deps: unknown[] = []) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const combo = (e.metaKey || e.ctrlKey ? "mod+" : "") + e.key.toLowerCase();
      if (combo === key) {
        handler(e);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ...deps]);
}

export function useGlobalShortcuts(callbacks: {
  onCommand?: () => void;
  onScreen?: (screen: string) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k" && !e.shiftKey) {
        e.preventDefault();
        callbacks.onCommand?.();
        return;
      }
      if (mod && !e.shiftKey && ["1", "2", "3", "4", "5"].includes(e.key)) {
        e.preventDefault();
        const map: Record<string, string> = {
          "1": "generate",
          "2": "edit",
          "3": "history",
          "4": "providers",
          "5": "settings",
        };
        callbacks.onScreen?.(map[e.key]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [callbacks]);
}
