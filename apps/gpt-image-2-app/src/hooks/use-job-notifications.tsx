import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { StatusDot } from "@/components/ui/status-dot";
import { statusLabel } from "@/lib/format";
import type { Job, JobStatus } from "@/lib/types";

type OpenJob = (jobId: string) => void;

const activeStatuses = new Set<JobStatus>(["queued", "running"]);
const terminalStatuses = new Set<JobStatus>([
  "completed",
  "failed",
  "cancelled",
]);

function activeToastId(jobId: string) {
  return `job:${jobId}:active`;
}

function doneToastId(jobId: string) {
  return `job:${jobId}:done:${Date.now()}`;
}

function promptOf(job: Job) {
  const prompt = job.metadata.prompt;
  return typeof prompt === "string" && prompt.trim() ? prompt : job.command;
}

function JobToast({
  job,
  title,
  subtitle,
  onOpen,
}: {
  job: Job;
  title: string;
  subtitle: string;
  onOpen: OpenJob;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(job.id)}
      className="block w-full rounded-[inherit] text-left outline-none"
    >
      <div className="flex items-start gap-2.5">
        <div className="pt-1">
          <StatusDot
            status={job.status}
            pulse={job.status === "running" || job.status === "queued"}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-foreground">
            {title}
          </div>
          <div className="mt-0.5 truncate text-[12px] text-muted">
            {promptOf(job)}
          </div>
          <div className="mt-1 text-[11px] text-faint">
            {subtitle} · 点击查看历史
          </div>
        </div>
      </div>
    </button>
  );
}

function showActiveToast(job: Job, onOpen: OpenJob) {
  toast.custom(
    () => (
      <JobToast
        job={job}
        title={job.status === "queued" ? "任务已加入队列" : "任务正在运行"}
        subtitle={`${job.provider} · ${statusLabel(job.status)}`}
        onOpen={onOpen}
      />
    ),
    {
      id: activeToastId(job.id),
      duration: Infinity,
      closeButton: false,
    },
  );
}

function showTerminalToast(
  job: Job,
  previousStatus: JobStatus | undefined,
  onOpen: OpenJob,
) {
  toast.dismiss(activeToastId(job.id));
  const title =
    job.status === "completed"
      ? "任务完成"
      : job.status === "failed"
        ? "任务失败"
        : "任务已取消";
  const subtitle =
    previousStatus && activeStatuses.has(previousStatus)
      ? "已从队列前置到这里"
      : statusLabel(job.status);
  toast.custom(
    () => (
      <JobToast
        job={job}
        title={title}
        subtitle={`${job.provider} · ${subtitle}`}
        onOpen={onOpen}
      />
    ),
    {
      id: doneToastId(job.id),
      duration: 10_000,
      closeButton: true,
    },
  );
}

export function useJobNotifications(jobs: Job[] | undefined, onOpen: OpenJob) {
  const qc = useQueryClient();
  const known = useRef(new Map<string, JobStatus>());
  const initialized = useRef(false);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen("gpt-image-2-job-event", () => {
      void qc.invalidateQueries({ queryKey: ["jobs"] });
    }).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlisten = fn;
      }
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [qc]);

  useEffect(() => {
    if (!jobs) return;

    if (!initialized.current) {
      for (const job of jobs) {
        known.current.set(job.id, job.status);
        if (activeStatuses.has(job.status)) showActiveToast(job, onOpen);
      }
      initialized.current = true;
      return;
    }

    for (const job of jobs) {
      const previous = known.current.get(job.id);
      if (!previous) {
        if (activeStatuses.has(job.status)) showActiveToast(job, onOpen);
        if (terminalStatuses.has(job.status))
          showTerminalToast(job, previous, onOpen);
        known.current.set(job.id, job.status);
        continue;
      }
      if (previous !== job.status) {
        if (activeStatuses.has(job.status)) showActiveToast(job, onOpen);
        if (terminalStatuses.has(job.status))
          showTerminalToast(job, previous, onOpen);
        known.current.set(job.id, job.status);
      }
    }
  }, [jobs, onOpen]);
}
