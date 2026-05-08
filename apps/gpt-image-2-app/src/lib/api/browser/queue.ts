import type { GenerateRequest, Job, OutputRef, QueueStatus } from "../../types";
import { normalizeJobResponse, outputPaths } from "../shared";
import { isActiveJobStatus } from "../types";
import { appendEvent, nowIso } from "./events";
import { getStoredProvider, requireApiKey, selectedProviderName } from "./config";
import { cloneGenerateRequest, runEditRequest, runGenerationRequest } from "./openai";
import { deleteDatabase, readStoredJobs, storeOutput, writeJob } from "./store";
import { dbPromise, eventLog, blobsByPath, jobSubscribers, maxParallel, nextSeq, objectUrls, prepared, queue, running, setMaxParallel, setPrepared, updateSubscribers } from "./state";
import type { BrowserQueuedTask } from "./state";

export async function storagePressureWarning() {
  const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
  if (!estimate?.usage || !estimate.quota) return undefined;
  const ratio = estimate.usage / estimate.quota;
  if (ratio < 0.8) return undefined;
  return {
    usage: estimate.usage,
    quota: estimate.quota,
    message: "当前浏览器数据空间接近上限，请清理历史或导出图片。",
  };
}

export async function saveBlobOutputs(
  task: BrowserQueuedTask,
  blobs: Blob[],
  partials: OutputRef[],
  startIndex = partials.length,
) {
  const saved: OutputRef[] = [];
  for (const [offset, blob] of blobs.entries()) {
    const output = await storeOutput(task.job.id, startIndex + offset, blob);
    partials.push(output);
    partials.sort((a, b) => a.index - b.index);
    saved.push(output);
    const partialJob = {
      ...task.job,
      status: "running" as const,
      updated_at: nowIso(),
      outputs: [...partials],
      output_path: partials[0]?.path,
    };
    await writeJob(partialJob);
    appendEvent(task.job.id, "job.output_ready", {
      index: output.index,
      path: output.path,
      output: { path: output.path },
      job: partialJob,
    });
  }
  const pressure = await storagePressureWarning();
  if (pressure) {
    appendEvent(task.job.id, "storage.quota_warning", pressure);
  }
  return saved;
}

export async function completeTask(task: BrowserQueuedTask, outputs: OutputRef[]) {
  const completed = {
    ...task.job,
    status: "completed" as const,
    updated_at: nowIso(),
    outputs,
    output_path: outputs[0]?.path,
    metadata: {
      ...task.job.metadata,
      output: {
        path: outputs[0]?.path ?? null,
        files: outputs,
      },
    },
  };
  await writeJob(completed);
  appendEvent(task.job.id, "job.completed", {
    status: "completed",
    output: { path: outputs[0]?.path, files: outputs },
    job: completed,
  });
}

export async function failTask(task: BrowserQueuedTask, error: unknown) {
  const aborted = task.cancelled || task.abort.signal.aborted;
  const message = aborted
    ? "任务已取消。"
    : error instanceof Error
      ? error.message
      : String(error);
  const failed = {
    ...task.job,
    status: aborted ? ("cancelled" as const) : ("failed" as const),
    updated_at: nowIso(),
    error: { message },
  };
  await writeJob(failed);
  appendEvent(task.job.id, aborted ? "job.cancelled" : "job.failed", {
    status: failed.status,
    error: { message },
    job: failed,
  });
}

export async function runGenerateTask(
  task: BrowserQueuedTask,
  request: GenerateRequest,
) {
  const providerName = selectedProviderName(request.provider);
  const provider = await getStoredProvider(providerName);
  const apiKey = requireApiKey(providerName, provider);
  const planned = Math.max(1, Math.min(16, Math.floor(request.n ?? 1)));
  const partials: OutputRef[] = [];
  if (provider.supports_n || planned === 1) {
    const blobs = await runGenerationRequest(
      request,
      provider,
      apiKey,
      provider.supports_n ? planned : undefined,
      task.abort.signal,
    );
    await saveBlobOutputs(task, blobs, partials);
  } else {
    await Promise.all(
      Array.from({ length: planned }).map(async (_, index) => {
        const blobs = await runGenerationRequest(
          request,
          provider,
          apiKey,
          undefined,
          task.abort.signal,
        );
        await saveBlobOutputs(task, blobs.slice(0, 1), partials, index);
      }),
    );
  }
  await completeTask(task, partials);
}

