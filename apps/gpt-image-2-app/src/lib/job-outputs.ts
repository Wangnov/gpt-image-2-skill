import { api } from "@/lib/api";
import type { Job } from "@/lib/types";

export function jobOutputIndexes(job: Job): number[] {
  const indexes = (job.outputs ?? [])
    .filter((output) => output.path)
    .map((output) => output.index)
    .sort((a, b) => a - b);
  if (indexes.length > 0) return indexes;
  return job.output_path ? [0] : [];
}

export function jobOutputCount(job: Job): number {
  return jobOutputIndexes(job).length;
}

export function jobOutputUrl(job: Job, index = 0): string | null {
  return api.jobOutputUrl(job, index) || null;
}

export function jobOutputPath(job: Job, index = 0): string | null {
  return api.jobOutputPath(job, index) ?? null;
}
