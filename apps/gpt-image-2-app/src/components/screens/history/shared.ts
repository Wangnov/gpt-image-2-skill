import type { TauriJobResponse } from "@/lib/api";
import type { Job } from "@/lib/types";
import {
  jobOutputIndexes,
  jobOutputPath,
  jobOutputUrl,
} from "@/lib/job-outputs";

export type FilterValue = "all" | "running" | "completed" | "failed";

export const FILTERS: { value: FilterValue; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "running", label: "进行中" },
  { value: "completed", label: "已完成" },
  { value: "failed", label: "失败/部分失败" },
];

export function outputLabel(outputIndex: number): string {
  return outputIndex >= 0 && outputIndex < 26
    ? String.fromCharCode(65 + outputIndex)
    : `#${outputIndex + 1}`;
}

export function jobThumbUrl(job: Job): string | null {
  const index = jobOutputIndexes(job)[0];
  return index === undefined ? null : jobOutputUrl(job, index);
}

export function jobThumbPath(job: Job): string | null {
  const index = jobOutputIndexes(job)[0];
  return index === undefined ? null : jobOutputPath(job, index);
}

export function jobRatio(job: Job): string {
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

export function jobPrompt(job: Job): string {
  const md = (job.metadata ?? {}) as Record<string, unknown>;
  const p = md.prompt as string | undefined;
  return p?.trim() || "（无提示词）";
}

export function jobMatchesSearch(job: Job, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [
    job.id,
    job.command,
    job.provider,
    job.output_path ?? "",
    JSON.stringify(job.metadata ?? {}),
    JSON.stringify(job.error ?? {}),
  ]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

export function isClearableTerminalJob(job: Job) {
  return [
    "completed",
    "partial_failed",
    "failed",
    "cancelled",
    "canceled",
  ].includes(job.status);
}

export function totalBytes(job: Job): string {
  const total = (job.outputs ?? []).reduce((acc, o) => acc + (o.bytes ?? 0), 0);
  if (total === 0) return "";
  if (total > 1024 * 1024) return `${(total / 1024 / 1024).toFixed(1)} MB`;
  return `${(total / 1024).toFixed(1)} KB`;
}

export function jobTimestamp(job: Job) {
  const raw = job.created_at || job.updated_at || "";
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && raw.trim() !== "") return numeric * 1000;
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export type JobOutputError = {
  index: number;
  message: string;
  code?: string;
  detail?: unknown;
};

export type GenerationSlot = {
  index: number;
  status: string;
  path?: string | null;
  bytes?: number | null;
  error?: string | null;
  recoverability?: string | null;
  raw_response_present?: boolean;
};

export type RecoveryActionId =
  | "continue_save"
  | "resume_remote"
  | "fill_missing"
  | "reupload"
  | "resubmit";

export type RecoveryActionCopy = {
  action: RecoveryActionId;
  label: string;
  title: string;
  loading: string;
  success: string;
  description: (
    resultJobId: string | undefined,
    originalJobId: string,
  ) => string;
};

export type RecoveryActionOptions = {
  supportsLocalRecovery?: boolean;
};

export type RecoveryToastNotice = {
  kind: "success" | "warning" | "error";
  title: string;
  description: string;
};

function resubmitAction(): RecoveryActionCopy {
  return {
    action: "resubmit",
    label: "重新生成",
    title: "重新生成 · 将再次调用 API",
    loading: "正在重新生成任务",
    success: "已重新生成",
    description: (resultJobId, originalJobId) =>
      `任务 ${resultJobId || originalJobId} 已进入队列，将再次调用 API。`,
  };
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

export function generationSlots(job: Job): GenerationSlot[] {
  const slots = Array.isArray(job.metadata?.generation_slots)
    ? job.metadata.generation_slots
    : [];
  return slots
    .map((value): GenerationSlot | null => {
      const raw = objectValue(value);
      if (!raw) return null;
      const index = Number(raw.index);
      if (!Number.isFinite(index)) return null;
      return {
        index,
        status: typeof raw.status === "string" ? raw.status : "missing",
        path: typeof raw.path === "string" ? raw.path : null,
        bytes: Number.isFinite(Number(raw.bytes)) ? Number(raw.bytes) : null,
        error: typeof raw.error === "string" ? raw.error : null,
        recoverability:
          typeof raw.recoverability === "string" ? raw.recoverability : null,
        raw_response_present: raw.raw_response_present === true,
      };
    })
    .filter((slot): slot is GenerationSlot => Boolean(slot))
    .sort((a, b) => a.index - b.index);
}

export function plannedOutputCount(job: Job): number {
  const slots = generationSlots(job);
  if (slots.length > 0) return slots.length;
  const raw = (job.metadata ?? {}).n;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.min(16, Math.floor(raw));
  }
  return Math.max(1, jobOutputIndexes(job).length || (job.output_path ? 1 : 0));
}

function outputErrorFromValue(value: unknown): JobOutputError | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const index = Number(raw.index);
  const message =
    typeof raw.message === "string"
      ? raw.message
      : typeof raw.error === "string"
        ? raw.error
        : "";
  if (!Number.isFinite(index) || !message.trim()) return null;
  return {
    index,
    message,
    code: typeof raw.code === "string" ? raw.code : undefined,
    detail: raw.detail,
  };
}

export function jobOutputErrors(job: Job): JobOutputError[] {
  const error = job.error && typeof job.error === "object" ? job.error : null;
  const metadataBatch =
    job.metadata.batch && typeof job.metadata.batch === "object"
      ? (job.metadata.batch as Record<string, unknown>)
      : null;
  const slotErrors = generationSlots(job)
    .filter((slot) => slot.status !== "completed")
    .map((slot) => ({
      index: slot.index,
      message: slot.error || "未生成",
      code: slot.status,
    }));
  const candidates = [
    error && Array.isArray(error.items) ? error.items : null,
    metadataBatch && Array.isArray(metadataBatch.errors)
      ? metadataBatch.errors
      : null,
    slotErrors,
  ];
  const byIndex = new Map<number, JobOutputError>();
  for (const values of candidates) {
    for (const value of values ?? []) {
      const item = outputErrorFromValue(value);
      if (item) byIndex.set(item.index, item);
    }
  }
  return Array.from(byIndex.values()).sort((a, b) => a.index - b.index);
}

export function derivedRecoverability(job: Job): string {
  const recoverability = String(job.metadata?.recoverability ?? "");
  if (recoverability === "recoverable.partial_outputs") {
    return recoverability;
  }

  const storageFailed =
    job.storage_status === "failed" || job.storage_status === "partial_failed";
  const outputsPresent = jobOutputIndexes(job).length;
  if (
    storageFailed &&
    outputsPresent > 0 &&
    outputsPresent >= plannedOutputCount(job)
  ) {
    return "recoverable.upload_failed";
  }

  return recoverability;
}

export function jobRecoveryAction(
  job: Job,
  options: RecoveryActionOptions = {},
): RecoveryActionCopy {
  const recoverability = derivedRecoverability(job);
  const supportsLocalRecovery = options.supportsLocalRecovery ?? true;
  if (!supportsLocalRecovery) return resubmitAction();
  const hasRemoteTask = Boolean(
    job.metadata?.remote_task ||
    (Array.isArray(job.metadata?.remote_tasks) &&
      job.metadata.remote_tasks.some(Boolean)),
  );

  if (
    hasRemoteTask &&
    (recoverability === "recoverable.remote_in_progress" ||
      recoverability === "terminal.local_recovery_unavailable")
  ) {
    return {
      action: "resume_remote",
      label: "继续获取结果",
      title: "继续轮询已创建的 sub2api 任务，不重新提交生成请求",
      loading: "正在获取远端任务结果",
      success: "已取回远端结果",
      description: () => "已从原远端任务取回结果，未重新提交图片生成请求。",
    };
  }
  if (recoverability === "recoverable.local_response_cached") {
    return {
      action: "continue_save",
      label: "继续完成",
      title: "使用已收到的响应继续完成，不再次调用 API",
      loading: "正在继续完成任务",
      success: "已继续完成",
      description: () => "已使用本地缓存响应完成保存，未再次调用 API。",
    };
  }
  if (recoverability === "recoverable.partial_outputs") {
    const missing = generationSlots(job).filter(
      (slot) => slot.status !== "completed",
    ).length;
    return {
      action: "fill_missing",
      label: `生成缺失的 ${Math.max(1, missing)} 张`,
      title: "只为缺失图片再次调用 API",
      loading: "正在生成缺失图片",
      success: "缺失图片已补齐",
      description: () => "已有图片保持不变，只为缺失槽位发起新请求。",
    };
  }
  if (recoverability === "recoverable.upload_failed") {
    return {
      action: "reupload",
      label: "重新上传",
      title: "不重新生成，只重传本地已有图片",
      loading: "正在重新上传",
      success: "已重新上传",
      description: () => "图片已在本地生成，本次未再次调用 API。",
    };
  }
  return resubmitAction();
}

export function recoveryToastNotice(
  recovery: RecoveryActionCopy,
  result: TauriJobResponse,
  originalJobId: string,
): RecoveryToastNotice {
  if (
    (recovery.action === "fill_missing" ||
      recovery.action === "resume_remote") &&
    result.recovered === false
  ) {
    const status = result.job?.status;
    const jobId = result.job_id || originalJobId;
    if (status === "partial_failed") {
      return {
        kind: "warning",
        title:
          recovery.action === "resume_remote"
            ? "已取回部分远端结果"
            : "仍有图片未补齐",
        description:
          recovery.action === "resume_remote"
            ? `任务 ${jobId} 已保存可取回的图片；失败槽位没有重新提交。`
            : `任务 ${jobId} 已保存本次成功补齐的图片，但仍有槽位失败。`,
      };
    }
    return {
      kind: "error",
      title:
        recovery.action === "resume_remote" ? "远端结果未取回" : "补齐未完成",
      description:
        recovery.action === "resume_remote"
          ? `任务 ${jobId} 没有可保存的远端结果，也没有重新提交生成请求。`
          : `任务 ${jobId} 本次补齐失败，请查看错误详情后重试。`,
    };
  }

  return {
    kind: "success",
    title: recovery.success,
    description: recovery.description(result.job_id, originalJobId),
  };
}

export function jobCanShowRecoveryAction(
  job: Job,
  options: RecoveryActionOptions = {},
) {
  if (options.supportsLocalRecovery === false) {
    return ["failed", "partial_failed", "cancelled", "canceled"].includes(
      job.status,
    );
  }
  const recoverability = derivedRecoverability(job);
  if (recoverability === "recoverable.upload_failed") return true;
  return ["failed", "partial_failed", "cancelled", "canceled"].includes(
    job.status,
  );
}

export function jobStatusLabel(job: Job): string {
  if (job.status === "partial_failed") {
    return `部分成功 ${jobOutputIndexes(job).length}/${plannedOutputCount(job)}`;
  }
  if (job.status === "completed") return "已完成";
  if (job.status === "failed") return "失败";
  if (job.status === "cancelled" || job.status === "canceled") return "已取消";
  if (job.status === "uploading" || job.status === "running") return "进行中";
  return "等待中";
}

export function jobErrorMessage(job: Job): string {
  const error = job.error;
  if (!error || typeof error !== "object") return "";
  return typeof error.message === "string" ? error.message : "";
}

export function jobErrorDetailText(job: Job): string {
  const error = job.error;
  if (!error || typeof error !== "object") return "";
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return jobErrorMessage(job);
  }
}

