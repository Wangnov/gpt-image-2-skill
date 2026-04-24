import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/components/icon";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/ui/status-dot";
import { PlaceholderImage } from "@/components/screens/shared/placeholder-image";
import { Button } from "@/components/ui/button";
import { formatTime, statusLabel } from "@/lib/format";
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
  const [focusWithin, setFocusWithin] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const prompt = (job.metadata as Record<string, unknown>)?.prompt as
    | string
    | undefined;
  const size = (job.metadata as Record<string, unknown>)?.size as
    | string
    | undefined;
  const format = (job.metadata as Record<string, unknown>)?.format as
    | string
    | undefined;
  const outputCount = api.jobOutputPaths(job).length;
  const thumbSrc = job.status === "completed" ? api.jobOutputUrl(job, 0) : null;

  useEffect(() => {
    setImageFailed(false);
  }, [thumbSrc]);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${prompt ?? "未命名任务"}，${job.provider}，${job.status}`}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        } else if ((e.key === "Delete" || e.key === "Backspace") && onDelete) {
          e.preventDefault();
          onDelete();
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocusCapture={() => setFocusWithin(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocusWithin(false);
        }
      }}
      className={cn(
        "grid min-w-[560px] cursor-pointer items-center gap-3 border-b border-border-faint px-3.5 py-2.5 focus-visible:bg-hover focus-visible:outline-none",
        selected ? "bg-pressed" : hover ? "bg-hover" : "bg-transparent",
      )}
      style={{ gridTemplateColumns: "44px 1fr 130px 120px 100px 80px" }}
    >
      <div className="w-9 h-9 rounded-[5px] overflow-hidden bg-sunken border border-border shrink-0">
        {thumbSrc && !imageFailed ? (
          <img
            src={thumbSrc}
            alt={prompt ? `生成结果缩略图：${prompt}` : "生成结果缩略图"}
            loading="lazy"
            decoding="async"
            width={36}
            height={36}
            className="w-full h-full object-cover"
            onError={() => setImageFailed(true)}
          />
        ) : job.status === "completed" ? (
          <PlaceholderImage
            seed={parseInt(job.id.replace(/\D/g, ""), 10) || 0}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-faint">
            <Icon
              name={job.status === "failed" ? "warn" : "circle"}
              size={14}
              aria-hidden="true"
            />
          </div>
        )}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <Icon
            name={CMD_ICON[job.command] ?? "sparkle"}
            size={12}
            style={{ color: "var(--text-faint)" }}
          />
          <span className="text-[12.5px] font-semibold truncate">
            {prompt || "未命名图片"}
          </span>
        </div>
        <div className="text-[11px] text-faint mt-0.5">
          {formatTime(job.created_at)}
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-[12px]">
        <Icon name="cpu" size={12} style={{ color: "var(--text-faint)" }} />
        <span className="truncate">{job.provider}</span>
      </div>
      <div className="text-[11.5px] text-muted font-mono">
        {size ?? "—"} {format ? `· ${format}` : ""}
        {outputCount > 1 ? ` · ${outputCount}张` : ""}
      </div>
      <div>
        <Badge tone={badgeTone(job.status)}>
          <StatusDot status={job.status} pulse={job.status === "running"} />
          {statusLabel(job.status)}
        </Badge>
      </div>
      <div className="flex gap-0.5 justify-end">
        {(hover || focusWithin) && onDelete && (
          <Button
            variant="ghost"
            size="iconSm"
            icon="trash"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            title="删除"
            aria-label="删除任务"
          />
        )}
      </div>
    </div>
  );
}
