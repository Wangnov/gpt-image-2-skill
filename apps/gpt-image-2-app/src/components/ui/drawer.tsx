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
  return (
    <Radix.Root open={open} onOpenChange={onOpenChange}>
      <Radix.Portal>
        <Radix.Overlay
          className="fixed inset-0 z-40 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
          style={{
            background: "rgba(0,0,0,0.45)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
        />
        <Radix.Content
          aria-describedby={undefined}
          style={{
            width: width ?? "min(640px, calc(100vw - 80px))",
            backdropFilter: "blur(28px) saturate(140%)",
            WebkitBackdropFilter: "blur(28px) saturate(140%)",
            background: "rgba(14, 14, 20, 0.78)",
            boxShadow:
              "-32px 0 80px -32px rgba(0,0,0,0.7), -12px 0 32px -16px rgba(0,0,0,0.5), inset 1px 0 0 rgba(255,255,255,0.05)",
          }}
          className={cn(
            "fixed right-0 top-0 z-50 h-full grid overflow-hidden",
            "grid-rows-[auto_minmax(0,1fr)_auto]",
            "border-l border-white/[0.10]",
            "data-[state=open]:animate-in data-[state=open]:slide-in-from-right",
            "data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right",
            "data-[state=open]:duration-200 data-[state=closed]:duration-150",
          )}
        >
          {(title || headerActions) && (
            <div className="flex shrink-0 items-center gap-2 px-5 py-3.5 border-b border-white/[0.06]">
              <div className="flex-1 min-w-0">
                {title && (
                  <Radix.Title className="t-h2 tracking-tight truncate">
                    {title}
                  </Radix.Title>
                )}
                {description && (
                  <Radix.Description className="text-[12px] text-muted truncate mt-0.5">
                    {description}
                  </Radix.Description>
                )}
              </div>
              {headerActions}
              <Radix.Close asChild>
                <button
                  type="button"
                  aria-label="关闭"
                  className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted hover:text-foreground hover:bg-white/[.06] transition-colors"
                >
                  <X size={15} />
                </button>
              </Radix.Close>
            </div>
          )}
          <div className="min-h-0 overflow-y-auto overscroll-contain">
            {children}
          </div>
          {footer && (
            <div className="flex shrink-0 items-center gap-2 px-5 py-3 border-t border-white/[0.06] bg-[rgba(255,255,255,0.02)]">
              {footer}
            </div>
          )}
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
