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
  /**
   * When true, the wrapper does not render a Trigger element of its own and
   * relies on a parent element marked with `data-image-action-trigger` to
   * absorb the right-click. Useful when wrapping bare `<img>` tags that
   * already have a positioned overlay parent.
   */
  inlineTrigger?: boolean;
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
export function ImageContextMenu({ asset, children, inlineTrigger }: Props) {
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
      <ContextMenuTrigger asChild={!inlineTrigger} {...triggerProps}>
        {children}
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
                onSelect={(event) => {
                  // Prevent Radix's automatic menu close from racing the
                  // async executor in some clipboard-related flows.
                  event.preventDefault();
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
