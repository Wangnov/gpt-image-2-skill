import {
  C2_TRANSFER_EXPORT_MANAGE_ACTIONS,
  C3_PREVIEW_ACTIONS,
  C4_GENERATE_ACTIONS,
} from "./executors";
import type {
  ImageAction,
  ImageActionContext,
  ImageActionGroup,
  ImageActionId,
} from "./types";

/**
 * Single source of truth for every image action surfaced in the app.
 *
 * Populated incrementally:
 *   - C2 adds transfer/export/manage actions (Copy / Save / Reveal / Delete).
 *   - C4 adds generate actions (Use as Reference / Edit with Prompt / Reveal Job).
 *   - C5 adds Drag-out / Copy with Prompt / Share.
 *
 * The ContextMenu, HoverToolbar, and CommandPalette all read this list via
 * `actionsFor(ctx)` and never define their own action shapes.
 */
export const IMAGE_ACTIONS: ImageAction[] = [
  ...C3_PREVIEW_ACTIONS,
  ...C2_TRANSFER_EXPORT_MANAGE_ACTIONS,
  ...C4_GENERATE_ACTIONS,
];

const GROUP_ORDER: ImageActionGroup[] = [
  "transfer",
  "export",
  "generate",
  "manage",
  "destructive",
];

export function actionsFor(ctx: ImageActionContext): ImageAction[] {
  return IMAGE_ACTIONS.filter((action) => action.isAvailable(ctx));
}

export type GroupedActions = Array<{
  group: ImageActionGroup;
  actions: ImageAction[];
}>;

export function groupedActions(ctx: ImageActionContext): GroupedActions {
  const buckets = new Map<ImageActionGroup, ImageAction[]>();
  for (const action of actionsFor(ctx)) {
    const list = buckets.get(action.group) ?? [];
    list.push(action);
    buckets.set(action.group, list);
  }
  const out: GroupedActions = [];
  for (const group of GROUP_ORDER) {
    const actions = buckets.get(group);
    if (actions && actions.length > 0) out.push({ group, actions });
  }
  return out;
}

export function findAction(id: ImageActionId): ImageAction | undefined {
  return IMAGE_ACTIONS.find((action) => action.id === id);
}
