import type { ConfirmOptions } from "@/hooks/use-confirm";

/**
 * Module-level holder so executors (running outside React) can prompt the
 * user via the project's `<ConfirmProvider>` dialog. App.tsx registers the
 * provider's confirm fn at boot.
 */
let confirmFn: ((opts: ConfirmOptions) => Promise<boolean>) | null = null;

export function setActionsConfirm(
  fn: ((opts: ConfirmOptions) => Promise<boolean>) | null,
) {
  confirmFn = fn;
}

export async function actionsConfirm(opts: ConfirmOptions): Promise<boolean> {
  if (!confirmFn) {
    // Provider not registered — fail closed so destructive flows don't run
    // silently. Should never happen at runtime since App.tsx wires this up
    // synchronously after mount.
    // eslint-disable-next-line no-console
    console.warn("[image-actions] confirm requested without provider");
    return false;
  }
  return confirmFn(opts);
}
