import { type CSSProperties } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Clock, Loader2, X } from "lucide-react";
import SpotlightCard from "@/components/reactbits/components/SpotlightCard";
import { Button } from "@/components/ui/button";
import { ImageContextMenu } from "@/components/ui/image-context-menu";
import { useConfirm } from "@/hooks/use-confirm";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { imageAssetFromOutput } from "@/lib/image-actions/asset";
import { isActiveJobStatus } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/format";
import {
  jobOutputIndexes,
  jobOutputPath,
  jobOutputUrl,
} from "@/lib/job-outputs";
import { isDesktopRuntime, runtimeCopy } from "@/lib/runtime-copy";
import { revealPath, saveImages, saveJobImages } from "@/lib/user-actions";
import type { Job } from "@/lib/types";
import { JobPreviewImage } from "./job-preview-image";
import { StatusChip } from "./status-chip";
import {
  jobPrompt,
  jobRatio,
  jobThumbPath,
  jobThumbUrl,
  totalBytes,
} from "./shared";

export function JobRowExpandable({
  index,
  job,
  expanded,
  onToggleExpand,
  onCancel,
  onDelete,
  onOpenDetail,
  onRetry,
}: {
  index: number;
  job: Job;
  expanded: boolean;
  onToggleExpand: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onOpenDetail: (outputIndex: number) => void;
  onRetry: () => void;
}) {
  const confirm = useConfirm();
  const reducedMotion = useReducedMotion();
  const thumbUrl = jobThumbUrl(job);
  const thumbPath = jobThumbPath(job);
  const ratio = jobRatio(job);
  const prompt = jobPrompt(job);
  const status = job.status;
  const showCancel = isActiveJobStatus(status);
  const showRetry = status === "failed" || status === "cancelled";
  const isQueueing = status === "queued";
  const isRunning = status === "running" || status === "uploading";
  const outputIndexes = jobOutputIndexes(job);
  const outputCount = outputIndexes.length;
  const extraCount = Math.max(0, outputCount - 1);
  const copy = runtimeCopy();

  const saveResult = () => {
    if (outputCount > 1) {
      void saveJobImages(job.id, "任务图片");
      return;
    }
    void saveImages([thumbPath], "图片");
  };

  return (
    <div
      className={cn(
        "transition-colors",
        expanded ? "bg-[color:var(--accent-06)]" : "",
      )}
    >
      {/* COMPACT ROW (always visible) — div role=button so we can nest a real
          <button> for cancel without violating HTML's "no button-in-button" rule.
          `group relative` + the inset accent bar give the layered hover affordance. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggleExpand}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggleExpand();
          }
        }}
        className={cn(
          "group relative grid w-full grid-cols-[80px_minmax(0,1fr)_auto] gap-x-3 gap-y-2 px-3 py-3 text-left transition-colors cursor-pointer sm:flex sm:items-center sm:gap-4 sm:px-4",
          "focus-visible:outline-none focus-visible:bg-[color:var(--w-04)]",
          expanded
            ? "bg-[color:var(--accent-08)]"
            : "hover:bg-[color:var(--w-04)]",
        )}
        aria-expanded={expanded}
      >
        {/* left accent bar — grows on hover/expand for a quiet "you're here" cue */}
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute left-0 top-1.5 bottom-1.5 rounded-r-sm",
            "bg-[color:var(--accent)] transition-all duration-200 ease-out",
            expanded
              ? "w-[3px] opacity-100"
              : "w-0 opacity-0 group-hover:w-[2px] group-hover:opacity-70",
          )}
        />
        <span className="hidden w-6 shrink-0 text-center font-mono text-[12px] text-faint sm:inline-block">
          {index}
        </span>

        <div className="relative h-14 w-20 shrink-0 rounded-md overflow-hidden ring-1 ring-[color:var(--w-10)] transition-transform duration-200 ease-out group-hover:scale-[1.02]">
          <JobPreviewImage
            url={thumbUrl}
            seed={index * 17 + outputCount}
            variant={`history-thumb-${job.id}`}
          />
          {(isRunning || isQueueing) && (
            <div className="absolute inset-0 backdrop-blur-[2px] bg-[color:var(--k-40)] flex items-center justify-center">
              {isRunning ? (
                <Loader2
                  size={18}
                  className="text-foreground animate-spin opacity-80"
                />
              ) : (
                <Clock size={16} className="text-foreground opacity-70" />
              )}
            </div>
          )}
          {/* +N badge for grouped outputs */}
          {extraCount > 0 && (
            <span
              className="absolute right-1 top-1 inline-flex items-center px-1.5 py-px rounded-md text-[9.5px] font-mono font-semibold leading-none text-foreground"
              style={{
                background: "var(--k-65)",
                backdropFilter: "blur(4px)",
                WebkitBackdropFilter: "blur(4px)",
                border: "1px solid var(--w-12)",
              }}
              aria-label={`这个任务共有 ${outputCount} 张图`}
              title={`共 ${outputCount} 张`}
            >
              +{extraCount}
            </span>
          )}
        </div>

        <div className="min-w-0 self-center sm:flex-1">
          <div className="text-[13px] text-foreground truncate">{prompt}</div>
          <div className="text-[11px] text-faint mt-0.5 font-mono flex items-center gap-1.5">
            {ratio && <span>{ratio}</span>}
            {ratio && outputCount > 0 && <span aria-hidden>·</span>}
            {outputCount > 0 && <span>{outputCount} 张</span>}
            {job.command === "images edit" && (
              <>
                <span aria-hidden>·</span>
                <span>编辑</span>
              </>
            )}
            {job.command === "request create" && (
              <>
                <span aria-hidden>·</span>
                <span>请求</span>
              </>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 sm:hidden">
            <StatusChip status={status} />
            <span className="font-mono text-[11px] text-faint">
              {formatTime(job.updated_at || job.created_at)}
            </span>
            {totalBytes(job) && (
              <span className="font-mono text-[11px] text-faint">
                {totalBytes(job)}
              </span>
            )}
          </div>
        </div>

        <div className="hidden w-[120px] shrink-0 sm:block">
          <StatusChip status={status} />
        </div>

        <div className="hidden w-[140px] shrink-0 text-right sm:block">
          <div className="text-[11.5px] text-muted font-mono">
            {formatTime(job.updated_at || job.created_at)}
          </div>
          {totalBytes(job) && (
            <div className="text-[11px] text-faint font-mono mt-0.5">
              {totalBytes(job)}
            </div>
          )}
        </div>

        <div className="flex items-center gap-0.5 self-center">
          {showCancel && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCancel();
              }}
              className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted hover:text-foreground hover:bg-[color:var(--w-06)] transition-colors cursor-pointer"
              aria-label="取消任务"
              title="取消任务"
            >
              <X size={14} />
            </button>
          )}
          {showRetry && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRetry();
              }}
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11.5px] font-semibold text-foreground transition-colors hover:bg-[color:var(--accent-12)]"
              aria-label="重试任务"
              title="原样重试"
            >
              <Loader2 size={12} className="hidden" />
              重试
            </button>
          )}
          <ChevronDown
            size={14}
            aria-hidden
            className={cn(
              "text-faint transition-transform shrink-0 ml-1",
              expanded && "rotate-180",
            )}
          />
        </div>
      </div>

      {/* EXPANDED CONTENT */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="expanded"
            className="grid overflow-hidden"
            initial={
              reducedMotion ? false : { opacity: 0, gridTemplateRows: "0fr" }
            }
            animate={{ opacity: 1, gridTemplateRows: "1fr" }}
            exit={{ opacity: 0, gridTemplateRows: "0fr" }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="min-h-0 overflow-hidden">
              <div className="px-3 pb-4 pt-1 sm:px-4 sm:pl-[calc(16px+24px+16px+80px)]">
                {/* full prompt */}
                <div className="mb-3 text-[12.5px] leading-relaxed text-muted whitespace-pre-wrap break-words pr-4">
                  {prompt}
                </div>

                {/* output grid */}
                {outputCount > 0 ? (
                  <div
                    className="grid grid-cols-2 gap-2 sm:[grid-template-columns:repeat(var(--history-output-cols),minmax(0,1fr))]"
                    style={
                      {
                        "--history-output-cols": Math.min(outputCount, 4),
                      } as CSSProperties
                    }
                  >
                    {outputIndexes.map((outputIndex, i) => {
                      const url = jobOutputUrl(job, outputIndex);
                      const path = jobOutputPath(job, outputIndex);
                      const letter = String.fromCharCode(65 + i);
                      const asset = imageAssetFromOutput({
                        jobId: job.id,
                        outputIndex,
                        src: url ?? "",
                        path: path ?? null,
                        prompt: prompt || undefined,
                        command: job.command,
                        job,
                      });
                      return (
                        <ImageContextMenu key={outputIndex} asset={asset}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenDetail(outputIndex);
                            }}
                            className="group relative aspect-square w-full rounded-lg overflow-hidden ring-1 ring-[color:var(--w-08)] hover:ring-[color:var(--accent-45)] transition-all hover:scale-[1.015]"
                            title={`查看第 ${letter} 张`}
                            aria-label={`查看第 ${letter} 张`}
                          >
                          <SpotlightCard
                            spotlightColor="rgba(var(--accent-rgb), 0.30)"
                            className="!rounded-lg !p-0 !bg-transparent !border-0 !w-full !h-full absolute inset-0"
                          >
                            <JobPreviewImage
                              url={url}
                              seed={index * 37 + outputIndex + i}
                              variant={`history-output-${job.id}-${outputIndex}`}
                              imageClassName="absolute inset-0 h-full w-full object-cover"
                              placeholderClassName="absolute inset-0"
                            />
                            <span
                              className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded text-[10.5px] font-mono font-semibold text-foreground"
                              style={{
                                background: "var(--k-55)",
                                backdropFilter: "blur(4px)",
                                WebkitBackdropFilter: "blur(4px)",
                              }}
                            >
                              {letter}
                            </span>
                          </SpotlightCard>
                          </button>
                        </ImageContextMenu>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-[12px] text-faint">
                    {isRunning || isQueueing
                      ? "图片生成完成后会显示在这里。"
                      : "这个任务没有输出。"}
                  </div>
                )}

                {/* row of actions */}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {outputCount > 0 && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon="download"
                        onClick={(e) => {
                          e.stopPropagation();
                          saveResult();
                        }}
                      >
                        {outputCount > 1 ? copy.saveJobLabel : copy.actionVerb}
                      </Button>
                      {thumbPath && isDesktopRuntime() && (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon="folder"
                          onClick={(e) => {
                            e.stopPropagation();
                            void revealPath(thumbPath);
                          }}
                        >
                          打开文件夹
                        </Button>
                      )}
                    </>
                  )}
                  {showRetry && (
                    <Button
                      variant="secondary"
                      size="sm"
                      icon="reload"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRetry();
                      }}
                    >
                      重试
                    </Button>
                  )}
                  <div className="flex-1" />
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="trash"
                    onClick={async (e) => {
                      e.stopPropagation();
                      const summary =
                        prompt.length > 60 ? `${prompt.slice(0, 60)}…` : prompt;
                      const ok = await confirm({
                        title: "删除任务记录",
                        description: (
                          <>
                            将删除任务{" "}
                            <span className="text-foreground font-medium">
                              「{summary}」
                            </span>
                            。图片文件不会被删除。
                          </>
                        ),
                        confirmText: "删除",
                        variant: "danger",
                      });
                      if (ok) onDelete();
                    }}
                  >
                    删除
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
