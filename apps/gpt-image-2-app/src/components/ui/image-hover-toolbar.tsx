import type { CSSProperties, MouseEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Icon } from "@/components/icon";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import type {
  ImageAction,
  ImageActionId,
  ImageAsset,
} from "@/lib/image-actions/types";
import { useImageActions } from "@/lib/image-actions/use-image-actions";

export type ImageHoverToolbarProps = {
  asset: ImageAsset;
  visible?: boolean;
  className?: string;
  style?: CSSProperties;
  /**
   * Bypass the registry's slot order and render only the listed action ids.
   * Useful for surfaces (legacy classic-shell tiles, the edit drawer thumb
   * strip) that want a tighter subset.
   */
  slots?: ImageActionId[];
};

const DEFAULT_SLOTS: ImageActionId[] = [
  "quick-look",
  "use-as-reference",
  "copy-image",
  "save-as",
];

/**
 * Five-slot hover toolbar overlay rendered on top of an image surface. The
 * first four slots are filled by the registered actions whose ids match the
 * configured slot list (in order, skipping any that are unavailable for the
 * current runtime / asset). The fifth slot is a `…` button that synthesizes
 * a contextmenu event to open the same `ImageContextMenu` Trigger that the
 * tile is wrapped in, so users always have a path to the full action set.
 */
export function ImageHoverToolbar({
  asset,
  visible = true,
  className,
  style,
  slots = DEFAULT_SLOTS,
}: ImageHoverToolbarProps) {
  const reducedMotion = useReducedMotion();
  const { ctx, available, run } = useImageActions({
    asset,
    surface: "hover-toolbar",
  });

  const slotActions = slots
    .map((id) => available.find((action) => action.id === id))
    .filter((action): action is ImageAction => Boolean(action));

  if (slotActions.length === 0 && !visible) return null;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className={
            "absolute top-2 right-2 z-20 flex gap-1" +
            (className ? ` ${className}` : "")
          }
          style={style}
          initial={reducedMotion ? false : { opacity: 0, y: -3, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={
            reducedMotion ? { opacity: 0 } : { opacity: 0, y: -2, scale: 0.98 }
          }
          transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
        >
          {slotActions.map((action) => (
            <button
              key={action.id}
              type="button"
              title={action.label(ctx)}
              aria-label={action.label(ctx)}
              disabled={
                action.isEnabled ? !action.isEnabled(ctx) : false
              }
              onClick={(event) => {
                event.stopPropagation();
                event.preventDefault();
                void run(action.id);
              }}
              className="touch-target image-overlay flex h-8 w-8 items-center justify-center rounded-[4px] border-none disabled:opacity-40"
            >
              <Icon name={action.icon} size={13} />
            </button>
          ))}
          <button
            type="button"
            title="更多"
            aria-label="更多"
            onClick={(event) => openContextMenuFromButton(event)}
            className="touch-target image-overlay flex h-8 w-8 items-center justify-center rounded-[4px] border-none"
          >
            <Icon name="dots" size={13} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Walk up from the button to the closest `data-image-action-trigger` and
 * synthesize a contextmenu event on it. Radix ContextMenu's Trigger is
 * already listening — this is the cleanest way to "open the menu
 * programmatically" without exposing imperative API surface.
 */
function openContextMenuFromButton(event: MouseEvent<HTMLButtonElement>) {
  event.stopPropagation();
  event.preventDefault();
  const target = (event.currentTarget as HTMLElement).closest(
    "[data-image-action-trigger]",
  );
  if (!target) return;
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const synthetic = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: rect.right,
    clientY: rect.bottom,
    button: 2,
  });
  target.dispatchEvent(synthetic);
}
