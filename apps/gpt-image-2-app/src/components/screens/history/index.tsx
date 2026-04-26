import { useEffect, useMemo, useState } from "react";
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
import { api } from "@/lib/api";
import { revealPath, saveImages } from "@/lib/user-actions";
import { Empty } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import SpotlightCard from "@/components/reactbits/components/SpotlightCard";
import type { Job, JobStatus } from "@/lib/types";
import { cn } from "@/lib/cn";
import { JobImageDetailDrawer } from "./job-image-detail-drawer";

type FilterValue = "all" | "running" | "completed" | "failed";

const FILTERS: { value: FilterValue; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "running", label: "进行中" },
  { value: "completed", label: "已完成" },
  { value: "failed", label: "失败" },
];

function jobThumbUrl(job: Job): string | null {
  if (!job.outputs || job.outputs.length === 0) return null;
  return api.outputUrl(job.id, 0) ?? null;
}

function jobThumbPath(job: Job): string | null {
  if (!job.outputs || job.outputs.length === 0) return null;
  return api.outputPath(job.id, 0) ?? null;
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
  const total = (job.outputs ?? []).reduce(
    (acc, o) => acc + (o.bytes ?? 0),
    0,
  );
  if (total === 0) return "";
  if (total > 1024 * 1024) return `${(total / 1024 / 1024).toFixed(1)} MB`;
  return `${(total / 1024).toFixed(1)} KB`;
}

