import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTweaks } from "@/hooks/use-tweaks";
import type { Job, JobStatus } from "@/lib/types";

type OpenJob = (jobId: string) => void;

const terminalStatuses = new Set<JobStatus>([
  "completed",
  "failed",
  "cancelled",
]);

function promptOf(job: Job) {
  const prompt = job.metadata.prompt;
  if (typeof prompt === "string" && prompt.trim()) return prompt;
  return job.command === "images edit" ? "图像编辑" : "图像生成";
}

function commandLabel(job: Job) {
  return job.command === "images edit" ? "编辑" : "生成";
}

function notifyTerminal(job: Job, onOpen: OpenJob) {
  const id = `job:${job.id}:${job.status}`;
  const description = promptOf(job);
  const open = () => onOpen(job.id);
  const common = {
    id,
    description,
    duration: 8_000,
    action: { label: "查看", onClick: open },
  } as const;

  if (job.status === "completed") {
    toast.success(`${commandLabel(job)}完成`, common);
  } else if (job.status === "failed") {
    const err = job.error as { message?: string } | null | undefined;
    toast.error(`${commandLabel(job)}失败`, {
      ...common,
      description: err?.message || description,
    });
  } else {
    toast("任务已取消", common);
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
