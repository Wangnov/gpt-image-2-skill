import type { Job } from "../../types";
import { jobOutputPath } from "../shared";
import { jobExportBaseName, outputFileName } from "@/lib/job-export";
import { createStoredZip } from "@/lib/zip";

export function downloadUrl(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function basename(path: string, fallback: string) {
  const value = path.split(/[\\/]/).pop();
  return value && value.trim() ? value : fallback;
}

async function fetchOutputBlob(
  path: string,
  fileUrl: (path?: string | null) => string,
  preferredUrl?: string,
) {
  const url = preferredUrl || fileUrl(path);
  if (!url) throw new Error("没有可下载的图片。");
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下载图片失败：${response.status} ${response.statusText}`);
  }
  return response.blob();
}

export function jobDownloadEntries(job: Job) {
  const entries = job.outputs
    .slice()
    .sort((a, b) => a.index - b.index)
    .filter((output) => output.path)
    .map((output) => ({ path: output.path, outputIndex: output.index }));
  if (entries.length > 0) return entries;
  return job.output_path ? [{ path: job.output_path, outputIndex: 0 }] : [];
}

export function jobOutputDownloadName(job: Job, outputIndex: number) {
  return outputFileName(jobOutputPath(job, outputIndex) ?? "", outputIndex);
}

export async function downloadJobZip(
  job: Job,
  fileUrl: (path?: string | null) => string,
  jobOutputUrl?: (job: Job, index?: number) => string,
) {
  const outputs = jobDownloadEntries(job);
  if (outputs.length === 0) throw new Error("没有可下载的图片。");
  const baseName = jobExportBaseName(job);
  const entries = await Promise.all(
    outputs.map(async ({ path, outputIndex }) => ({
      name: `${baseName}/${outputFileName(path, outputIndex)}`,
      data: await fetchOutputBlob(
        path,
        fileUrl,
        jobOutputUrl?.(job, outputIndex),
      ),
    })),
  );
  const zip = await createStoredZip(entries);
  const url = URL.createObjectURL(zip);
  downloadUrl(url, `${baseName}.zip`);
  window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
  return [`${baseName}.zip`];
}
