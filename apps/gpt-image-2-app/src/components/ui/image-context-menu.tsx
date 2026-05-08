import { useMemo, type ReactNode } from "react";
import { Icon } from "@/components/icon";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useImageActions } from "@/lib/image-actions/use-image-actions";
import type { ImageAsset } from "@/lib/image-actions/types";
import { IMAGE_ACTION_TRIGGER_ATTR } from "@/hooks/use-disable-webview-contextmenu";

type Props = {
  asset: ImageAsset;
  children: ReactNode;
};

/**
 * Right-click any image surface to expose the runtime-aware action set:
 * Copy / Save / Reveal / Open with / Delete (plus Use as Reference / Edit /
 * Reveal Job in C4 and Drag-out / Share / Copy with Prompt in C5).
 *
 * The Radix Trigger calls `preventDefault` on contextmenu, which causes the
 * global `useDisableWebviewContextMenu` handler to skip its own work — so
 * neither the webview's native menu nor the text-selection menu shows up
 * when the user right-clicks an image.
 */
export function ImageContextMenu({ asset, children }: Props) {
  const { ctx, groups, run } = useImageActions({
    asset,
    surface: "context-menu",
  });

  // Render nothing fancy if the registry yields zero actions for this asset
  // (defensive — should never happen with the C2 registry but keeps the tree
  // valid if a future capability matrix excludes everything).
  const hasAnyAction = useMemo(
    () => groups.some((bucket) => bucket.actions.length > 0),
    [groups],
  );

  if (!hasAnyAction) {
    return <>{children}</>;
  }

  const triggerProps = { [IMAGE_ACTION_TRIGGER_ATTR]: true } as Record<
    string,
    boolean
  >;

  return (
    <ContextMenu>
      {/*
        Wrap children in a `display: contents` div instead of using
        asChild-into-the-actual-child. Radix's `asChild` Slot merges its
        own onContextMenu/onMouseDown/onPointerDown handlers into the
        immediate child — when that child is a `<button onClick>` (e.g.
        the detail drawer's "click big image to zoom" button), the merged
        pointer-down handlers can swallow the primary-click activation.
        Wrapping in a `display: contents` <div> keeps the right-click
        bubbling working and leaves the inner button's click flow alone.
      */}
      <ContextMenuTrigger asChild {...triggerProps}>
        <div style={{ display: "contents" }}>{children}</div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {groups.map((bucket, index) => (
          <div key={bucket.group}>
            {index > 0 ? <ContextMenuSeparator /> : null}
            {bucket.actions.map((action) => (
              <ContextMenuItem
                key={action.id}
                destructive={action.destructive}
                disabled={
                  action.isEnabled ? !action.isEnabled(ctx) : false
                }
                onSelect={() => {
                  // Let Radix close the menu on its own; the executor runs
                  // async in the background.
                  void run(action.id);
                }}
              >
                <span className="flex items-center gap-2">
                  <Icon name={action.icon} size={14} />
                  <span>{action.label(ctx)}</span>
                </span>
                {action.shortcut ? (
                  <ContextMenuShortcut>{action.shortcut}</ContextMenuShortcut>
                ) : null}
              </ContextMenuItem>
            ))}
          </div>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}
