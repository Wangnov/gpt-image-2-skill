import type { Job, JobEvent } from "../../types";
import { normalizeJob, rememberJobOutputs } from "../shared";
import type { JobListOptions, JobListPage } from "../types";
import { requestJson } from "./client";

function jobTimestamp(job: Job) {
  const raw = job.created_at || job.updated_at || "";
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && raw.trim() !== "") return numeric * 1000;
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function mergeJobsById(jobs: Job[]) {
  const byId = new Map<string, Job>();
  for (const job of jobs) byId.set(job.id, job);
  return Array.from(byId.values()).sort(
    (a, b) => jobTimestamp(b) - jobTimestamp(a),
  );
}

export function jobsQuery(options: JobListOptions = {}) {
  const params = new URLSearchParams();
  if (options.limit) params.set("limit", String(options.limit));
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.filter && options.filter !== "all") {
    params.set("status", options.filter);
  }
  if (options.query?.trim()) params.set("q", options.query.trim());
  const query = params.toString();
  return query ? `/jobs?${query}` : "/jobs";
}

export async function listJobsPage(options: JobListOptions = {}) {
  const payload = await requestJson<{
    jobs: Record<string, unknown>[];
    next_cursor?: string | null;
    has_more?: boolean;
    total?: number;
  }>(jobsQuery(options));
  return {
    jobs: (payload.jobs ?? []).map(normalizeJob),
    next_cursor: payload.next_cursor ?? null,
    has_more: Boolean(payload.has_more),
    total: Number(payload.total ?? payload.jobs?.length ?? 0),
  } satisfies JobListPage;
}

export function rememberEventJob(event: JobEvent) {
  const job = event.data?.job;
  if (job && typeof job === "object") {
    rememberJobOutputs(normalizeJob(job as Record<string, unknown>));
  }
}

export function jobUpdateSignature(job: Job) {
  const uploadState = job.outputs
    .map((output) =>
      [
        output.index,
        ...(output.uploads ?? []).map((upload) =>
          [
            upload.target,
            upload.status,
            upload.updated_at ?? "",
            upload.url ?? "",
            upload.error ?? "",
          ].join("|"),
        ),
      ].join(":"),
    )
    .join(";");
  return [
    job.status,
    job.updated_at,
    job.storage_status ?? "",
    job.outputs.length,
    job.output_path ?? "",
    uploadState,
  ].join(":");
}