export function jobErrorCode(job: Job): string {
  const error = job.error;
  if (!error || typeof error !== "object") return "";
  return typeof error.code === "string" ? error.code : "";
}

/** Just the structured `detail` (the real cause), formatted for inline display.
 * Empty when there is no detail. Separate from {@link jobErrorDetailText},
 * which serializes the whole error object for the copy-to-clipboard payload. */
export function jobErrorDetailOnly(job: Job): string {
  const error = job.error;
  if (!error || typeof error !== "object" || error.detail == null) return "";
  if (typeof error.detail === "string") return error.detail;
  try {
    return JSON.stringify(error.detail, null, 2);
  } catch {
    return String(error.detail);
  }
}

export function jobMetaItems(job: Job): string[] {
  const md = (job.metadata ?? {}) as Record<string, unknown>;
  const items = [job.provider || "auto"];
  if (typeof md.quality === "string" && md.quality.trim()) {
    items.push(md.quality);
  }
  const ratio = jobRatio(job);
  if (ratio) items.push(ratio);
  const planned = plannedOutputCount(job);
  const produced = jobOutputIndexes(job).length;
  if (job.status === "partial_failed") {
    items.push(`${produced}/${planned} 张`);
  } else if (planned > 1 || produced > 0) {
    items.push(`${produced || planned} 张`);
  }
  return items;
}

