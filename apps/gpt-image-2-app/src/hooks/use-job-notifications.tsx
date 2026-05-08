import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useConfig } from "@/hooks/use-config";
import { api } from "@/lib/api";
import { promptSummary } from "@/lib/prompt-display";
import { sendSystemJobNotification } from "@/lib/system-notifications";
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

function jobFromEvent(event: { data?: Record<string, unknown> }): Job | null {
  const raw = event.data?.job;
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<Job> & Record<string, unknown>;
  if (!value.id || !value.status) return null;
  const rawStatus = String(value.status);
  const status = rawStatus === "canceled" ? "cancelled" : rawStatus;
  return {
    id: String(value.id),
    command: (value.command as Job["command"]) ?? "images generate",
    provider: String(value.provider ?? "auto"),
    status: status as JobStatus,
    created_at: String(value.created_at ?? ""),
    updated_at: String(value.updated_at ?? value.created_at ?? ""),
    metadata:
      value.metadata && typeof value.metadata === "object"
        ? (value.metadata as Record<string, unknown>)
        : {},
    outputs: Array.isArray(value.outputs) ? value.outputs : [],
    output_path:
      typeof value.output_path === "string" ? value.output_path : undefined,
    error: (value.error as Job["error"]) ?? null,
  };
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
    // Thumbnail of the freshly produced image so the toast is itself a
    // glance-able reveal — not just "task done" text. Click → open detail.
    const firstPath = job.outputs?.[0]?.path ?? job.output_path;
    const thumbUrl = firstPath ? api.fileUrl(firstPath) : null;
    toast.success(`${commandLabel(job)}完成`, {
      ...common,
      description: successDescription(job),
      classNames: thumbUrl
        ? { icon: "job-complete-toast__thumb-slot" }
        : undefined,
      icon: thumbUrl ? (
        <img
          src={thumbUrl}
          alt=""
          decoding="async"
          className="job-complete-toast__thumb"
        />
      ) : undefined,
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
  const { data: config } = useConfig();
  const notificationConfig = config?.notifications;
  const notificationsEnabled = notificationConfig?.enabled ?? true;
  const notifyOnComplete =
    notificationsEnabled && (notificationConfig?.on_completed ?? true);
  const notifyOnFailure =
    notificationsEnabled && (notificationConfig?.on_failed ?? true);
  const notifyOnCancelled =
    notificationsEnabled && (notificationConfig?.on_cancelled ?? true);
  const toastEnabled =
    !notificationsEnabled || (notificationConfig?.toast.enabled ?? true);
  const systemEnabled = notificationsEnabled
    ? (notificationConfig?.system.enabled ?? false)
    : false;

  const notifyAllowed = (job: Job) =>
    job.status === "completed"
      ? notifyOnComplete
      : job.status === "failed"
        ? notifyOnFailure
        : notifyOnCancelled;

  const notify = (job: Job) => {
    if (!notifyAllowed(job)) return;
    if (toastEnabled) notifyTerminal(job, onOpen);
    if (systemEnabled) void sendSystemJobNotification(job);
  };

  useEffect(() => {
    return api.subscribeJobUpdates((_, event) => {
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      const job = jobFromEvent(event);
      if (!job) return;
      const previous = known.current.get(job.id);
      if (previous !== job.status) {
        if (previous && terminalStatuses.has(job.status)) {
          notify(job);
        }
        known.current.set(job.id, job.status);
      }
    });
  }, [
    notifyOnComplete,
    notifyOnFailure,
    notifyOnCancelled,
    toastEnabled,
    systemEnabled,
    onOpen,
    qc,
  ]);

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
          notify(job);
        }
        known.current.set(job.id, job.status);
      }
    }
  }, [
    jobs,
    onOpen,
    notifyOnComplete,
    notifyOnFailure,
    notifyOnCancelled,
    toastEnabled,
    systemEnabled,
  ]);
}
