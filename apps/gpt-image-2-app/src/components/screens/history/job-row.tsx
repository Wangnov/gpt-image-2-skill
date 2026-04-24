import { useState } from "react";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/components/icon";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/ui/status-dot";
import { PlaceholderImage } from "@/components/screens/shared/placeholder-image";
import { Button } from "@/components/ui/button";
import { statusLabel } from "@/lib/format";
import { api } from "@/lib/api";
import type { Job } from "@/lib/types";

const CMD_ICON: Record<string, IconName> = {
  "images generate": "generate",
  "images edit": "edit",
  "request create": "arrowin",
};

function badgeTone(status: Job["status"]) {
  if (status === "completed") return "ok" as const;
  if (status === "failed" || status === "cancelled") return "err" as const;
  if (status === "running") return "running" as const;
  return "queued" as const;
}

export function JobRow({
  job,
  selected,
  onSelect,
  onDelete,
}: {
  job: Job;
  selected: boolean;
  onSelect: () => void;
  onDelete?: () => void;
}) {
  const [hover, setHover] = useState(false);
  const prompt = (job.metadata as Record<string, unknown>)?.prompt as string | undefined;
  const size = (job.metadata as Record<string, unknown>)?.size as string | undefined;
  const format = (job.metadata as Record<string, unknown>)?.format as string | undefined;
  const thumbSrc = job.status === "completed" ? api.outputUrl(job.id, 0) : null;

  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={cn(
        "grid items-center gap-3 px-3.5 py-2.5 border-b border-border-faint cursor-pointer",
        selected ? "bg-pressed" : hover ? "bg-hover" : "bg-transparent"
      )}
      style={{ gridTemplateColumns: "44px 1fr 130px 120px 100px 80px" }}
    >
      <div className="w-9 h-9 rounded-[5px] overflow-hidden bg-sunken border border-border shrink-0">
        {thumbSrc ? (
          <img src={thumbSrc} alt="" className="w-full h-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
        ) : job.status === "completed" ? (
          <PlaceholderImage seed={parseInt(job.id.replace(/\D/g, ""), 10) || 0} />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-faint">
            <Icon name={job.status === "failed" ? "warn" : "circle"} size={14} />
          </div>
        )}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <Icon name={CMD_ICON[job.command] ?? "sparkle"} size={12} style={{ color: "var(--text-faint)" }} />
          <span className="text-[12.5px] font-semibold truncate">{prompt || job.id}</span>
        </div>
        <div className="text-[11px] text-faint font-mono mt-0.5">{job.id}</div>
      </div>
      <div className="flex items-center gap-1.5 text-[12px]">
        <Icon name="cpu" size={12} style={{ color: "var(--text-faint)" }} />
        <span className="truncate">{job.provider}</span>
      </div>
      <div className="text-[11.5px] text-muted font-mono">
        {size ?? "—"} {format ? `· ${format}` : ""}
      </div>
      <div>
        <Badge tone={badgeTone(job.status)}>
          <StatusDot status={job.status} pulse={job.status === "running"} />
          {statusLabel(job.status)}
        </Badge>
      </div>
      <div className="flex gap-0.5 justify-end">
        {hover && onDelete && (
          <Button
            variant="ghost"
            size="iconSm"
            icon="trash"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            title="删除"
          />
        )}
      </div>
    </div>
  );
}
