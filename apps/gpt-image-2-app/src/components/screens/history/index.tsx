import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { Folder, Search, Trash2, X } from "lucide-react";
import {
  useActiveJobs,
  useCancelJob,
  useDeleteJob,
  useJob,
  useJobPages,
  useRetryJob,
} from "@/hooks/use-jobs";
import { OPEN_JOB_EVENT, sendImageToEdit } from "@/lib/job-navigation";
import { jobOutputPath, jobOutputUrl } from "@/lib/job-outputs";
import { Empty } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/hooks/use-confirm";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import type { Job } from "@/lib/types";
import { cn } from "@/lib/cn";
import { JobImageDetailDrawer } from "./job-image-detail-drawer";
import { JobRowExpandable } from "./job-row-expandable";
import {
  FILTERS,
  jobMatchesSearch,
  jobTimestamp,
  type FilterValue,
} from "./shared";

export function HistoryScreen({
  onSwitchToGenerate,
  onSwitchToEdit,
}: {
  onSwitchToGenerate?: () => void;
  onSwitchToEdit?: () => void;
} = {}) {
  const deleteJob = useDeleteJob();
  const cancelJob = useCancelJob();
  const retryJob = useRetryJob();
  const confirm = useConfirm();
  const reducedMotion = useReducedMotion();
  const [filter, setFilter] = useState<FilterValue>("all");
  const [searchText, setSearchText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [detailJobId, setDetailJobId] = useState<string | null>(null);
  const [detailIndex, setDetailIndex] = useState(0);
  const jobPages = useJobPages(filter, searchQuery);
  const { data: activeJobs = [], isLoading: activeLoading } = useActiveJobs();
  const { data: detailPayload } = useJob(detailJobId ?? undefined);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSearchQuery(searchText.trim());
    }, 200);
    return () => window.clearTimeout(handle);
  }, [searchText]);

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

  const pageJobs = useMemo(
    () => jobPages.data?.pages.flatMap((page) => page.jobs) ?? [],
    [jobPages.data],
  );
  const matchingActiveJobs = useMemo(
    () => activeJobs.filter((job) => jobMatchesSearch(job, searchQuery)),
    [activeJobs, searchQuery],
  );
  const jobs = useMemo(() => {
    const source =
      filter === "running"
        ? matchingActiveJobs
        : filter === "all"
          ? [...matchingActiveJobs, ...pageJobs]
          : pageJobs;
    const byId = new Map<string, Job>();
    for (const job of source) byId.set(job.id, job);
    return Array.from(byId.values()).sort(
      (a, b) => jobTimestamp(b) - jobTimestamp(a),
    );
  }, [filter, matchingActiveJobs, pageJobs]);
  const firstPage = jobPages.data?.pages[0];
  const total =
    filter === "running" ? matchingActiveJobs.length : (firstPage?.total ?? 0);
  const loadedCount = jobs.length;
  const isLoading =
    filter === "running"
      ? activeLoading && activeJobs.length === 0
      : jobPages.isLoading;
  const hasMore = filter !== "running" && Boolean(jobPages.hasNextPage);

  const clearable = jobs.some(
    (j) => j.status === "completed" || j.status === "failed",
  );

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
          当前已加载的已完成 / 已失败任务。图片文件不会被删除，此操作不可撤销。
        </>
      ),
      confirmText: "清理",
      variant: "danger",
    });
    if (!ok) return;
    finished.forEach((j) => deleteJob.mutate(j.id));
  };

  const handleRetry = async (jobId: string) => {
    const toastId = toast.loading("正在重试任务");
    try {
      const result = await retryJob.mutateAsync(jobId);
      toast.success("已重新提交", {
        id: toastId,
        description: `新任务 ${result.job_id} 已进入队列。`,
      });
      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.add(result.job_id);
        return next;
      });
    } catch (error) {
      toast.error("重试失败", {
        id: toastId,
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const detailJob = detailJobId
    ? (jobs.find((j) => j.id === detailJobId) ?? detailPayload?.job ?? null)
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
      <div className="mb-4 grid grid-cols-1 items-center gap-3 lg:grid-cols-[1fr_minmax(320px,560px)_1fr]">
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto scrollbar-none">
          {FILTERS.map((f) => {
            const isActive = filter === f.value;
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => setFilter(f.value)}
                className={cn(
                  "relative px-3.5 h-8 rounded-full text-[12.5px] font-medium transition-colors",
                  isActive
                    ? "text-foreground"
                    : "text-muted hover:text-foreground hover:bg-[color:var(--w-04)]",
                )}
              >
                {/* Shared accent pill that slides between filter chips. */}
                {isActive && (
                  <motion.span
                    layoutId="history-filter-active-pill"
                    aria-hidden="true"
                    className="absolute inset-0 z-0 rounded-full border border-[color:var(--accent-30)]"
                    style={{ background: "var(--accent-14)" }}
                    transition={{
                      duration: reducedMotion ? 0 : 0.24,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                  />
                )}
                <span className="relative z-10">{f.label}</span>
              </button>
            );
          })}
        </div>
        <label className="relative block min-w-0">
          <Search
            size={15}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint"
            aria-hidden
          />
          <input
            type="search"
            value={searchText}
            onChange={(event) => setSearchText(event.currentTarget.value)}
            placeholder="搜索提示词 / Job ID / Provider"
            aria-label="搜索任务"
            className="h-9 w-full rounded-full border border-[color:var(--w-10)] bg-[color:var(--w-05)] pl-9 pr-9 text-[13px] text-foreground outline-none transition-colors placeholder:text-faint hover:bg-[color:var(--w-07)] focus:border-[color:var(--accent-45)] focus:bg-[color:var(--w-08)]"
          />
          {searchText.trim() && (
            <button
              type="button"
              onClick={() => {
                setSearchText("");
                setSearchQuery("");
              }}
              className="absolute right-1.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-faint transition-colors hover:bg-[color:var(--w-08)] hover:text-foreground"
              aria-label="清空搜索"
              title="清空搜索"
            >
              <X size={13} />
            </button>
          )}
        </label>
        <span className="justify-self-end text-[11px] text-faint font-mono">
          {loadedCount} / {total}
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
          ) : jobs.length === 0 ? (
            <div className="p-12 flex justify-center">
              <Empty
                icon="search"
                title={total === 0 ? "还没有任务" : "无匹配结果"}
                subtitle={
                  total === 0
                    ? searchQuery
                      ? "没有找到匹配的任务。"
                      : "在「生成」里写一句提示词，任务会出现在这里。"
                    : "切换筛选标签或清除条件再试。"
                }
                action={
                  total === 0 && onSwitchToGenerate ? (
                    <Button
                      variant="primary"
                      size="md"
                      icon="generate"
                      onClick={onSwitchToGenerate}
                    >
                      去写第一句
                    </Button>
                  ) : null
                }
              />
            </div>
          ) : (
            <>
              <AnimatePresence initial={false}>
                {jobs.map((j, i) => (
                  <motion.div
                    key={j.id}
                    layout="position"
                    initial={
                      reducedMotion
                        ? false
                        : { opacity: 0, y: 4 }
                    }
                    animate={{ opacity: 1, y: 0 }}
                    exit={
                      reducedMotion
                        ? { opacity: 0 }
                        : { opacity: 0, x: -16, scale: 0.98 }
                    }
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <JobRowExpandable
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
                      onRetry={() => void handleRetry(j.id)}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
              {hasMore && (
                <div className="flex justify-center px-4 py-4">
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={jobPages.isFetchingNextPage ? "reload" : "plus"}
                    disabled={jobPages.isFetchingNextPage}
                    onClick={() => void jobPages.fetchNextPage()}
                  >
                    {jobPages.isFetchingNextPage ? "加载中" : "加载更多"}
                  </Button>
                </div>
              )}
            </>
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
        onRetry={(jobId) => void handleRetry(jobId)}
        onSendToEdit={(job, outputIndex) => {
          sendImageToEdit({
            jobId: job.id,
            outputIndex,
            path: jobOutputPath(job, outputIndex),
            url: jobOutputUrl(job, outputIndex),
          });
          setDetailJobId(null);
          onSwitchToEdit?.();
        }}
      />
    </div>
  );
}
