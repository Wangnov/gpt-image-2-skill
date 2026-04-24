import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTweaks } from "@/hooks/use-tweaks";
import { promptSummary } from "@/lib/prompt-display";
import type { Job, JobStatus } from "@/lib/types";

type OpenJob = (jobId: string) => void;

const terminalStatuses = new Set<JobStatus>([
  "completed",
  "failed",
  "cancelled",
]);

function commandLabel(job: Job) {
  return job.command === "images edit" ? "编辑" : "生成";
}

function outputCount(job: Job) {
  if (job.outputs.length > 0) return job.outputs.length;
  return job.output_path ? 1 : 0;
}

function successDescription(job: Job) {
  const parts = [job.provider];
  const size = job.metadata.size;
  if (typeof size === "string" && size) parts.push(size);
  const count = outputCount(job);
  if (count > 0) parts.push(count > 1 ? `${count} 张图片` : "1 张图片");
  return parts.join(" · ");
}

function failureDescription(job: Job) {
  const err = job.error as { message?: string } | null | undefined;
  return (
    promptSummary(err?.message, 96, "") ||
    `${job.provider} · ${promptSummary(job.metadata.prompt, 48, commandLabel(job))}`
  );
}

function notifyTerminal(job: Job, onOpen: OpenJob) {
  const id = `job:${job.id}:${job.status}`;
  const open = () => onOpen(job.id);
  const common = {
    id,
    duration: 8_000,
    action: { label: "查看", onClick: open },
  } as const;

  if (job.status === "completed") {
    toast.success(`${commandLabel(job)}完成`, {
      ...common,
      description: successDescription(job),
    });
  } else if (job.status === "failed") {
    toast.error(`${commandLabel(job)}失败`, {
      ...common,
      description: failureDescription(job),
    });
  } else {
    toast("任务已取消", {
      ...common,
      description: `${job.provider} · ${promptSummary(job.metadata.prompt, 48, commandLabel(job))}`,
    });
  }
}

export function useJobNotifications(jobs: Job[] | undefined, onOpen: OpenJob) {
  const qc = useQueryClient();
  const known = useRef(new Map<string, JobStatus>());
  const initialized = useRef(false);
  const { tweaks } = useTweaks();
  const notifyOnComplete = tweaks.notifyOnComplete;
  const notifyOnFailure = tweaks.notifyOnFailure;

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
      for (const job of jobs) known.current.set(job.id, job.status);
      initialized.current = true;
      return;
    }

    for (const job of jobs) {
      const previous = known.current.get(job.id);
      if (previous !== job.status) {
        if (previous && terminalStatuses.has(job.status)) {
          const allowed =
            job.status === "completed"
              ? notifyOnComplete
              : job.status === "failed"
                ? notifyOnFailure
                : notifyOnFailure;
          if (allowed) notifyTerminal(job, onOpen);
        }
        known.current.set(job.id, job.status);
      }
    }
  }, [jobs, onOpen, notifyOnComplete, notifyOnFailure]);
}
