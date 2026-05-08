import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { Segmented } from "@/components/ui/segmented";
import { JobMetadataDrawer } from "@/components/screens/history/job-drawer";
import { JobRow } from "@/components/screens/history/job-row";
import { useCancelJob, useDeleteJob, useJobs } from "@/hooks/use-jobs";
import { useConfirm } from "@/hooks/use-confirm";
import { cn } from "@/lib/cn";
import { isActiveJobStatus } from "@/lib/api/types";
import { OPEN_JOB_EVENT } from "@/lib/job-navigation";
import type { Job } from "@/lib/types";

type FilterValue = "all" | "running" | "completed" | "failed";

const FILTERS = [
  { value: "all", label: "全部" },
  { value: "running", label: "进行中" },
  { value: "completed", label: "已完成" },
  { value: "failed", label: "失败" },
] as const;

function matchesFilter(job: Job, filter: FilterValue) {
  if (filter === "running") return isActiveJobStatus(job.status);
  if (filter === "completed") return job.status === "completed";
  if (filter === "failed") return job.status === "failed" || job.status === "cancelled";
  return true;
}

export function ClassicHistoryScreen({
  onSwitchToGenerate,
}: {
  onSwitchToGenerate?: () => void;
}) {
  const { data: jobs = [], isLoading } = useJobs();
  const cancelJob = useCancelJob();
  const deleteJob = useDeleteJob();
  const confirm = useConfirm();
  const [filter, setFilter] = useState<FilterValue>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedOutput, setSelectedOutput] = useState(0);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const filtered = useMemo(
    () => jobs.filter((job) => matchesFilter(job, filter)),
    [jobs, filter],
  );
  const selected = selectedId
    ? (jobs.find((job) => job.id === selectedId) ?? null)
    : (filtered[0] ?? null);

  useEffect(() => {
    const onOpenJob = (event: Event) => {
      const detail = (event as CustomEvent<{ jobId?: string }>).detail;
      if (!detail?.jobId) return;
      setSelectedId(detail.jobId);
      setSelectedOutput(0);
    };
    window.addEventListener(OPEN_JOB_EVENT, onOpenJob);
    return () => window.removeEventListener(OPEN_JOB_EVENT, onOpenJob);
  }, []);

  useEffect(() => {
    if (selectedId && jobs.some((job) => job.id === selectedId)) return;
    setSelectedId(filtered[0]?.id ?? null);
    setSelectedOutput(0);
  }, [filtered, jobs, selectedId]);

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDelete = async (job: Job) => {
    const ok = await confirm({
      title: "删除任务记录",
      description: "只会删除历史记录，已经保存的图片文件不会被删除。",
      confirmText: "删除",
      variant: "danger",
    });
    if (!ok) return;
    deleteJob.mutate(job.id);
    if (selectedId === job.id) setSelectedId(null);
  };

  const handleCancel = async (id: string) => {
    const ok = await confirm({
      title: "取消任务",
      description: "队列中的任务会停止继续处理。",
      confirmText: "取消任务",
      variant: "danger",
    });
    if (!ok) return;
    cancelJob.mutate(id);
  };

  const clearable = jobs.some(
    (job) => job.status === "completed" || job.status === "failed" || job.status === "cancelled",
  );

  const handleClearFinished = async () => {
    if (!clearable) return;
    const finished = jobs.filter(
      (job) => job.status === "completed" || job.status === "failed" || job.status === "cancelled",
    );
    const ok = await confirm({
      title: "清理任务记录",
      description: `将清理 ${finished.length} 条已结束任务。图片文件不会被删除。`,
      confirmText: "清理",
      variant: "danger",
    });
    if (!ok) return;
    finished.forEach((job) => deleteJob.mutate(job.id));
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_340px] gap-3 overflow-hidden p-3">
      <section className="surface-panel flex min-h-0 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center gap-3 border-b border-border-faint px-3.5 py-3">
          <div className="min-w-0 flex-1">
            <div className="t-h3">任务历史</div>
            <div className="t-small">
              {isLoading ? "正在读取任务..." : `${filtered.length} / ${jobs.length} 条记录`}
            </div>
          </div>
          <Segmented
            value={filter}
            onChange={setFilter}
            size="sm"
            ariaLabel="任务过滤"
            options={FILTERS}
          />
          <Button
            variant="ghost"
            size="sm"
            icon="trash"
            disabled={!clearable}
            onClick={handleClearFinished}
          >
            清理
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto">
          {filtered.length === 0 ? (
            <Empty
              icon="history"
              title="没有任务"
              subtitle="生成或编辑图片后，记录会出现在这里。"
              action={
                onSwitchToGenerate ? (
                  <Button
                    variant="primary"
                    size="md"
                    icon="generate"
                    onClick={onSwitchToGenerate}
                  >
                    新建生成
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="min-w-[680px]">
              {filtered.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  selected={selected?.id === job.id}
                  expanded={expandedIds.has(job.id)}
                  onSelect={() => {
                    setSelectedId(job.id);
                    setSelectedOutput(0);
                  }}
                  onToggleExpanded={() => toggleExpanded(job.id)}
                  onSelectOutput={(index) => {
                    setSelectedId(job.id);
                    setSelectedOutput(index);
                  }}
                  onDelete={() => void handleDelete(job)}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <aside
        className={cn(
          "surface-panel min-h-0 overflow-hidden",
          !selected && "flex items-center justify-center",
        )}
      >
        <JobMetadataDrawer
          job={selected ?? undefined}
          outputIndex={selectedOutput}
          onOutputIndexChange={setSelectedOutput}
          onClose={() => setSelectedId(null)}
          onDelete={(id) => {
            const job = jobs.find((item) => item.id === id);
            if (job) void handleDelete(job);
          }}
          onCancel={(id) => void handleCancel(id)}
        />
      </aside>
    </div>
  );
}
