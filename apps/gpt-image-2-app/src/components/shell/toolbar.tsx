import { type ReactNode } from "react";
import { Button } from "@/components/ui/button";

export function AppToolbar({
  title,
  subtitle,
  actions,
  onOpenCommand,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  onOpenCommand?: () => void;
}) {
  return (
    <div
      className="relative h-14 shrink-0 flex items-center gap-2.5 px-4 xl:px-5 border-b border-border-faint"
      style={{
        background: "rgba(10,10,14,0.45)",
        backdropFilter: "blur(18px) saturate(140%)",
        WebkitBackdropFilter: "blur(18px) saturate(140%)",
      }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-0 right-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(255,255,255,0.06) 12%, rgba(255,255,255,0.06) 88%, transparent)",
        }}
      />

      <div className="flex-1 min-w-0">
        <div className="t-h2 truncate text-foreground tracking-tight">
          {title}
        </div>
        {subtitle && (
          <div className="t-small mt-px hidden truncate lg:block">
            {subtitle}
          </div>
        )}
      </div>
      <Button
        variant="ghost"
        size="md"
        icon="search"
        onClick={onOpenCommand}
        aria-label="打开命令面板"
      >
        <span className="hidden text-muted xl:inline">跳转到…</span>
        <span className="kbd">⌘K</span>
      </Button>
      {actions}
    </div>
  );
}
