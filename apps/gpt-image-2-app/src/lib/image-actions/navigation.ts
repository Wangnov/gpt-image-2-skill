import type { ScreenId } from "@/components/shell/screens";

/**
 * Module-level holder so executors (running outside React) can switch the
 * top-level screen without threading `setScreen` through every call site.
 * `App.tsx` registers the setter at boot.
 */
let setScreenFn: ((screen: ScreenId) => void) | null = null;

export function setActionsNavigator(setScreen: (screen: ScreenId) => void) {
  setScreenFn = setScreen;
}

export function navigateToScreen(screen: ScreenId) {
  setScreenFn?.(screen);
}
