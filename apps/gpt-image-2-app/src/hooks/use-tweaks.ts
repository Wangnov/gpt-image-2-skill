import { createContext, createElement, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Tweaks } from "@/lib/types";

const DEFAULT_TWEAKS: Tweaks = {
  theme: "light",
  accent: "green",
  font: "system",
  density: "comfortable",
  timeline: "card",
};

const STORAGE_KEY = "gpt2.tweaks";

type Ctx = {
  tweaks: Tweaks;
  setTweaks: (partial: Partial<Tweaks>) => void;
};

const TweaksContext = createContext<Ctx | undefined>(undefined);

function load(): Tweaks {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_TWEAKS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_TWEAKS, ...parsed };
  } catch {
    return DEFAULT_TWEAKS;
  }
}

export function TweaksProvider({ children }: { children: ReactNode }) {
  const [tweaks, setTweaksState] = useState<Tweaks>(load);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", tweaks.theme);
    root.setAttribute("data-accent", tweaks.accent);
    root.setAttribute("data-font", tweaks.font);
    root.setAttribute("data-density", tweaks.density);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tweaks)); } catch { /* ignore */ }
  }, [tweaks]);

  const setTweaks = useCallback((partial: Partial<Tweaks>) => {
    setTweaksState((prev) => ({ ...prev, ...partial }));
  }, []);

  return createElement(TweaksContext.Provider, { value: { tweaks, setTweaks } }, children);
}

export function useTweaks() {
  const ctx = useContext(TweaksContext);
  if (!ctx) throw new Error("useTweaks must be used within TweaksProvider");
  return ctx;
}