export async function runEditTask(task: BrowserQueuedTask, form: FormData) {
  const metaRaw = form.get("meta");
  const meta =
    typeof metaRaw === "string"
      ? (JSON.parse(metaRaw) as Record<string, unknown>)
      : {};
  const providerName = selectedProviderName(String(meta.provider ?? ""));
  const provider = await getStoredProvider(providerName);
  const apiKey = requireApiKey(providerName, provider);
  const planned = Math.max(1, Math.min(16, Math.floor(Number(meta.n) || 1)));
  const partials: OutputRef[] = [];
  if (provider.supports_n || planned === 1) {
    const blobs = await runEditRequest(
      form,
      provider,
      apiKey,
      provider.supports_n ? planned : undefined,
      task.abort.signal,
    );
    await saveBlobOutputs(task, blobs, partials);
  } else {
    await Promise.all(
      Array.from({ length: planned }).map(async (_, index) => {
        const blobs = await runEditRequest(
          form,
          provider,
          apiKey,
          undefined,
          task.abort.signal,
        );
        await saveBlobOutputs(task, blobs.slice(0, 1), partials, index);
      }),
    );
  }
  await completeTask(task, partials);
}

export function queueSnapshot(): QueueStatus {
  return {
    max_parallel: maxParallel,
    running: running.size,
    queued: queue.length,
    queued_job_ids: queue.map((task) => task.job.id),
  };
}

export async function startQueuedJobs() {
  while (running.size < maxParallel && queue.length > 0) {
    const task = queue.shift()!;
    running.set(task.job.id, task);
    const runningJob = {
      ...task.job,
      status: "running" as const,
      updated_at: nowIso(),
    };
    task.job = runningJob;
    await writeJob(runningJob);
    appendEvent(task.job.id, "job.running", {
      status: "running",
      job: runningJob,
    });
    void task
      .run(task)
      .catch((error) => failTask(task, error))
      .finally(() => {
        running.delete(task.job.id);
        void startQueuedJobs();
      });
  }
}

export async function enqueueBrowserTask(job: Job, run: BrowserQueuedTask["run"]) {
  await prepareBrowserRuntime();
  await writeJob(job);
  const task: BrowserQueuedTask = {
    job,
    abort: new AbortController(),
    cancelled: false,
    run,
  };
  queue.push(task);
  const event = appendEvent(job.id, "job.queued", {
    status: "queued",
    position: queue.length,
    job,
  });
  void startQueuedJobs();
  return normalizeJobResponse({
    job_id: job.id,
    job,
    events: [event],
    queue: queueSnapshot(),
    queued: true,
  });
}

export function browserJobId() {
  return `web-${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
}

export async function markInterruptedJobs() {
  const jobs = await readStoredJobs();
  const interrupted = jobs.filter(
    (job) => isActiveJobStatus(job.status),
  );
  for (const job of interrupted) {
    await writeJob({
      ...job,
      status: "failed",
      updated_at: nowIso(),
      error: { message: "页面刷新或关闭，浏览器任务已中断。" },
    });
  }
}

export function installBeforeUnloadGuard() {
  window.addEventListener("beforeunload", (event) => {
    if (queue.length === 0 && running.size === 0) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

export function prepareBrowserRuntime() {
  if (!prepared) {
    setPrepared(markInterruptedJobs().then(installBeforeUnloadGuard));
  }
  return prepared;
}

export async function __resetBrowserApiForTests() {
  queue.splice(0, queue.length);
  for (const task of running.values()) {
    task.cancelled = true;
    task.abort.abort();
  }
  running.clear();
  eventLog.clear();
  nextSeq.clear();
  jobSubscribers.clear();
  updateSubscribers.clear();
  for (const url of objectUrls.values()) URL.revokeObjectURL(url);
  objectUrls.clear();
  blobsByPath.clear();
  outputPaths.clear();
  setMaxParallel(2);
  setPrepared(null);
  const db = await dbPromise.current?.catch(() => null);
  db?.close();
  dbPromise.current = null;
  await deleteDatabase();
}
