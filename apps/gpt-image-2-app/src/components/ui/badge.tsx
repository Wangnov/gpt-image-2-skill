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
    "bg-(--w-05) text-muted border-border",
  accent:
    "bg-(--accent-14) text-(--accent) border-(--accent-30)",
  ok: "bg-(--status-ok-bg) text-(--status-ok) border-(--status-ok-25)",
  running:
    "bg-(--status-running-bg) text-(--status-running) border-(--status-running-25)",
  err: "bg-(--status-err-bg) text-(--status-err) border-(--status-err-30)",
  queued:
    "bg-(--status-queued-bg) text-(--status-queued) border-(--status-queued-20)",
  outline: "bg-transparent text-muted border-border",
  dark: "bg-(--surface-inverted) text-(--text-on-inverted) border-(--surface-inverted)",
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
