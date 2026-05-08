import { Fragment, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/components/icon";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/ui/status-dot";
import { PlaceholderImage } from "@/components/screens/shared/placeholder-image";
import { Button } from "@/components/ui/button";
import { formatTime, statusLabel } from "@/lib/format";
import { promptSummary } from "@/lib/prompt-display";
import { api } from "@/lib/api";
import { isActiveJobStatus } from "@/lib/api/types";
import type { Job } from "@/lib/types";

const CMD_ICON: Record<string, IconName> = {
  "images generate": "generate",
  "images edit": "edit",
  "request create": "arrowin",
};

function badgeTone(status: Job["status"]) {
  if (status === "completed") return "ok" as const;
  if (status === "failed" || status === "cancelled") return "err" as const;
  if (status === "running" || status === "uploading") return "running" as const;
  return "queued" as const;
}

function jobSeed(job: Job) {
  return parseInt(job.id.replace(/\D/g, ""), 10) || 0;
}

function plannedCount(job: Job) {
  const raw = (job.metadata as Record<string, unknown>)?.n;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.min(16, Math.floor(raw));
  }
  const outputs = api.jobOutputPaths(job).length;
  return outputs > 0 ? outputs : 1;
}

function storageStatusLabel(status?: string) {
  if (status === "completed") return "已上传";
  if (status === "fallback_completed") return "已回退";
  if (status === "partial_failed") return "部分失败";
  if (status === "failed") return "上传失败";
  if (status === "running") return "上传中";
  if (status === "pending") return "待上传";
  return "";
}

function firstAvailablePath(job: Job) {
  return (
    job.outputs
      .slice()
      .sort((a, b) => a.index - b.index)
      .find((output) => output.path)?.path ?? job.output_path
  );
}

function JobAvatar({ job, promptTitle }: { job: Job; promptTitle: string }) {
  const doneCount = api.jobOutputPaths(job).length;
  const planned = plannedCount(job);
  const firstPath = firstAvailablePath(job);
  const firstUrl = firstPath ? api.fileUrl(firstPath) : "";
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [firstUrl]);

  const isFailure = job.status === "failed" || job.status === "cancelled";
  const isRunning = isActiveJobStatus(job.status);
  const showBadge = planned > 1 && !isFailure;
  const badgeText =
    job.status === "completed" || doneCount >= planned
      ? `${planned}`
      : `${doneCount}/${planned}`;

  return (
    <div className="relative h-9 w-9 shrink-0">
      <div className="h-9 w-9 overflow-hidden rounded-[5px] border border-border bg-sunken">
        {firstUrl && !failed ? (
          <img
            src={firstUrl}
            alt={`生成结果缩略图：${promptTitle}`}
            loading="lazy"
            decoding="async"
            width={36}
            height={36}
            className="h-full w-full object-cover"
            onError={() => setFailed(true)}
          />
        ) : isFailure ? (
          <div className="flex h-full w-full items-center justify-center text-faint">
            <Icon name="warn" size={14} aria-hidden="true" />
          </div>
        ) : job.status === "completed" ? (
          <PlaceholderImage seed={jobSeed(job)} />
        ) : isRunning ? (
          <div
            aria-hidden="true"
            className="h-full w-full animate-shimmer"
            style={{
              background:
                "linear-gradient(110deg, var(--bg-sunken) 0%, var(--bg-hover) 40%, var(--bg-sunken) 80%)",
              backgroundSize: "200% 100%",
            }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-faint">
            <Icon name="circle" size={14} aria-hidden="true" />
          </div>
        )}
      </div>
      {showBadge && (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute -bottom-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-[4px] border border-[color:var(--bg-raised)] px-1 text-[10px] font-semibold leading-none text-foreground",
            isRunning
              ? "bg-status-running text-foreground"
              : "bg-[color:var(--n-900)]",
          )}
        >
          {badgeText}
        </span>
      )}
    </div>
  );
}

