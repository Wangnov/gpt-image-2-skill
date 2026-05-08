import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { StatusDot } from "@/components/ui/status-dot";
import { Icon } from "@/components/icon";
import { PlaceholderImage } from "@/components/screens/shared/placeholder-image";
import { formatDuration, formatTime, statusLabel } from "@/lib/format";
import { promptLength, promptSummary, promptText } from "@/lib/prompt-display";
import { api } from "@/lib/api";
import {
  copyText,
  openPath,
  revealPath,
  saveImages,
  saveJobImages,
} from "@/lib/user-actions";
import { resultLocationText, runtimeCopy } from "@/lib/runtime-copy";
import { isActiveJobStatus } from "@/lib/api/types";
import type { Job, OutputUploadRef } from "@/lib/types";

function badgeTone(status: Job["status"]) {
  if (status === "completed") return "ok" as const;
  if (status === "failed" || status === "cancelled") return "err" as const;
  if (status === "running" || status === "uploading") return "running" as const;
  return "queued" as const;
}

function readPlannedCount(job: Job) {
  const raw = (job.metadata as Record<string, unknown>)?.n;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.min(16, Math.floor(raw));
  }
  const outputs = api.jobOutputPaths(job).length;
  return outputs > 0 ? outputs : 1;
}

function storageStatusLabel(status?: string) {
  switch (status) {
    case "completed":
      return "已上传";
    case "partial_failed":
      return "部分失败";
    case "failed":
      return "上传失败";
    case "fallback_completed":
      return "已回退";
    case "pending":
      return "待上传";
    case "running":
      return "上传中";
    default:
      return "未配置";
  }
}

function uploadStatusTone(status?: string) {
  if (status === "completed") return "text-[color:var(--status-ok)]";
  if (status === "failed" || status === "unsupported") {
    return "text-[color:var(--status-err)]";
  }
  return "text-muted";
}

function outputUploadsFor(job: Job, index: number): OutputUploadRef[] {
  return job.outputs.find((output) => output.index === index)?.uploads ?? [];
}

const SHIMMER_STYLE: React.CSSProperties = {
  background:
    "linear-gradient(110deg, var(--bg-sunken) 0%, var(--bg-hover) 40%, var(--bg-sunken) 80%)",
  backgroundSize: "200% 100%",
};

