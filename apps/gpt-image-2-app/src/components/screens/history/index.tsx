import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  CheckCircle2,
  ChevronDown,
  Clock,
  Folder,
  Loader2,
  Trash2,
  X,
} from "lucide-react";
import { useCancelJob, useDeleteJob, useJobs } from "@/hooks/use-jobs";
import { OPEN_JOB_EVENT } from "@/lib/job-navigation";
import { revealPath, saveImages } from "@/lib/user-actions";
import { formatTime } from "@/lib/format";
import {
  jobOutputCount,
  jobOutputIndexes,
  jobOutputPath,
  jobOutputUrl,
} from "@/lib/job-outputs";
import { Empty } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { RevealImage } from "@/components/ui/reveal-image";
import SpotlightCard from "@/components/reactbits/components/SpotlightCard";
import { useConfirm } from "@/hooks/use-confirm";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import type { Job, JobStatus } from "@/lib/types";
import { cn } from "@/lib/cn";
import { PlaceholderImage } from "@/components/screens/shared/placeholder-image";
import { JobImageDetailDrawer } from "./job-image-detail-drawer";

type FilterValue = "all" | "running" | "completed" | "failed";

const FILTERS: { value: FilterValue; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "running", label: "进行中" },
  { value: "completed", label: "已完成" },
  { value: "failed", label: "失败" },
];

function jobThumbUrl(job: Job): string | null {
  const index = jobOutputIndexes(job)[0];
  return index === undefined ? null : jobOutputUrl(job, index);
}

function jobThumbPath(job: Job): string | null {
  const index = jobOutputIndexes(job)[0];
  return index === undefined ? null : jobOutputPath(job, index);
}

function jobRatio(job: Job): string {
  const md = (job.metadata ?? {}) as Record<string, unknown>;
  const size = (md.size as string | undefined) ?? "";
  if (!size) return "";
  const m = size.match(/^(\d+)x(\d+)$/i);
  if (!m) return size;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (w === h) return "1:1";
  const r = w / h;
  const candidates: { ratio: number; label: string }[] = [
    { ratio: 16 / 9, label: "16:9" },
    { ratio: 9 / 16, label: "9:16" },
    { ratio: 4 / 3, label: "4:3" },
    { ratio: 3 / 4, label: "3:4" },
    { ratio: 3 / 2, label: "3:2" },
    { ratio: 2 / 3, label: "2:3" },
    { ratio: 21 / 9, label: "21:9" },
    { ratio: 9 / 21, label: "9:21" },
  ];
  for (const c of candidates) {
    if (Math.abs(r - c.ratio) / c.ratio < 0.06) return c.label;
  }
  return size;
}

function jobPrompt(job: Job): string {
  const md = (job.metadata ?? {}) as Record<string, unknown>;
  const p = md.prompt as string | undefined;
  return p?.trim() || "（无提示词）";
}

function totalBytes(job: Job): string {
  const total = (job.outputs ?? []).reduce((acc, o) => acc + (o.bytes ?? 0), 0);
  if (total === 0) return "";
  if (total > 1024 * 1024) return `${(total / 1024 / 1024).toFixed(1)} MB`;
  return `${(total / 1024).toFixed(1)} KB`;
}