export type JobKind = "generate" | "edit" | "request";

/** Coarse creation kind for a job: text-to-image, image-to-image, or raw request. */
export function jobKind(job: Job): JobKind {
  if (job.command === "images edit") return "edit";
  if (job.command === "request create") return "request";
  return "generate";
}

/**
 * Number of input reference images for an edit job. Prefers the backend-filled
 * `reference_images` (works for http/tauri incl. legacy jobs); falls back to
 * the browser runtime's `metadata.ref_count`.
 */
export function jobReferenceCount(job: Job): number {
  // The backend (http/tauri) always sends reference_images, so an empty array
  // is authoritative ("no inputs"). Only fall back to the browser runtime's
  // metadata.ref_count when the field is absent entirely.
  if (Array.isArray(job.reference_images)) {
    return job.reference_images.length;
  }
  const fromMeta = Number((job.metadata as Record<string, unknown>)?.ref_count);
  return Number.isFinite(fromMeta) && fromMeta > 0 ? Math.floor(fromMeta) : 0;
}

/**
 * Whether an edit job used a local region/mask (vs. plain reference images).
 * Best-effort from metadata; absent markers degrade to `false` (no badge).
 */
export function jobHasRegionEdit(job: Job): boolean {
  if (job.command !== "images edit") return false;
  // The edit form persists `edit_region_mode` into metadata: "native-mask" /
  // "reference-hint" for local region edits, "none" for plain reference edits.
  const mode = (job.metadata as Record<string, unknown>)?.edit_region_mode;
  return typeof mode === "string" && mode !== "" && mode !== "none";
}
