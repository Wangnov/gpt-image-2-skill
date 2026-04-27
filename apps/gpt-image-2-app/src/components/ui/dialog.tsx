import * as Radix from "@radix-ui/react-dialog";
import { type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./button";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  width?: number;
  maxHeight?: number;
  children: ReactNode;
  footer?: ReactNode;
};

export function Dialog({
  open,
  onOpenChange,
  title,
  width = 520,
  maxHeight = 720,
  children,
  footer,
}: Props) {
  return (
    <Radix.Root open={open} onOpenChange={onOpenChange}>
      <Radix.Portal>
        <Radix.Overlay
          className="fixed inset-0 z-40 animate-fade-in"
          style={{
            background: "var(--k-55)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
        />
        <Radix.Content
          style={{
            width,
            maxWidth: "calc(100vw - 48px)",
            maxHeight: `min(${maxHeight}px, calc(100vh - 48px))`,
            backdropFilter: "blur(28px) saturate(140%)",
            WebkitBackdropFilter: "blur(28px) saturate(140%)",
            background: "var(--surface-floating-soft)",
          }}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 grid -translate-x-1/2 -translate-y-1/2 overflow-hidden",
            "grid-rows-[auto_minmax(0,1fr)_auto]",
            "rounded-xl shadow-lg animate-fade-in",
            "border border-border-strong",
          )}
        >
          {title && (
            <div className="flex shrink-0 items-center justify-between px-[18px] py-3.5 border-b border-border-faint">
              <Radix.Title className="t-h2">{title}</Radix.Title>
              <Radix.Close asChild>
                <Button variant="ghost" size="iconSm" icon="x" />
              </Radix.Close>
            </div>
          )}
          <div className="min-h-0 overflow-y-auto overscroll-contain p-[18px]">
            {children}
          </div>
          {footer && (
            <div className="flex shrink-0 justify-end gap-2 border-t border-border-faint px-[18px] py-3 bg-[color:var(--w-02)]">
              {footer}
            </div>
          )}
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
