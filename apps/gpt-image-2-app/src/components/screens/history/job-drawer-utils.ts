import type { CSSProperties } from "react";
import { api } from "@/lib/api";
import type { Job, OutputUploadRef } from "@/lib/types";

export function jobDrawerBadgeTone(status: Job["status"]) {
  if (status === "completed") return "ok" as const;
  if (status === "failed" || status === "cancelled") return "err" as const;
  if (status === "running" || status === "uploading") return "running" as const;
  return "queued" as const;
}

export function readPlannedCount(job: Job) {
  const raw = (job.metadata as Record<string, unknown>)?.n;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.min(16, Math.floor(raw));
  }
  const outputs = api.jobOutputPaths(job).length;
  return outputs > 0 ? outputs : 1;
}

export function storageStatusLabel(status?: string) {
  switch (status) {
    case "completed":
      return "已上传";
    case "partial_failed":
      return "部分失败";
    case "failed":
      return "上传失败";
    case "fallback_completed":
      return "已回退";
    case "pending":
      return "待上传";
    case "running":
      return "上传中";
    default:
      return "未配置";
  }
}

export function uploadStatusTone(status?: string) {
  if (status === "completed") return "text-[color:var(--status-ok)]";
  if (status === "failed" || status === "unsupported") {
    return "text-[color:var(--status-err)]";
  }
  return "text-muted";
}

export function outputUploadsFor(job: Job, index: number): OutputUploadRef[] {
  return job.outputs.find((output) => output.index === index)?.uploads ?? [];
}

export function jobSeed(job: Job) {
  return parseInt(job.id.replace(/\D/g, ""), 10) || 0;
}

export const SHIMMER_STYLE: CSSProperties = {
  background:
    "linear-gradient(110deg, var(--bg-sunken) 0%, var(--bg-hover) 40%, var(--bg-sunken) 80%)",
  backgroundSize: "200% 100%",
};
