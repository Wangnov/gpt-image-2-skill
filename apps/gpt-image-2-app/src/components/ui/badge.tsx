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
  neutral: "bg-sunken text-muted border-border",
  accent: "bg-accent-faint text-[color:var(--accent)] border-transparent",
  ok: "bg-status-ok-bg text-status-ok border-transparent",
  running: "bg-status-running-bg text-status-running border-transparent",
  err: "bg-status-err-bg text-status-err border-transparent",
  queued: "bg-status-queued-bg text-status-queued border-border",
  outline: "bg-transparent text-muted border-border",
  dark: "bg-[color:var(--n-900)] text-white border-[color:var(--n-900)]",
};

export function Badge({ tone = "neutral", icon, size = "md", className, children }: Props) {
  const h = size === "sm" ? "h-[18px] px-1.5 text-[10.5px]" : "h-[22px] px-2 text-[11.5px]";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 border rounded font-medium",
        h,
        toneClass[tone],
        className
      )}
    >
      {icon && <Icon name={icon} size={11} />}
      {children}
    </span>
  );
}
