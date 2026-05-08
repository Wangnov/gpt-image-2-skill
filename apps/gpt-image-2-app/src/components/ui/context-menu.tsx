import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
} from "react";
import * as RadixContextMenu from "@radix-ui/react-context-menu";
import { cn } from "@/lib/cn";

/**
 * GlassContextMenu — Radix ContextMenu with the same liquid-glass surface as
 * GlassPopover (see ui/popover.tsx). Used by ImageContextMenu and any other
 * "right-click reveals options" pattern in the app.
 */

export const ContextMenu = RadixContextMenu.Root;
export const ContextMenuTrigger = RadixContextMenu.Trigger;
export const ContextMenuPortal = RadixContextMenu.Portal;
export const ContextMenuGroup = RadixContextMenu.Group;
export const ContextMenuLabel = RadixContextMenu.Label;
export const ContextMenuSub = RadixContextMenu.Sub;
export const ContextMenuRadioGroup = RadixContextMenu.RadioGroup;

const surfaceClasses = cn(
  // z-[70] keeps the menu above Drawer (z-50) and Quick Look overlay
  // (z-[60-61]) so right-click on the zoomed image / inside drawers still
  // shows actions.
  "z-[70] min-w-[200px] rounded-xl border outline-none p-1",
  "data-[state=open]:animate-in data-[state=closed]:animate-out",
  "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
  "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
);

const surfaceStyle = {
  background: "var(--surface-floating)",
  borderColor: "var(--surface-floating-border)",
  backdropFilter: "blur(28px) saturate(150%)",
  WebkitBackdropFilter: "blur(28px) saturate(150%)",
  boxShadow: "var(--shadow-floating)",
} as const;

export const ContextMenuContent = forwardRef<
  ElementRef<typeof RadixContextMenu.Content>,
  ComponentPropsWithoutRef<typeof RadixContextMenu.Content>
>(({ className, ...rest }, ref) => (
  <RadixContextMenu.Portal>
    <RadixContextMenu.Content
      ref={ref}
      className={cn(surfaceClasses, className)}
      style={surfaceStyle}
      {...rest}
    />
  </RadixContextMenu.Portal>
));
ContextMenuContent.displayName = "ContextMenuContent";

export const ContextMenuSubContent = forwardRef<
  ElementRef<typeof RadixContextMenu.SubContent>,
  ComponentPropsWithoutRef<typeof RadixContextMenu.SubContent>
>(({ className, ...rest }, ref) => (
  <RadixContextMenu.Portal>
    <RadixContextMenu.SubContent
      ref={ref}
      className={cn(surfaceClasses, className)}
      style={surfaceStyle}
      {...rest}
    />
  </RadixContextMenu.Portal>
));
ContextMenuSubContent.displayName = "ContextMenuSubContent";

const itemClasses = cn(
  "relative flex select-none items-center justify-between gap-3",
  "rounded-md px-2.5 py-1.5 text-[13px] outline-none cursor-default",
  "text-[color:var(--text)]",
  "data-[highlighted]:bg-[color:var(--bg-hover)] data-[highlighted]:text-[color:var(--text)]",
  "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
);

export const ContextMenuItem = forwardRef<
  ElementRef<typeof RadixContextMenu.Item>,
  ComponentPropsWithoutRef<typeof RadixContextMenu.Item> & {
    destructive?: boolean;
  }
>(({ className, destructive, ...rest }, ref) => (
  <RadixContextMenu.Item
    ref={ref}
    className={cn(
      itemClasses,
      destructive &&
        "text-[color:var(--status-err)] data-[highlighted]:bg-[color:var(--status-err-bg)] data-[highlighted]:text-[color:var(--status-err)]",
      className,
    )}
    {...rest}
  />
));
ContextMenuItem.displayName = "ContextMenuItem";

export const ContextMenuSubTrigger = forwardRef<
  ElementRef<typeof RadixContextMenu.SubTrigger>,
  ComponentPropsWithoutRef<typeof RadixContextMenu.SubTrigger>
>(({ className, ...rest }, ref) => (
  <RadixContextMenu.SubTrigger
    ref={ref}
    className={cn(itemClasses, className)}
    {...rest}
  />
));
ContextMenuSubTrigger.displayName = "ContextMenuSubTrigger";

export const ContextMenuSeparator = forwardRef<
  ElementRef<typeof RadixContextMenu.Separator>,
  ComponentPropsWithoutRef<typeof RadixContextMenu.Separator>
>(({ className, ...rest }, ref) => (
  <RadixContextMenu.Separator
    ref={ref}
    className={cn("my-1 h-px", className)}
    style={{ background: "var(--border-faint)" }}
    {...rest}
  />
));
ContextMenuSeparator.displayName = "ContextMenuSeparator";

export const ContextMenuShortcut = forwardRef<
  HTMLSpanElement,
  ComponentPropsWithoutRef<"span">
>(({ className, ...rest }, ref) => (
  <span
    ref={ref}
    className={cn(
      "ml-auto pl-4 text-[11px] tabular-nums text-[color:var(--text-faint)]",
      className,
    )}
    {...rest}
  />
));
ContextMenuShortcut.displayName = "ContextMenuShortcut";
