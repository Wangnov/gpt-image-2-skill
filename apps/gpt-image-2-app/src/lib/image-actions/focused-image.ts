import { useSyncExternalStore } from "react";
import type { ImageAsset } from "./types";

let focused: ImageAsset | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function sameIdentity(a: ImageAsset | null, b: ImageAsset | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.jobId === b.jobId && a.outputIndex === b.outputIndex;
}

/**
 * Set the currently-focused image asset. Used by hover/focus handlers on
 * thumbnails and main preview tiles. Pass `null` on blur.
 *
 * Identity-stable updates (same jobId + outputIndex) refresh the stored
 * reference without notifying subscribers — this avoids re-render churn
 * when a parent component recreates the asset object on every render.
 */
export function setFocusedImage(next: ImageAsset | null) {
  if (sameIdentity(focused, next)) {
    focused = next;
    return;
  }
  focused = next;
  emit();
}

export function clearFocusedImageIfMatches(jobId: string, outputIndex?: number) {
  if (!focused) return;
  if (focused.jobId !== jobId) return;
  if (outputIndex != null && focused.outputIndex !== outputIndex) return;
  focused = null;
  emit();
}

export function getFocusedImage(): ImageAsset | null {
  return focused;
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

export function useFocusedImage(): ImageAsset | null {
  return useSyncExternalStore(subscribe, getFocusedImage, () => null);
}
