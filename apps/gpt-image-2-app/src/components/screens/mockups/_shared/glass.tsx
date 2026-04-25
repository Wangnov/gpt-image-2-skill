import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/cn";

/* ── GlassPanel ──────────────────────────────────── */
type GlassPanelProps = HTMLAttributes<HTMLDivElement> & {
  variant?: "default" | "strong" | "deep";
};
export function GlassPanel({
  variant = "default",
  className,
  children,
  ...rest
}: GlassPanelProps) {
  return (
    <div
      className={cn(
        "glass-panel",
        variant === "strong" && "glass-panel--strong",
        variant === "deep" && "glass-panel--deep",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/* ── GlassButton ──────────────────────────────────── */
type GlassButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "ghost";
  size?: "sm" | "md" | "lg" | "icon";
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
};
export const GlassButton = forwardRef<HTMLButtonElement, GlassButtonProps>(
  function GlassButton(
    {
      variant = "default",
      size = "md",
      iconLeft,
      iconRight,
      className,
      type = "button",
      children,
      ...rest
    },
    ref,
  ) {
    const sizeCls =
      size === "sm"
        ? "h-8 px-3 text-[12px] gap-1.5"
        : size === "lg"
          ? "h-12 px-6 text-[14px] gap-2"
          : size === "icon"
            ? "h-9 w-9 justify-center"
            : "h-9 px-4 text-[13px] gap-1.5";

    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "glass-button inline-flex items-center justify-center whitespace-nowrap select-none",
          sizeCls,
          variant === "primary" && "glass-button--primary",
          variant === "ghost" && "glass-button--ghost",
          className,
        )}
        {...rest}
      >
        {iconLeft}
        {children}
        {iconRight}
      </button>
    );
  },
);

/* ── GlassChip ──────────────────────────────────── */
export function GlassChip({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("glass-chip", className)} {...rest}>
      {children}
    </div>
  );
}

/* ── GlassInput ──────────────────────────────────── */
export const GlassInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function GlassInput({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "glass-input h-9 px-3 text-[13px] w-full",
        className,
      )}
      {...rest}
    />
  );
});

/* ── GlassTextarea ──────────────────────────────────── */
export const GlassTextarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function GlassTextarea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "glass-textarea w-full px-3.5 py-3 text-[13px] resize-none",
        className,
      )}
      {...rest}
    />
  );
});

/* ── GlassSelect (display-only chip dropdown for mockup) ── */
export function GlassSelect({
  label,
  value,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { label: string; value: string }) {
  return (
    <div
      className={cn(
        "glass-input flex items-center gap-2 h-9 px-3 cursor-pointer hover:bg-white/[.06] transition-colors",
        className,
      )}
      {...rest}
    >
      <span className="text-[10.5px] uppercase tracking-wider text-on-glass-faint">
        {label}
      </span>
      <span className="text-[12.5px] text-on-glass">{value}</span>
      <svg
        width="10"
        height="10"
        viewBox="0 0 12 12"
        fill="none"
        className="ml-auto opacity-60"
      >
        <path
          d="M3 4.5L6 7.5L9 4.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

/* ── StatusDot ──────────────────────────────────── */
export function StatusDot({
  variant,
  className,
}: {
  variant: "ok" | "run" | "err" | "queue";
  className?: string;
}) {
  return (
    <span className={cn("status-dot", `status-dot--${variant}`, className)} />
  );
}

/* ── GlassDivider ──────────────────────────────────── */
export function GlassDivider({ className }: { className?: string }) {
  return <div className={cn("glass-divider", className)} />;
}

/* ── GlassProgress ──────────────────────────────────── */
export function GlassProgress({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("glass-progress", className)}>
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}
