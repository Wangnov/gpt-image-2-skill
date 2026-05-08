import type { GenerateRequest, Job, OutputRef, ServerConfig } from "../../types";
import { defaultNotificationConfig, defaultPathConfig, defaultStorageConfig, normalizeConfig, normalizeJob, outputPaths, rememberJobOutputs } from "../shared";
import type { JobListOptions, JobListPage } from "../types";
import { isActiveJobStatus } from "../types";
import { CONFIG_KEY, DB_NAME, DB_VERSION, blobsByPath, dbPromise, objectUrls } from "./state";
import type { KvRecord, StoredJobInput, StoredOutput } from "./state";

export function deleteDatabase() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

export function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function transactionDone(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}

export function openDb() {
  if (!dbPromise.current) {
    dbPromise.current = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("kv")) {
          db.createObjectStore("kv", { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains("jobs")) {
          db.createObjectStore("jobs", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("outputs")) {
          const outputs = db.createObjectStore("outputs", { keyPath: "key" });
          outputs.createIndex("jobId", "jobId", { unique: false });
        }
        if (!db.objectStoreNames.contains("jobInputs")) {
          db.createObjectStore("jobInputs", { keyPath: "jobId" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise.current;
}

export async function readConfigRecord() {
  const db = await openDb();
  const tx = db.transaction("kv", "readonly");
  const record = await requestToPromise<KvRecord<ServerConfig> | undefined>(
    tx.objectStore("kv").get(CONFIG_KEY),
  );
  return normalizeConfig(
    record?.value ?? {
      version: 1,
      providers: {},
      notifications: defaultNotificationConfig(),
      storage: defaultStorageConfig(),
      paths: defaultPathConfig(),
    },
  );
}

export async function writeStoredConfig(config: ServerConfig) {
  const db = await openDb();
  const tx = db.transaction("kv", "readwrite");
  tx.objectStore("kv").put({ key: CONFIG_KEY, value: config });
  await transactionDone(tx);
}

export async function readStoredJob(id: string) {
  const db = await openDb();
  const tx = db.transaction("jobs", "readonly");
  const raw = await requestToPromise<Record<string, unknown> | undefined>(
    tx.objectStore("jobs").get(id),
  );
  return raw ? normalizeJob(raw) : undefined;
}

export function jobTimestamp(job: Job) {
  const raw = job.created_at || job.updated_at || "";
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && raw.trim() !== "") return numeric * 1000;
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function compareJobsDesc(a: Job, b: Job) {
  const delta = jobTimestamp(b) - jobTimestamp(a);
  return delta === 0 ? b.id.localeCompare(a.id) : delta;
}

export function mergeJobsById(jobs: Job[]) {
  const byId = new Map<string, Job>();
  for (const job of jobs) byId.set(job.id, job);
  return Array.from(byId.values()).sort(compareJobsDesc);
}

export function jobCursor(job: Job) {
  return `${job.created_at}|${job.id}`;
}

export function jobMatchesQuery(job: Job, query?: string) {
  const needle = query?.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    job.id,
    job.command,
    job.provider,
    job.output_path ?? "",
    JSON.stringify(job.metadata ?? {}),
    JSON.stringify(job.error ?? {}),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

export function filterJobs(
  jobs: Job[],
  filter: JobListOptions["filter"],
  query?: string,
) {
  let filtered = jobs;
  if (filter === "running") {
    filtered = filtered.filter((job) => isActiveJobStatus(job.status));
  }
  if (filter === "completed") {
    filtered = filtered.filter((job) => job.status === "completed");
  }
  if (filter === "failed") {
    filtered = filtered.filter(
      (job) => job.status === "failed" || job.status === "cancelled",
    );
  }
  return filtered.filter((job) => jobMatchesQuery(job, query));
}

export async function readStoredJobs() {
  const db = await openDb();
  const tx = db.transaction("jobs", "readonly");
  const rows = await requestToPromise<Record<string, unknown>[]>(
    tx.objectStore("jobs").getAll(),
  );
  return rows.map(normalizeJob).sort(compareJobsDesc);
}

export async function readStoredJobsPage(options: JobListOptions = {}) {
  const limit = Math.max(1, Math.min(200, Math.floor(options.limit ?? 100)));
  const jobs = filterJobs(
    await readStoredJobs(),
    options.filter,
    options.query,
  );
  const start = options.cursor
    ? jobs.findIndex((job) => jobCursor(job) === options.cursor) + 1
    : 0;
  const offset = start > 0 ? start : 0;
  const page = jobs.slice(offset, offset + limit);
  const hasMore = offset + limit < jobs.length;
  return {
    jobs: page,
    next_cursor: hasMore ? jobCursor(page[page.length - 1]) : null,
    has_more: hasMore,
    total: jobs.length,
  } satisfies JobListPage;
}

export async function writeJob(job: Job) {
  const db = await openDb();
  const tx = db.transaction("jobs", "readwrite");
  tx.objectStore("jobs").put(job);
  await transactionDone(tx);
  rememberJobOutputs(job);
}

export async function readJobInput(jobId: string) {
  const db = await openDb();
  const tx = db.transaction("jobInputs", "readonly");
  return requestToPromise<StoredJobInput | undefined>(
    tx.objectStore("jobInputs").get(jobId),
  );
}

export async function writeJobInput(input: StoredJobInput) {
  const db = await openDb();
  const tx = db.transaction("jobInputs", "readwrite");
  tx.objectStore("jobInputs").put(input);
  await transactionDone(tx);
}

export async function deleteJobInput(jobId: string) {
  const db = await openDb();
  const tx = db.transaction("jobInputs", "readwrite");
  tx.objectStore("jobInputs").delete(jobId);
  await transactionDone(tx);
}

export async function outputsForJob(jobId: string) {
  const db = await openDb();
  const tx = db.transaction("outputs", "readonly");
  const index = tx.objectStore("outputs").index("jobId");
  return requestToPromise<StoredOutput[]>(index.getAll(jobId));
}

export async function storeOutput(jobId: string, index: number, blob: Blob) {
  const path = `browser://jobs/${jobId}/outputs/${index}`;
  const output: StoredOutput = {
    key: `${jobId}:${index}`,
    jobId,
    index,
    path,
    blob,
    bytes: blob.size,
  };
  const db = await openDb();
  const tx = db.transaction("outputs", "readwrite");
  tx.objectStore("outputs").put(output);
  await transactionDone(tx);
  rememberOutputBlob(output);
  return { index, path, bytes: blob.size } satisfies OutputRef;
}

export async function deleteOutputsForJob(jobId: string) {
  const outputs = await outputsForJob(jobId);
  const db = await openDb();
  const tx = db.transaction("outputs", "readwrite");
  for (const output of outputs) {
    tx.objectStore("outputs").delete(output.key);
    const url = objectUrls.get(output.path);
    if (url) URL.revokeObjectURL(url);
    objectUrls.delete(output.path);
    blobsByPath.delete(output.path);
    outputPaths.delete(`${jobId}:${output.index}`);
  }
  await transactionDone(tx);
}

export function rememberOutputBlob(output: StoredOutput) {
  blobsByPath.set(output.path, output.blob);
  outputPaths.set(`${output.jobId}:${output.index}`, output.path);
  if (!objectUrls.has(output.path)) {
    objectUrls.set(output.path, URL.createObjectURL(output.blob));
  }
}

export async function hydrateJobOutputs(job: Job) {
  const stored = await outputsForJob(job.id);
  stored.forEach(rememberOutputBlob);
  rememberJobOutputs(job);
  return job;
}