function formatTime(s: string): string {
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return s;
  }
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
  const thumbUrl = jobThumbUrl(job);
  const thumbPath = jobThumbPath(job);
  const ratio = jobRatio(job);
  const prompt = jobPrompt(job);
  const status = job.status;
  const showCancel = status === "running" || status === "queued";
  const isQueueing = status === "queued";
  const isRunning = status === "running";
  const outputCount = job.outputs?.length ?? 0;
  const extraCount = Math.max(0, outputCount - 1);

  const saveAll = () => {
    if (!job.outputs || job.outputs.length === 0) return;
    const paths = job.outputs
      .map((_, i) => api.outputPath(job.id, i))
      .filter((p): p is string => Boolean(p));
    if (paths.length > 0) void saveImages(paths, "图片");
  };

  return (
    <div
      className={cn(
        "transition-colors",
        expanded ? "bg-[rgba(167,139,250,0.06)]" : "",
      )}
    >
      {/* COMPACT ROW (always visible) */}
      <button
        type="button"
        onClick={onToggleExpand}
        className={cn(
          "flex w-full items-center gap-4 px-4 py-3 text-left transition-colors",
          expanded
            ? "bg-[rgba(167,139,250,0.08)]"
            : "hover:bg-[rgba(255,255,255,0.04)]",
        )}
        aria-expanded={expanded}
      >
        <span className="w-6 text-center text-[12px] text-faint font-mono shrink-0">
          {index}
        </span>

        <div className="relative h-14 w-20 shrink-0 rounded-md overflow-hidden ring-1 ring-white/[.10]">
          {thumbUrl ? (
            <img
              src={thumbUrl}
              alt=""
              className="h-full w-full object-cover"
              draggable={false}
            />
          ) : (
            <div
              className="h-full w-full"
              style={{
                background:
                  "radial-gradient(120% 80% at 30% 30%, rgba(167,139,250,0.5), transparent 60%), radial-gradient(120% 80% at 70% 70%, rgba(103,232,249,0.4), transparent 60%), linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
              }}
            />
          )}
          {(isRunning || isQueueing) && (
            <div className="absolute inset-0 backdrop-blur-[2px] bg-black/40 flex items-center justify-center">
              {isRunning ? (
                <Loader2
                  size={18}
                  className="text-white animate-spin opacity-80"
                />
              ) : (
                <Clock size={16} className="text-white opacity-70" />
              )}
            </div>
          )}
          {/* +N badge for grouped outputs */}
          {extraCount > 0 && (
            <span
              className="absolute right-1 top-1 inline-flex items-center px-1.5 py-px rounded-md text-[9.5px] font-mono font-semibold leading-none"
              style={{
                background: "rgba(0,0,0,0.65)",
                color: "white",
                backdropFilter: "blur(4px)",
                WebkitBackdropFilter: "blur(4px)",
                border: "1px solid rgba(255,255,255,0.12)",
              }}
              aria-label={`这个任务共有 ${outputCount} 张图`}
              title={`共 ${outputCount} 张`}
            >
              +{extraCount}
            </span>
          )}
        </div>

        <div className="flex-1 min-w-0">
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
        </div>

        <div className="w-[120px] shrink-0">
          <StatusChip status={status} />
        </div>

        <div className="w-[140px] shrink-0 text-right">
          <div className="text-[11.5px] text-muted font-mono">
            {formatTime(job.updated_at || job.created_at)}
          </div>
          {totalBytes(job) && (
            <div className="text-[11px] text-faint font-mono mt-0.5">
              {totalBytes(job)}
            </div>
          )}
        </div>

        <div className="flex items-center gap-0.5">
          {showCancel && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onCancel();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onCancel();
                }
              }}
              className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted hover:text-foreground hover:bg-white/[.06] transition-colors cursor-pointer"
              aria-label="取消任务"
              title="取消任务"
            >
              <X size={14} />
            </span>
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
      </button>

      {/* EXPANDED CONTENT */}
      {expanded && (
        <div
          className="px-4 pb-4 pt-1"
          style={{
            paddingLeft: "calc(16px + 24px + 16px + 80px)",
          }}
        >
          {/* full prompt */}
          <div className="mb-3 text-[12.5px] leading-relaxed text-muted whitespace-pre-wrap break-words pr-4">
            {prompt}
          </div>

          {/* output grid */}
          {outputCount > 0 ? (
            <div
              className="grid gap-2"
              style={{
                gridTemplateColumns: `repeat(${Math.min(outputCount, 4)}, minmax(0, 1fr))`,
              }}
            >
              {job.outputs!.map((_, i) => {
                const url = api.outputUrl(job.id, i);
                const letter = String.fromCharCode(65 + i);
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenDetail(i);
                    }}
                    className="group relative aspect-square w-full rounded-lg overflow-hidden ring-1 ring-white/[.08] hover:ring-[rgba(167,139,250,0.45)] transition-all hover:scale-[1.015]"
                    title={`查看第 ${letter} 张`}
                    aria-label={`查看第 ${letter} 张`}
                  >
                    <SpotlightCard
                      spotlightColor="rgba(167,139,250,0.32)"
                      className="!rounded-lg !p-0 !bg-transparent !border-0 !w-full !h-full absolute inset-0"
                    >
                      {url ? (
                        <img
                          src={url}
                          alt=""
                          className="absolute inset-0 h-full w-full object-cover"
                          draggable={false}
                        />
                      ) : (
                        <div className="absolute inset-0 bg-[rgba(255,255,255,0.04)]" />
                      )}
                      <span
                        className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded text-[10.5px] font-mono font-semibold text-white"
                        style={{
                          background: "rgba(0,0,0,0.55)",
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
          <div className="mt-3 flex items-center gap-2">
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
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm("删除这条任务记录？图片文件不会被删除。")) {
                  onDelete();
                }
              }}
            >
              删除
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function HistoryScreen() {
  const { data: jobs = [], isLoading } = useJobs();
  const deleteJob = useDeleteJob();
  const cancelJob = useCancelJob();
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
      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.add(detail.jobId!);
        return next;
      });
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

  const handleClearFinished = () => {
    if (!clearable) return;
    if (!window.confirm("清理所有已完成 / 已失败的任务记录？此操作不可撤销。"))
      return;
    jobs
      .filter((j) => j.status === "completed" || j.status === "failed")
      .forEach((j) => deleteJob.mutate(j.id));
  };

  const detailJob = detailJobId
    ? (jobs.find((j) => j.id === detailJobId) ?? null)
    : null;

  return (
    <div className="relative h-full w-full overflow-hidden flex flex-col px-8 pb-6 pt-3">
      {/* header */}
      <header className="flex items-end justify-between mb-5">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
            生成队列
          </h1>
          <span
            className="inline-flex items-center justify-center min-w-[26px] h-[22px] px-2 rounded-full text-[12px] font-medium text-foreground"
            style={{
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.10)",
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
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12px] text-muted hover:text-foreground hover:bg-white/[.06] transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <Trash2 size={13} />
          清理
        </button>
      </header>

      {/* filters */}
      <div className="flex items-center gap-1 mb-4">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={cn(
              "px-3.5 h-8 rounded-full text-[12.5px] font-medium transition-colors",
              filter === f.value
                ? "bg-white/[.10] text-foreground border border-white/[.12]"
                : "border border-transparent text-muted hover:text-foreground hover:bg-white/[.04]",
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
        <div className="flex-1 overflow-auto divide-y divide-white/[.06]">
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

        <footer className="flex items-center gap-2 px-4 py-2.5 border-t border-border-faint text-[11.5px] text-faint">
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
      />
    </div>
  );
}
