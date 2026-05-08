import type { Job } from "../../types";
import { jobOutputPaths } from "../shared";
import { jobExportBaseName, outputFileName } from "@/lib/job-export";
import { createStoredZip } from "@/lib/zip";
import { blobsByPath } from "./state";
import { outputsForJob, rememberOutputBlob } from "./store";

export async function downloadBlob(path: string, fileName: (blob: Blob) => string) {
  const blob = await blobForPath(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName(blob);
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

export async function blobForPath(path: string) {
  let blob = blobsByPath.get(path);
  if (!blob) {
    const [jobId, index] = path
      .replace("browser://jobs/", "")
      .split("/outputs/");
    const output = (await outputsForJob(jobId)).find(
      (item) => item.index === Number(index),
    );
    blob = output?.blob;
    if (output) rememberOutputBlob(output);
  }
  if (!blob) throw new Error("没有找到可下载的图片。");
  return blob;
}

export async function downloadJobZip(job: Job) {
  const paths = jobOutputPaths(job);
  if (paths.length === 0) throw new Error("没有可下载的图片。");
  const baseName = jobExportBaseName(job);
  const entries = await Promise.all(
    paths.map(async (path, index) => ({
      name: `${baseName}/${outputFileName(path, index)}`,
      data: await blobForPath(path),
    })),
  );
  const zip = await createStoredZip(entries);
  const url = URL.createObjectURL(zip);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${baseName}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
  return [`${baseName}.zip`];
}
