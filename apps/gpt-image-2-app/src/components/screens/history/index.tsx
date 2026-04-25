import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  MoreHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { useCancelJob, useDeleteJob, useJobs } from "@/hooks/use-jobs";
import { OPEN_JOB_EVENT } from "@/lib/job-navigation";
import { api } from "@/lib/api";
import { openPath, revealPath } from "@/lib/user-actions";
import { Empty } from "@/components/ui/empty";
import type { Job, JobStatus } from "@/lib/types";
import { cn } from "@/lib/cn";

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

function JobRowInline({
  index,
  job,
  selected,
  onSelect,
  onCancel,
  onDelete,
}: {
  index: number;
  job: Job;
  selected: boolean;
  onSelect: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const thumbUrl = jobThumbUrl(job);
  const thumbPath = jobThumbPath(job);
  const ratio = jobRatio(job);
  const prompt = jobPrompt(job);
  const status = job.status;
  const showCancel = status === "running" || status === "queued";
  const isQueueing = status === "queued";
  const isRunning = status === "running";
  const isCompleted = status === "completed";

  return (
    <div
      className={cn(
        "flex items-center gap-4 px-4 py-3 transition-colors cursor-pointer",
        selected
          ? "bg-[rgba(167,139,250,0.10)]"
          : "hover:bg-[rgba(255,255,255,0.04)]",
      )}
      onClick={onSelect}
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
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-foreground truncate">{prompt}</div>
        <div className="text-[11px] text-faint mt-0.5 font-mono">
          {ratio && <span>{ratio}</span>}
          {ratio && job.command !== "images generate" && <span> · </span>}
          {job.command === "images edit" && <span>编辑</span>}
          {job.command === "request create" && <span>请求</span>}
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
        {isCompleted && thumbPath ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void openPath(thumbPath);
            }}
            className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted hover:text-foreground hover:bg-white/[.06] transition-colors"
            aria-label="打开图片"
            title="打开图片"
          >
            <ExternalLink size={13} />
          </button>
        ) : showCancel ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
            className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted hover:text-foreground hover:bg-white/[.06] transition-colors"
            aria-label="取消任务"
            title="取消任务"
          >
            <X size={14} />
          </button>
        ) : null}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (thumbPath) {
              void revealPath(thumbPath);
            } else if (window.confirm("删除这条任务记录？")) {
              onDelete();
            }
          }}
          className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted hover:text-foreground hover:bg-white/[.06] transition-colors"
          aria-label="更多操作"
          title="在文件管理器中显示 / 删除记录"
        >
          <MoreHorizontal size={14} />
        </button>
      </div>
    </div>
  );
}

export function HistoryScreen() {
  const { data: jobs = [], isLoading } = useJobs();
  const deleteJob = useDeleteJob();
  const cancelJob = useCancelJob();
  const [filter, setFilter] = useState<FilterValue>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const onOpenJob = (event: Event) => {
      const detail = (event as CustomEvent<{ jobId?: string }>).detail;
      if (!detail?.jobId) return;
      setSelectedId(detail.jobId);
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
              <Empty icon="history" title="加载中" subtitle="正在获取任务列表" />
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
              <JobRowInline
                key={j.id}
                index={i + 1}
                job={j}
                selected={selectedId === j.id}
                onSelect={() => setSelectedId(j.id)}
                onCancel={() => cancelJob.mutate(j.id)}
                onDelete={() => {
                  deleteJob.mutate(j.id);
                  if (selectedId === j.id) setSelectedId(null);
                }}
              />
            ))
          )}
        </div>

        <footer className="flex items-center gap-2 px-4 py-2.5 border-t border-border-faint text-[11.5px] text-faint">
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{
              background: "var(--status-running)",
              boxShadow: "0 0 8px rgba(251,191,36,0.6)",
            }}
            aria-hidden
          />
          <span>任务在后台依次处理，关闭窗口不影响执行。</span>
        </footer>
      </section>
    </div>
  );
}
