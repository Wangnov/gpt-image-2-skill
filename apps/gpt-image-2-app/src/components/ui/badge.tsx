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
    "bg-[rgba(255,255,255,0.05)] text-muted border-border",
  accent:
    "bg-[rgba(167,139,250,0.14)] text-[color:var(--accent)] border-[rgba(167,139,250,0.30)]",
  ok: "bg-[rgba(52,211,153,0.14)] text-[color:var(--status-ok)] border-[rgba(52,211,153,0.25)]",
  running:
    "bg-[rgba(251,191,36,0.14)] text-[color:var(--status-running)] border-[rgba(251,191,36,0.25)]",
  err: "bg-[rgba(248,113,113,0.16)] text-[color:var(--status-err)] border-[rgba(248,113,113,0.30)]",
  queued:
    "bg-[rgba(148,163,184,0.14)] text-[color:var(--status-queued)] border-[rgba(148,163,184,0.20)]",
  outline: "bg-transparent text-muted border-border",
  dark: "bg-white text-[#06060a] border-white",
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