function ExpandedOutputs({
  job,
  onOpenIndex,
}: {
  job: Job;
  onOpenIndex: (index: number) => void;
}) {
  const planned = plannedCount(job);
  const [failed, setFailed] = useState<Set<number>>(new Set());

  useEffect(() => {
    setFailed(new Set());
  }, [job.id, planned]);

  const byIndex = useMemo(() => {
    const map = new Map<number, string>();
    for (const output of job.outputs) {
      if (output.path) map.set(output.index, output.path);
    }
    // Only fall back to output_path for legacy single-shot jobs (outputs empty).
    // During streaming, output_path can reflect an arbitrary index's path, so
    // using it as index-0 would duplicate the real image.
    if (map.size === 0 && job.output_path) {
      map.set(0, job.output_path);
    }
    return map;
  }, [job.outputs, job.output_path]);

  if (planned <= 1) return null;

  return (
    <div
      className="grid min-w-[560px] gap-3 border-b border-border-faint bg-sunken px-3.5 pb-2.5 pt-0.5"
      style={{ gridTemplateColumns: "44px 1fr 130px 120px 100px 80px" }}
    >
      <span />
      <div className="col-span-5 flex flex-wrap items-center gap-1.5">
        {Array.from({ length: planned }).map((_, index) => {
          const path = byIndex.get(index);
          const url = path ? api.fileUrl(path) : "";
          const hasImage = Boolean(url) && !failed.has(index);
          const label = `候选 ${String.fromCharCode(65 + index)}`;
          const disabled = !path;
          return (
            <button
              key={index}
              type="button"
              onClick={() => {
                if (!disabled) onOpenIndex(index);
              }}
              disabled={disabled}
              className={cn(
                "h-11 w-11 shrink-0 overflow-hidden rounded-md border bg-raised transition-colors focus-visible:border-accent focus-visible:outline-none",
                disabled
                  ? "cursor-default border-border-faint"
                  : "cursor-pointer border-border hover:border-border-strong",
              )}
              aria-label={`查看${label}`}
              title={disabled ? `${label} · 等待生成` : label}
            >
              {hasImage ? (
                <img
                  src={url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                  onError={() => setFailed((prev) => new Set(prev).add(index))}
                />
              ) : (
                <div
                  aria-hidden="true"
                  className="h-full w-full animate-shimmer"
                  style={{
                    background:
                      "linear-gradient(110deg, var(--bg-sunken) 0%, var(--bg-hover) 40%, var(--bg-sunken) 80%)",
                    backgroundSize: "200% 100%",
                  }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function JobRow({
  job,
  selected,
  expanded,
  onSelect,
  onToggleExpanded,
  onSelectOutput,
  onDelete,
}: {
  job: Job;
  selected: boolean;
  expanded?: boolean;
  onSelect: () => void;
  onToggleExpanded?: () => void;
  onSelectOutput?: (index: number) => void;
  onDelete?: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const [hover, setHover] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const prompt = (job.metadata as Record<string, unknown>)?.prompt as
    | string
    | undefined;
  const title = promptSummary(prompt, 36);
  const size = (job.metadata as Record<string, unknown>)?.size as
    | string
    | undefined;
  const format = (job.metadata as Record<string, unknown>)?.format as
    | string
    | undefined;
  const planned = plannedCount(job);
  const doneCount = api.jobOutputPaths(job).length;
  const grouped = planned > 1;
  const storageLabel =
    job.status === "completed" ? storageStatusLabel(job.storage_status) : "";

  return (
    <Fragment>
      <div
        role="button"
        tabIndex={0}
        aria-label={`${title}，${job.provider}，${job.status}`}
        aria-pressed={selected}
        aria-expanded={grouped ? Boolean(expanded) : undefined}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          } else if (e.key === "ArrowRight" && grouped && !expanded) {
            e.preventDefault();
            onToggleExpanded?.();
          } else if (e.key === "ArrowLeft" && grouped && expanded) {
            e.preventDefault();
            onToggleExpanded?.();
          } else if (
            (e.key === "Delete" || e.key === "Backspace") &&
            onDelete
          ) {
            e.preventDefault();
            onDelete();
          }
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocusCapture={() => setFocusWithin(true)}
        onBlurCapture={(event) => {
          if (
            !event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            setFocusWithin(false);
          }
        }}
        className={cn(
          "grid min-w-[560px] cursor-pointer items-center gap-3 px-3.5 py-2.5 focus-visible:bg-hover focus-visible:outline-none",
          expanded ? "border-b-0" : "border-b border-border-faint",
          selected ? "bg-pressed" : hover ? "bg-hover" : "bg-transparent",
        )}
        style={{ gridTemplateColumns: "44px 1fr 130px 120px 100px 80px" }}
      >
        <JobAvatar job={job} promptTitle={title} />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Icon
              name={CMD_ICON[job.command] ?? "sparkle"}
              size={12}
              style={{ color: "var(--text-faint)" }}
            />
            <span className="truncate text-[12.5px] font-semibold">
              {title}
            </span>
          </div>
          <div className="mt-0.5 text-[11px] text-faint">
            {formatTime(job.created_at)}
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[12px]">
          <Icon name="cpu" size={12} style={{ color: "var(--text-faint)" }} />
          <span className="truncate">{job.provider}</span>
        </div>
        <div className="font-mono text-[11.5px] text-muted">
          {size ?? "—"}
          {format ? ` · ${format}` : ""}
          {grouped
            ? job.status === "completed"
              ? ` · ×${planned}`
              : ` · ${doneCount}/${planned}`
            : ""}
        </div>
        <div>
          <Badge tone={badgeTone(job.status)}>
            <StatusDot
              status={job.status}
              pulse={isActiveJobStatus(job.status)}
            />
            {statusLabel(job.status)}
          </Badge>
          {storageLabel && (
            <div className="mt-1 text-[10.5px] text-faint">{storageLabel}</div>
          )}
        </div>
        <div className="flex justify-end gap-0.5">
          {grouped && (
            <Button
              variant="ghost"
              size="iconSm"
              icon="chevdown"
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpanded?.();
              }}
              className={cn(
                "transition-transform",
                expanded ? "rotate-180" : "rotate-0",
              )}
              title={expanded ? "收起本批次" : "展开本批次"}
              aria-label={expanded ? "收起本批次" : "展开本批次"}
            />
          )}
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
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="expanded"
            initial={
              reducedMotion ? false : { height: 0, opacity: 0 }
            }
            animate={{ height: "auto", opacity: 1 }}
            exit={
              reducedMotion ? { opacity: 0 } : { height: 0, opacity: 0 }
            }
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: "hidden" }}
          >
            <ExpandedOutputs
              job={job}
              onOpenIndex={(index) => onSelectOutput?.(index)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </Fragment>
  );
}
