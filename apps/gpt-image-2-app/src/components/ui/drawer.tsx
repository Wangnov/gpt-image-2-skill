import * as Radix from "@radix-ui/react-dialog";
import { type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Drawer — right-side slide-in sheet built on Radix Dialog.
 *
 * Uses the same liquid glass surface as the Dialog primitive but anchors
 * to the right edge with a width-based responsive cap so it never blocks
 * the entire viewport. Esc / overlay-click / X button all dismiss.
 */

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  description?: ReactNode;
  /** Right-edge width in px. Defaults to a fluid 480-640 range. */
  width?: number;
  /** Header right-aligned actions (close button is always rendered). */
  headerActions?: ReactNode;
  /** Sticky bottom action bar. */
  footer?: ReactNode;
  children: ReactNode;
};

export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  width,
  headerActions,
  footer,
  children,
}: Props) {
  const drawerWidth =
    typeof width === "number"
      ? `min(${width}px, calc(100vw - 32px))`
      : "min(640px, calc(100vw - 80px))";

  return (
    <Radix.Root open={open} onOpenChange={onOpenChange}>
      <Radix.Portal>
        <Radix.Overlay
          className="drawer-overlay-blur fixed inset-0 z-40"
          style={{
            background: "var(--k-45)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
          }}
        />
        <Radix.Content
          aria-describedby={undefined}
          style={{
            width: drawerWidth,
            backdropFilter: "blur(28px) saturate(140%)",
            WebkitBackdropFilter: "blur(28px) saturate(140%)",
            background: "var(--surface-floating-soft)",
            boxShadow: "var(--shadow-floating-side)",
          }}
          className={cn(
            "fixed right-0 top-0 z-50 h-full grid min-w-0 overflow-hidden",
            "grid-rows-[auto_minmax(0,1fr)_auto]",
            "border-l border-[color:var(--w-10)]",
            "data-[state=open]:animate-in data-[state=open]:slide-in-from-right",
            "data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right",
            "data-[state=open]:duration-200 data-[state=closed]:duration-150",
          )}
        >
          {(title || headerActions) && (
            <div className="flex shrink-0 items-center gap-2 px-5 py-3.5 border-b border-[color:var(--w-06)]">
              <div className="flex-1 min-w-0">
                {title && (
                  <Radix.Title className="t-h2 truncate">
                    {title}
                  </Radix.Title>
                )}
                {description && (
                  <Radix.Description className="mt-0.5 line-clamp-2 break-anywhere text-[12px] leading-relaxed text-muted">
                    {description}
                  </Radix.Description>
                )}
              </div>
              {headerActions}
              <Radix.Close asChild>
                <button
                  type="button"
                  aria-label="关闭"
                  className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted hover:text-foreground hover:bg-[color:var(--w-06)] transition-colors"
                >
                  <X size={15} />
                </button>
              </Radix.Close>
            </div>
          )}
          <div className="min-h-0 min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain">
            {children}
          </div>
          {footer && (
            <div className="flex min-w-0 shrink-0 items-center gap-2 overflow-hidden px-5 py-3 border-t border-[color:var(--w-06)] bg-[color:var(--w-02)]">
              {footer}
            </div>
          )}
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