export function JobMetadataDrawer({
  job,
  outputIndex,
  onOutputIndexChange,
  onClose,
  onDelete,
  onCancel,
}: {
  job?: Job;
  outputIndex?: number;
  onOutputIndexChange?: (index: number) => void;
  onClose: () => void;
  onDelete?: (id: string) => void;
  onCancel?: (id: string) => void;
}) {
  const [internalIndex, setInternalIndex] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const controlled = outputIndex !== undefined;
  const selectedOutput = controlled ? (outputIndex as number) : internalIndex;

  const setSelectedOutput = useCallback(
    (index: number) => {
      if (onOutputIndexChange) onOutputIndexChange(index);
      if (!controlled) setInternalIndex(index);
    },
    [controlled, onOutputIndexChange],
  );

  const meta = (job?.metadata ?? {}) as Record<string, unknown>;
  const seed = job ? parseInt(job.id.replace(/\D/g, ""), 10) || 0 : 0;
  const prompt = promptText(meta.prompt, job?.command ?? "未命名图片");
  const promptTitle = promptSummary(
    meta.prompt,
    72,
    job?.command ?? "未命名图片",
  );
  const promptCount = promptLength(meta.prompt);
  const outputPaths = job ? api.jobOutputPaths(job) : [];
  const planned = job ? readPlannedCount(job) : 1;
  const doneCount = outputPaths.length;
  const previewPath = job
    ? (api.jobOutputPath(job, selectedOutput) ??
      outputPaths[0] ??
      job.output_path)
    : undefined;
  const previewUrl = previewPath ? api.fileUrl(previewPath) : "";
  const selectedUploads = job ? outputUploadsFor(job, selectedOutput) : [];

  useEffect(() => {
    setImageFailed(false);
    if (!controlled) setInternalIndex(0);
  }, [job?.id, controlled]);

  useEffect(() => {
    setImageFailed(false);
  }, [previewUrl]);

  if (!job)
    return (
      <Empty
        icon="history"
        title="选择一条记录"
        subtitle="点击左侧任意作品，查看图片和保存操作。"
      />
    );

  const selectedLabel = String.fromCharCode(65 + selectedOutput);
  const canSave = job.status === "completed" && Boolean(previewPath);
  const canCancel = isActiveJobStatus(job.status);
  const copy = runtimeCopy();

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-[18px] py-3.5 border-b border-border-faint flex items-start gap-2.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            <Badge tone={badgeTone(job.status)} size="sm">
              <StatusDot status={job.status} />
              {statusLabel(job.status)}
            </Badge>
            {planned > 1 && (
              <span className="t-small">
                {job.status === "completed" || doneCount >= planned
                  ? `${planned} 张图片`
                  : `已完成 ${doneCount}/${planned}`}
              </span>
            )}
            {planned > 1 && (
              <Badge tone="accent" size="sm">
                候选 {selectedLabel}
              </Badge>
            )}
          </div>
          <div
            className="t-h3 line-clamp-2 break-anywhere leading-snug"
            title={prompt}
          >
            {promptTitle}
          </div>
        </div>
        <Button variant="ghost" size="iconSm" icon="x" onClick={onClose} />
      </div>

      <div className="flex-1 overflow-auto p-[18px]">
        <div className="aspect-square rounded-[10px] overflow-hidden border border-border mb-3 bg-sunken">
          {previewUrl && !imageFailed ? (
            <img
              src={previewUrl}
              alt={`生成图片预览 · 候选 ${selectedLabel}`}
              decoding="async"
              className="w-full h-full object-cover"
              onError={() => setImageFailed(true)}
            />
          ) : doneCount >= 1 || job.status === "completed" ? (
            <PlaceholderImage seed={seed + selectedOutput} />
          ) : job.status === "failed" || job.status === "cancelled" ? (
            <div className="flex h-full w-full items-center justify-center text-faint">
              <Icon name="warn" size={24} aria-hidden="true" />
            </div>
          ) : (
            <div
              aria-hidden="true"
              className="h-full w-full animate-shimmer"
              style={SHIMMER_STYLE}
            />
          )}
        </div>

        {planned > 1 && (
          <div className="mb-3.5 flex flex-wrap gap-1.5">
            {Array.from({ length: planned }).map((_, index) => {
              const path = api.jobOutputPath(job, index);
              const url = path ? api.fileUrl(path) : "";
              const label = String.fromCharCode(65 + index);
              const isSelected = index === selectedOutput;
              const disabled = !path;
              return (
                <button
                  key={index}
                  type="button"
                  onClick={() => {
                    if (!disabled) setSelectedOutput(index);
                  }}
                  disabled={disabled}
                  aria-pressed={isSelected}
                  aria-label={
                    disabled ? `候选 ${label} · 等待生成` : `候选 ${label}`
                  }
                  title={
                    disabled ? `候选 ${label} · 等待生成` : `候选 ${label}`
                  }
                  className={cn(
                    "relative h-12 w-12 shrink-0 overflow-hidden rounded-md border bg-raised transition-colors focus-visible:outline-none",
                    isSelected
                      ? "border-accent ring-2 ring-[color:var(--accent-faint)]"
                      : disabled
                        ? "cursor-default border-border-faint"
                        : "cursor-pointer border-border hover:border-border-strong",
                  )}
                >
                  {url ? (
                    <img
                      src={url}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div
                      aria-hidden="true"
                      className="h-full w-full animate-shimmer"
                      style={SHIMMER_STYLE}
                    />
                  )}
                  <span className="pointer-events-none absolute bottom-0 left-0 right-0 bg-[color:var(--n-900)]/70 px-1 py-0.5 text-center text-[9.5px] font-semibold text-foreground">
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div
          className="grid mb-4 gap-y-2"
          style={{ gridTemplateColumns: "100px 1fr" }}
        >
          <span className="t-tiny pt-0.5">凭证</span>
          <span className="text-[12px]">{job.provider}</span>
          {typeof meta.size === "string" && (
            <>
              <span className="t-tiny pt-0.5">尺寸</span>
              <span className="t-mono text-[12px]">{meta.size}</span>
            </>
          )}
          {typeof meta.format === "string" && (
            <>
              <span className="t-tiny pt-0.5">格式</span>
              <span className="t-mono text-[12px]">{meta.format}</span>
            </>
          )}
          {typeof meta.quality === "string" && (
            <>
              <span className="t-tiny pt-0.5">质量</span>
              <span className="text-[12px]">{meta.quality as string}</span>
            </>
          )}
          {typeof meta.duration_ms === "number" && (
            <>
              <span className="t-tiny pt-0.5">耗时</span>
              <span className="t-mono text-[12px]">
                {formatDuration(meta.duration_ms as number)}
              </span>
            </>
          )}
          <span className="t-tiny pt-0.5">创建时间</span>
          <span className="text-[12px]">{formatTime(job.created_at)}</span>
        </div>

        {job.status === "completed" && previewPath && (
          <div className="px-2.5 py-2 mb-3.5 bg-sunken border border-border rounded-md flex items-center gap-2">
            <Icon
              name="folder"
              size={13}
              style={{ color: "var(--text-faint)" }}
            />
            <span className="text-[12px] flex-1 truncate">
              {resultLocationText(selectedLabel)}
            </span>
            {api.canRevealFiles && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  icon="folder"
                  onClick={() => revealPath(previewPath)}
                >
                  打开
                </Button>
                <Button
                  variant="ghost"
                  size="iconSm"
                  icon="copy"
                  onClick={() => copyText(previewPath, "图片位置")}
                  title="复制图片位置"
                />
              </>
            )}
          </div>
        )}

        {job.status === "completed" && (
          <section className="mb-3.5 rounded-md border border-border bg-sunken px-3 py-2.5">
            <div className="mb-2 flex items-center gap-2">
              <div className="text-[12px] font-semibold">存储投递</div>
              <span className="t-tiny ml-auto">
                {storageStatusLabel(job.storage_status)}
              </span>
            </div>
            {selectedUploads.length > 0 ? (
              <div className="space-y-1.5">
                {selectedUploads.map((upload) => (
                  <div
                    key={`${upload.target}:${upload.updated_at ?? upload.status}`}
                    className="rounded bg-raised px-2.5 py-2 text-[11.5px]"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{upload.target}</span>
                      <span className="t-caps">{upload.target_type}</span>
                      <span
                        className={cn(
                          "ml-auto text-[11px] font-semibold",
                          uploadStatusTone(upload.status),
                        )}
                      >
                        {upload.status}
                      </span>
                    </div>
                    {upload.url && (
                      <div className="mt-1 flex items-center gap-1.5">
                        <a
                          href={upload.url}
                          target="_blank"
                          rel="noreferrer"
                          className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-accent"
                          title={upload.url}
                        >
                          {upload.url}
                        </a>
                        <Button
                          variant="ghost"
                          size="iconSm"
                          icon="copy"
                          onClick={() => copyText(upload.url ?? "", "上传 URL")}
                          title="复制上传 URL"
                          aria-label="复制上传 URL"
                        />
                      </div>
                    )}
                    {upload.error && (
                      <div className="mt-1 break-anywhere text-[11px] text-status-err">
                        {upload.error}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[11.5px] text-muted">
                当前候选还没有上传记录。
              </div>
            )}
          </section>
        )}

        {job.status === "failed" && job.error && (
          <div className="px-3 py-2.5 mb-3.5 bg-status-err-bg text-status-err border border-status-err rounded-md text-[12px] flex items-start gap-2">
            <Icon name="warn" size={13} style={{ marginTop: 1 }} />
            <div>
              <div className="font-semibold mb-0.5">错误</div>
              <div>
                {(job.error as Record<string, unknown>).message as string}
              </div>
            </div>
          </div>
        )}

        <section className="mb-3.5 rounded-md border border-border bg-sunken px-3 py-2.5">
          <div className="mb-2 flex items-center gap-2">
            <div className="text-[12px] font-semibold">提示词</div>
            {promptCount > 0 && (
              <span className="t-tiny ml-auto">{promptCount} 字</span>
            )}
            <Button
              variant="ghost"
              size="iconSm"
              icon="copy"
              onClick={() => copyText(prompt, "提示词")}
              title="复制提示词"
              aria-label="复制提示词"
            />
          </div>
          <div className="max-h-44 overflow-auto whitespace-pre-wrap break-anywhere rounded bg-raised px-2.5 py-2 text-[12px] leading-[1.55] text-muted">
            {prompt}
          </div>
        </section>

        <details className="rounded-md border border-border bg-sunken px-3 py-2 text-[12px]">
          <summary className="cursor-pointer select-none font-semibold">
            高级信息
          </summary>
          <div
            className="mt-2 grid gap-y-1.5"
            style={{ gridTemplateColumns: "86px 1fr" }}
          >
            <span className="t-tiny">任务 ID</span>
            <span className="t-mono text-[11px] truncate">{job.id}</span>
            <span className="t-tiny">命令</span>
            <span className="t-mono text-[11px]">{job.command}</span>
          </div>
          <pre className="mt-2 mb-0 max-h-52 overflow-auto rounded bg-raised p-2 font-mono text-[10.5px] leading-[1.45] text-muted">
            {JSON.stringify(job, null, 2)}
          </pre>
        </details>
      </div>

      <div className="px-[18px] py-3 border-t border-border-faint flex flex-col gap-1.5">
        {canCancel ? (
          <Button
            variant="secondary"
            icon="x"
            className="w-full justify-center"
            onClick={() => onCancel?.(job.id)}
          >
            取消任务
          </Button>
        ) : (
          <Button
            variant="secondary"
            icon="download"
            className="w-full justify-center"
            onClick={() => saveImages([previewPath], "图片")}
            disabled={!canSave}
          >
            {planned > 1
              ? `${copy.actionVerb}候选 ${selectedLabel}`
              : copy.saveImageLabel}
          </Button>
        )}
        <div className="flex gap-1.5">
          {outputPaths.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              icon="download"
              className="flex-1 justify-center"
              onClick={() => saveJobImages(job.id, "任务图片")}
            >
              {copy.saveJobLabel}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            icon="copy"
            className="flex-1 justify-center"
            onClick={() => copyText(prompt, "提示词")}
          >
            复制提示词
          </Button>
          {job.status === "completed" && previewPath && (
            <Button
              variant="ghost"
              size="iconSm"
              icon="external"
              onClick={() => openPath(previewPath)}
              title={api.canUseLocalFiles ? "在系统查看器中打开" : "打开图片"}
              aria-label={api.canUseLocalFiles ? "在系统查看器中打开" : "打开图片"}
            />
          )}
          {onDelete && (
            <Button
              variant="ghost"
              size="iconSm"
              icon="trash"
              onClick={() => onDelete(job.id)}
              title="删除任务"
              aria-label="删除任务"
            />
          )}
        </div>
      </div>
    </div>
  );
}
