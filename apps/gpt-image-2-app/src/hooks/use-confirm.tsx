import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type ConfirmVariant = "default" | "danger";

export interface ConfirmOptions {
  title: ReactNode;
  description?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: ConfirmVariant;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface PendingState {
  opts: ConfirmOptions;
  resolve: (value: boolean) => void;
}

/**
 * Provider for the in-app confirmation dialog.
 *
 * Replaces window.confirm() calls so the prompt is rendered in the
 * project's own glass dialog (consistent type, focus management, dismissal
 * via Esc / overlay click) instead of the native browser modal that breaks
 * the visual language.
 *
 * Usage:
 *   const confirm = useConfirm();
 *   const ok = await confirm({
 *     title: "删除任务记录",
 *     description: "图片文件不会被删除。",
 *     variant: "danger",
 *   });
 *   if (ok) deleteJob(id);
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingState | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      setPending({ opts, resolve });
    });
  }, []);

  const close = (value: boolean) => {
    pending?.resolve(value);
    setPending(null);
  };

  const opts = pending?.opts;
  const variant = opts?.variant ?? "default";

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) close(false);
        }}
        title={opts?.title ?? ""}
        width={420}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => close(false)}>
              {opts?.cancelText ?? "取消"}
            </Button>
            <Button
              variant={variant === "danger" ? "danger" : "primary"}
              size="sm"
              onClick={() => close(true)}
              autoFocus
            >
              {opts?.confirmText ?? "确认"}
            </Button>
          </>
        }
      >
        {opts?.description && (
          <div className="text-[13px] leading-relaxed text-muted">
            {opts.description}
          </div>
        )}
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm() requires <ConfirmProvider> ancestor.");
  }
  return ctx;
}
