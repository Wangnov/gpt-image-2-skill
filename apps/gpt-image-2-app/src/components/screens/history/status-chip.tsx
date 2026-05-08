import { CheckCircle2, Clock, Loader2, X } from "lucide-react";
import type { JobStatus } from "@/lib/types";

export function StatusChip({ status }: { status: JobStatus }) {
  if (status === "completed") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] text-[color:var(--status-ok)]">
        <CheckCircle2 size={13} />
        已完成
      </span>
    );
  }
  if (status === "running" || status === "uploading") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] text-[color:var(--status-running)]">
        <Loader2 size={13} className="animate-spin" />
        进行中
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] text-[color:var(--status-err)]">
        <X size={13} />
        失败
      </span>
    );
  }
  if (status === "cancelled") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] text-[color:var(--status-err)]">
        <X size={13} />
        已取消
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-[color:var(--status-queued)]">
      <Clock size={13} />
      等待中
    </span>
  );
}
