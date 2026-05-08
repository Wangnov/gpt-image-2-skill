import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { actionsFor, findAction, groupedActions } from "./registry";
import type {
  ImageAction,
  ImageActionContext,
  ImageActionId,
  ImageActionSurface,
  ImageAsset,
} from "./types";

export type UseImageActionsOptions = {
  asset: ImageAsset;
  surface: ImageActionSurface;
};

/**
 * Shared hook consumed by ContextMenu, HoverToolbar, and CommandPalette.
 *
 * Returns the available + grouped action lists for the given asset/surface
 * combo, plus a `run(id)` callback that resolves availability + enabled
 * state, executes the action, surfaces failures via a sonner toast, and
 * reports whether the executor completed successfully.
 */
export function useImageActions({ asset, surface }: UseImageActionsOptions) {
  const ctx: ImageActionContext = useMemo(
    () => ({ asset, runtime: api.kind, surface }),
    [asset, surface],
  );

  const available = useMemo(() => actionsFor(ctx), [ctx]);
  const groups = useMemo(() => groupedActions(ctx), [ctx]);

  const run = useCallback(
    async (id: ImageActionId) => {
      const action = findAction(id);
      if (!action) {
        // eslint-disable-next-line no-console
        console.warn(`[image-actions] unknown action id: ${id}`);
        return false;
      }
      if (!action.isAvailable(ctx)) return false;
      if (action.isEnabled && !action.isEnabled(ctx)) return false;
      try {
        await action.execute(ctx);
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toast.error("操作失败", { description: message });
        return false;
      }
    },
    [ctx],
  );

  return { ctx, available, groups, run };
}

export type UseImageActions = ReturnType<typeof useImageActions>;

export type { ImageAction, ImageActionContext, ImageActionId };
