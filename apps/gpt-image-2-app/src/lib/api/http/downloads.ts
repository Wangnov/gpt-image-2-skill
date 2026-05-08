import type { Job } from "../../types";
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
) {
  const url = fileUrl(path);
  if (!url) throw new Error("没有可下载的图片。");
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下载图片失败：${response.status} ${response.statusText}`);
  }
  return response.blob();
}

export async function downloadJobZip(
  job: Job,
  fileUrl: (path?: string | null) => string,
  jobOutputPaths: (job: Job) => string[],
) {
  const paths = jobOutputPaths(job);
  if (paths.length === 0) throw new Error("没有可下载的图片。");
  const baseName = jobExportBaseName(job);
  const entries = await Promise.all(
    paths.map(async (path, index) => ({
      name: `${baseName}/${outputFileName(path, index)}`,
      data: await fetchOutputBlob(path, fileUrl),
    })),
  );
  const zip = await createStoredZip(entries);
  const url = URL.createObjectURL(zip);
  downloadUrl(url, `${baseName}.zip`);
  window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
  return [`${baseName}.zip`];
}
