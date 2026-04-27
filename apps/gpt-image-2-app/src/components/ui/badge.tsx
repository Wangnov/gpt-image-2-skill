import { type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/components/icon";

type Tone =
  | "neutral"
  | "accent"
  | "ok"
  | "running"
  | "err"
  | "queued"
  | "outline"
  | "dark";

type Props = {
  tone?: Tone;
  icon?: IconName;
  size?: "sm" | "md";
  className?: string;
  children?: ReactNode;
};

const toneClass: Record<Tone, string> = {
  neutral:
    "bg-[color:var(--w-05)] text-muted border-border",
  accent:
    "bg-[color:var(--accent-14)] text-[color:var(--accent)] border-[color:var(--accent-30)]",
  ok: "bg-[color:var(--status-ok-bg)] text-[color:var(--status-ok)] border-[color:var(--status-ok-25)]",
  running:
    "bg-[color:var(--status-running-bg)] text-[color:var(--status-running)] border-[color:var(--status-running-25)]",
  err: "bg-[color:var(--status-err-bg)] text-[color:var(--status-err)] border-[color:var(--status-err-30)]",
  queued:
    "bg-[color:var(--status-queued-bg)] text-[color:var(--status-queued)] border-[color:var(--status-queued-20)]",
  outline: "bg-transparent text-muted border-border",
  dark: "bg-[color:var(--surface-inverted)] text-[color:var(--text-on-inverted)] border-[color:var(--surface-inverted)]",
};

export function Badge({
  tone = "neutral",
  icon,
  size = "md",
  className,
  children,
}: Props) {
  const h =
    size === "sm"
      ? "h-[18px] px-1.5 text-[10.5px]"
      : "h-[22px] px-2 text-[11.5px]";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 border rounded-full font-medium tracking-tight",
        h,
        toneClass[tone],
        className,
      )}
    >
      {icon && <Icon name={icon} size={11} />}
      {children}
    </span>
  );
}