function StatusChip({ status }: { status: JobStatus }) {
  if (status === "completed") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] text-[color:var(--status-ok)]">
        <CheckCircle2 size={13} />
        已完成
      </span>
    );
  }
  if (status === "running") {
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

function JobPreviewImage({
  url,
  seed,
  variant,
  imageClassName = "h-full w-full object-cover",
  placeholderClassName = "h-full w-full",
}: {
  url: string | null;
  seed: number;
  variant: string;
  imageClassName?: string;
  placeholderClassName?: string;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [url]);

  if (url && !failed) {
    return (
      <RevealImage
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        className={imageClassName}
        draggable={false}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className={placeholderClassName}>
      <PlaceholderImage seed={seed} variant={variant} />
    </div>
  );
}

function JobRowExpandable({
  index,
  job,
  expanded,
  onToggleExpand,
  onCancel,
  onDelete,
  onOpenDetail,
}: {
  index: number;
  job: Job;
  expanded: boolean;
  onToggleExpand: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onOpenDetail: (outputIndex: number) => void;
}) {
  const confirm = useConfirm();
  const reducedMotion = useReducedMotion();
  const thumbUrl = jobThumbUrl(job);
  const thumbPath = jobThumbPath(job);
  const ratio = jobRatio(job);
  const prompt = jobPrompt(job);
  const status = job.status;
  const showCancel = status === "running" || status === "queued";
  const isQueueing = status === "queued";
  const isRunning = status === "running";
  const outputIndexes = jobOutputIndexes(job);
  const outputCount = outputIndexes.length;
  const extraCount = Math.max(0, outputCount - 1);

  const saveAll = () => {
    const paths = outputIndexes
      .map((index) => jobOutputPath(job, index))
      .filter((p): p is string => Boolean(p));
    if (paths.length > 0) void saveImages(paths, "图片");
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
              reducedMotion
                ? false
                : { opacity: 0, gridTemplateRows: "0fr" }
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
                    style={{
                      "--history-output-cols": Math.min(outputCount, 4),
                    } as CSSProperties}
                  >
                    {outputIndexes.map((outputIndex, i) => {
                      const url = jobOutputUrl(job, outputIndex);
                      const letter = String.fromCharCode(65 + i);
                      return (
                        <button
                          key={outputIndex}
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
                          saveAll();
                        }}
                      >
                        {outputCount > 1 ? "保存全部" : "保存"}
                      </Button>
                      {thumbPath && (
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
                  <div className="flex-1" />
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="trash"
                    onClick={async (e) => {
                      e.stopPropagation();
                      const summary =
                        prompt.length > 60
                          ? `${prompt.slice(0, 60)}…`
                          : prompt;
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

export function HistoryScreen({
  onSwitchToGenerate,
}: {
  onSwitchToGenerate?: () => void;
} = {}) {
  const { data: jobs = [], isLoading } = useJobs();
  const deleteJob = useDeleteJob();
  const cancelJob = useCancelJob();
  const confirm = useConfirm();
  const [filter, setFilter] = useState<FilterValue>("all");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [detailJobId, setDetailJobId] = useState<string | null>(null);
  const [detailIndex, setDetailIndex] = useState(0);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    const onOpenJob = (event: Event) => {
      const detail = (event as CustomEvent<{ jobId?: string }>).detail;
      if (!detail?.jobId) return;
      // Only open the detail drawer — do NOT auto-expand the row in
      // the underlying list. Auto-expansion duplicates the image at
      // ~600px width in the main area, which leaks through the drawer
      // backdrop and makes the screen feel redundant. User can still
      // expand the row manually after closing the drawer.
      setDetailJobId(detail.jobId);
      setDetailIndex(0);
    };
    window.addEventListener(OPEN_JOB_EVENT, onOpenJob);
    return () => window.removeEventListener(OPEN_JOB_EVENT, onOpenJob);
  }, []);

  const filtered = useMemo(() => {
    return jobs.filter((j) => {
      if (filter === "running")
        return j.status === "running" || j.status === "queued";
      if (filter === "completed") return j.status === "completed";
      if (filter === "failed")
        return j.status === "failed" || j.status === "cancelled";
      return true;
    });
  }, [jobs, filter]);

  const total = jobs.length;
  const filteredCount = filtered.length;

  const clearable =
    jobs.filter((j) => j.status === "completed" || j.status === "failed")
      .length > 0;

  const handleClearFinished = async () => {
    if (!clearable) return;
    const finished = jobs.filter(
      (j) => j.status === "completed" || j.status === "failed",
    );
    const ok = await confirm({
      title: "清理任务记录",
      description: (
        <>
          将清除{" "}
          <span className="text-foreground font-medium">
            {finished.length} 条
          </span>{" "}
          已完成 / 已失败的任务。图片文件不会被删除,此操作不可撤销。
        </>
      ),
      confirmText: "清理",
      variant: "danger",
    });
    if (!ok) return;
    finished.forEach((j) => deleteJob.mutate(j.id));
  };

  const detailJob = detailJobId
    ? (jobs.find((j) => j.id === detailJobId) ?? null)
    : null;

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden px-4 pb-4 pt-3 sm:px-8 sm:pb-6">
      {/* header */}
      <header className="mb-4 flex items-end justify-between gap-3 sm:mb-5">
        <div className="flex items-baseline gap-3">
          <h1 className="t-screen-title text-foreground">生成队列</h1>
          <span
            className="inline-flex items-center justify-center min-w-[26px] h-[22px] px-2 rounded-full text-[12px] font-medium text-foreground"
            style={{
              background: "var(--w-08)",
              border: "1px solid var(--w-10)",
            }}
            aria-label="任务总数"
          >
            {total}
          </span>
        </div>
        <button
          type="button"
          onClick={handleClearFinished}
          disabled={!clearable}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12px] text-muted hover:text-foreground hover:bg-[color:var(--w-06)] transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
          style={{
            background: "var(--w-04)",
            border: "1px solid var(--w-08)",
          }}
        >
          <Trash2 size={13} />
          清理
        </button>
      </header>

      {/* filters */}
      <div className="mb-4 flex items-center gap-1 overflow-x-auto scrollbar-none">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={cn(
              "px-3.5 h-8 rounded-full text-[12.5px] font-medium transition-colors",
              filter === f.value
                ? "bg-[color:var(--accent-14)] text-foreground border border-[color:var(--accent-30)]"
                : "border border-transparent text-muted hover:text-foreground hover:bg-[color:var(--w-04)]",
            )}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-faint font-mono">
          {filteredCount} / {total}
        </span>
      </div>

      {/* list */}
      <section className="surface-panel flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-auto divide-y divide-[color:var(--w-06)]">
          {isLoading ? (
            <div className="p-12 flex justify-center">
              <Empty
                icon="history"
                title="加载中"
                subtitle="正在获取任务列表"
              />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 flex justify-center">
              <Empty
                icon="search"
                title={total === 0 ? "还没有任务" : "无匹配结果"}
                subtitle={
                  total === 0
                    ? "在「生成」里写一句提示词，任务会出现在这里。"
                    : "切换筛选标签或清除条件再试。"
                }
              />
            </div>
          ) : (
            filtered.map((j, i) => (
              <JobRowExpandable
                key={j.id}
                index={i + 1}
                job={j}
                expanded={expandedIds.has(j.id)}
                onToggleExpand={() => toggleExpand(j.id)}
                onCancel={() => cancelJob.mutate(j.id)}
                onDelete={() => {
                  deleteJob.mutate(j.id);
                  setExpandedIds((prev) => {
                    const next = new Set(prev);
                    next.delete(j.id);
                    return next;
                  });
                  if (detailJobId === j.id) {
                    setDetailJobId(null);
                  }
                }}
                onOpenDetail={(outputIndex) => {
                  setDetailJobId(j.id);
                  setDetailIndex(outputIndex);
                }}
              />
            ))
          )}
        </div>

        <footer className="hidden items-center gap-2 border-t border-border-faint px-4 py-2.5 text-[11.5px] text-faint sm:flex">
          <Folder size={11} className="opacity-70" />
          <span>
            点击行展开查看作品组；点单张图打开右侧详情。任务在后台依次处理。
          </span>
        </footer>
      </section>

      {/* Image detail drawer */}
      <JobImageDetailDrawer
        job={detailJob}
        outputIndex={detailIndex}
        onClose={() => setDetailJobId(null)}
        onChangeIndex={setDetailIndex}
        onDelete={(jobId) => {
          deleteJob.mutate(jobId);
          setExpandedIds((prev) => {
            const next = new Set(prev);
            next.delete(jobId);
            return next;
          });
        }}
        onRerun={onSwitchToGenerate}
      />
    </div>
  );
}
