import { t } from "@/lib/i18n";
import { AlertTriangle, CheckCircle2, Clock, Loader2, X } from "lucide-react";
import type { JobStatus } from "@/lib/types";

export function StatusChip({
  status,
  label,
}: {
  status: JobStatus;
  label?: string;
}) {
  if (status === "completed") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] text-[color:var(--status-ok)]">
        <CheckCircle2 size={13} />
        {label ?? t("已完成")}
      </span>
    );
  }
  if (status === "partial_failed") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] text-[color:var(--status-warn,#f5c542)]">
        <AlertTriangle size={13} />
        {label ?? t("部分成功")}
      </span>
    );
  }
  if (status === "running" || status === "uploading") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] text-[color:var(--status-running)]">
        <Loader2 size={13} className="animate-spin" />
        {label ?? t("进行中")}
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] text-[color:var(--status-err)]">
        <X size={13} />
        {label ?? t("失败")}
      </span>
    );
  }
  if (status === "cancelled" || status === "canceled") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] text-[color:var(--status-err)]">
        <X size={13} />
        {label ?? t("已取消")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-[color:var(--status-queued)]">
      <Clock size={13} />
      {label ?? t("等待中")}
    </span>
  );
}
