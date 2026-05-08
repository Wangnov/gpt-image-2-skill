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
  { value: "failed", label: "失败" },
];

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
