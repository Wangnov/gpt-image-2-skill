import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Empty } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { JobRow } from "./job-row";
import { JobMetadataDrawer } from "./job-drawer";
import { useCancelJob, useDeleteJob, useJobs } from "@/hooks/use-jobs";
import { OPEN_JOB_EVENT } from "@/lib/job-navigation";

type FilterValue =
  | "all"
  | "running"
  | "completed"
  | "failed"
  | "generate"
  | "edit";

const FILTERS: { value: FilterValue; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "running", label: "运行中" },
  { value: "completed", label: "完成" },
  { value: "failed", label: "失败" },
  { value: "generate", label: "生成" },
  { value: "edit", label: "编辑" },
];

export function HistoryScreen() {
  const { data: jobs = [], isLoading } = useJobs();
  const deleteJob = useDeleteJob();
  const cancelJob = useCancelJob();
  const [filter, setFilter] = useState<FilterValue>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(true);

  const filtered = useMemo(
    () =>
      jobs.filter((j) => {
        if (
          filter === "running" &&
          !(j.status === "running" || j.status === "queued")
        )
          return false;
        if (filter === "completed" && j.status !== "completed") return false;
        if (filter === "failed" && j.status !== "failed") return false;
        if (filter === "generate" && j.command !== "images generate")
          return false;
        if (filter === "edit" && j.command !== "images edit") return false;
        const prompt = (j.metadata as Record<string, unknown>)?.prompt as
          | string
          | undefined;
        if (
          query &&
          !(prompt ?? "").toLowerCase().includes(query.toLowerCase()) &&
          !j.id.includes(query)
        )
          return false;
        return true;
      }),
    [filter, jobs, query],
  );
  const selectedJob = jobs.find((j) => j.id === selectedId);

  useEffect(() => {
    const onOpenJob = (event: Event) => {
      const detail = (event as CustomEvent<{ jobId?: string }>).detail;
      if (!detail?.jobId) return;
      setSelectedId(detail.jobId);
      setDrawerOpen(true);
    };
    window.addEventListener(OPEN_JOB_EVENT, onOpenJob);
    return () => window.removeEventListener(OPEN_JOB_EVENT, onOpenJob);
  }, []);

  return (
    <div
      className={
        drawerOpen
          ? "grid h-full grid-cols-[minmax(0,1fr)_300px] overflow-hidden xl:grid-cols-[minmax(0,1fr)_380px]"
          : "grid h-full grid-cols-[1fr] overflow-hidden"
      }
    >
      <div className="flex flex-col overflow-hidden bg-raised">
        <div className="px-4 py-3 border-b border-border-faint flex items-center gap-2.5 overflow-x-auto">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索提示词…"
            icon="search"
            size="sm"
            wrapperClassName="max-w-[320px] flex-1"
          />
          <Segmented
            value={filter}
            onChange={setFilter}
            size="sm"
            ariaLabel="筛选任务"
            options={FILTERS}
          />
          <div className="flex-1" />
          <span className="t-tiny font-mono">
            {filtered.length} / {jobs.length}
          </span>
        </div>

        <div
          className="grid min-w-[560px] items-center gap-3 border-b border-border bg-sunken px-3.5 py-1.5"
          style={{ gridTemplateColumns: "44px 1fr 130px 120px 100px 80px" }}
        >
          <span />
          <span className="t-caps">任务</span>
          <span className="t-caps">服务商</span>
          <span className="t-caps">输出</span>
          <span className="t-caps">状态</span>
          <span />
        </div>

        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <Empty icon="history" title="加载中" subtitle="正在获取任务列表" />
          ) : filtered.length === 0 ? (
            <Empty
              icon="search"
              title="无匹配结果"
              subtitle="调整筛选或搜索关键词。"
            />
          ) : (
            filtered.map((j) => (
              <JobRow
                key={j.id}
                job={j}
                selected={j.id === selectedId}
                onSelect={() => {
                  setSelectedId(j.id);
                  setDrawerOpen(true);
                }}
                onDelete={() => deleteJob.mutate(j.id)}
              />
            ))
          )}
        </div>

        <div className="px-4 py-2.5 border-t border-border-faint text-[11px] text-faint flex items-center gap-1.5">
          <Icon name="folder" size={11} />
          <span className="truncate">
            图片会自动保存在本机记录里；选中作品后可以保存到下载文件夹。
          </span>
          <div className="flex-1" />
          {!drawerOpen && (
            <Button
              variant="ghost"
              size="sm"
              icon="chevleft"
              onClick={() => setDrawerOpen(true)}
            >
              显示详情
            </Button>
          )}
        </div>
      </div>

      {drawerOpen && (
        <div className="border-l border-border bg-raised overflow-hidden">
          <JobMetadataDrawer
            job={selectedJob}
            onClose={() => setDrawerOpen(false)}
            onDelete={(id) => {
              deleteJob.mutate(id);
              setSelectedId(null);
            }}
            onCancel={(id) => cancelJob.mutate(id)}
          />
        </div>
      )}
    </div>
  );
}
