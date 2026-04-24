import { cn } from "@/lib/cn";
import type { JobStatus } from "@/lib/types";

export function StatusDot({ status, pulse }: { status: JobStatus | "idle"; pulse?: boolean }) {
  const colors: Record<string, string> = {
    running: "bg-status-running",
    completed: "bg-status-ok",
    failed: "bg-status-err",
    cancelled: "bg-status-err",
    queued: "bg-status-queued",
    idle: "bg-neutral-300",
  };
  return (
    <span
      className={cn(
        "inline-block w-2 h-2 rounded-full shrink-0",
        colors[status] || "bg-neutral-300",
        pulse && "animate-pulse-subtle"
      )}
    />
  );
}
