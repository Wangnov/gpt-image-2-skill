import type {
  GenerateRequest,
  Job,
  JobError,
  OutputRef,
  QueueStatus,
} from "../../types";
import { normalizeJobResponse, outputPaths } from "../shared";
import { isActiveJobStatus } from "../types";
import { appendEvent, nowIso } from "./events";
import {
  getStoredProvider,
  requireApiKey,
  selectedProviderName,
} from "./config";
import {
  cloneGenerateRequest,
  runEditRequest,
  runGenerationRequest,
} from "./openai";
import type { AsyncImageTask } from "./state";
import { deleteDatabase, readStoredJobs, storeOutput, writeJob } from "./store";
import {
  dbPromise,
  eventLog,
  blobsByPath,
  jobSubscribers,
  maxParallel,
  nextSeq,
  objectUrls,
  prepared,
  queue,
  running,
  setMaxParallel,
  setPrepared,
  updateSubscribers,
} from "./state";
import type { BrowserQueuedTask } from "./state";

type BrowserBatchError = {
  index: number;
  message: string;
};

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function batchErrorMessage(errors: BrowserBatchError[]) {
  if (errors.length === 0) return "";
  if (errors.length === 1) return errors[0].message;
  return `${errors.length} 个子任务失败：${errors[0].message}`;
}

async function updateAsyncTask(
  task: BrowserQueuedTask,
  asyncTask: AsyncImageTask,
  index?: number,
) {
  const metadata = { ...task.job.metadata };
  if (index === undefined) {
    metadata.async_task = asyncTask;
  } else {
    const tasks = Array.isArray(metadata.async_tasks)
      ? ([...metadata.async_tasks] as (AsyncImageTask | undefined)[])
      : [];
    tasks[index] = asyncTask;
    metadata.async_tasks = tasks;
  }
  task.job = {
    ...task.job,
    metadata,
    updated_at: nowIso(),
  };
  await writeJob(task.job);
  appendEvent(task.job.id, "job.async_task", {
    index: index ?? null,
    async_task: asyncTask,
    job: task.job,
  });
}

function activeRemoteTask(job: Job) {
  const tasks = [
    job.metadata?.async_task,
    ...(Array.isArray(job.metadata?.async_tasks)
      ? job.metadata.async_tasks
      : []),
  ] as (AsyncImageTask | undefined)[];
  return tasks.find(
    (task) =>
      task &&
      !["completed", "failed", "cancelled", "expired"].includes(task.status),
  );
}

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

export async function completeTask(
  task: BrowserQueuedTask,
  outputs: OutputRef[],
) {
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

export async function completePartialTask(
  task: BrowserQueuedTask,
  outputs: OutputRef[],
  errors: BrowserBatchError[],
) {
  const message = batchErrorMessage(errors);
  const partial = {
    ...task.job,
    status: "partial_failed" as const,
    updated_at: nowIso(),
    outputs,
    output_path: outputs[0]?.path,
    metadata: {
      ...task.job.metadata,
      output: {
        path: outputs[0]?.path ?? null,
        files: outputs,
      },
      batch: {
        request_count:
          typeof task.job.metadata.n === "number"
            ? task.job.metadata.n
            : outputs.length + errors.length,
        success_count: outputs.length,
        failure_count: errors.length,
        errors,
      },
    },
    error: {
      code: "batch_partial_failed",
      message,
      items: errors,
    },
  };
  await writeJob(partial);
  appendEvent(task.job.id, "job.partial_failed", {
    status: "partial_failed",
    output: { path: outputs[0]?.path, files: outputs },
    error: partial.error,
    job: partial,
  });
}

export async function failTask(task: BrowserQueuedTask, error: unknown) {
  const aborted = task.cancelled || task.abort.signal.aborted;
  const remoteTask = aborted ? activeRemoteTask(task.job) : undefined;
  const message = aborted
    ? remoteTask
      ? `已停止本地轮询；远端任务可能仍在运行。任务 ID：${remoteTask.task_id}`
      : "任务已取消。"
    : error instanceof Error
      ? error.message
      : String(error);
  // Preserve the structured shape (code/message/detail/items) for thrown batch
  // errors and any object that already carries a JobError-like payload, so the
  // failed card and "复制完整错误" surface the real cause; otherwise fall back to
  // a bare `{ message }`.
  const structured =
    !aborted && error && typeof error === "object"
      ? (error as Partial<JobError>)
      : null;
  const jobError: JobError =
    structured && (structured.items || structured.detail || structured.code)
      ? {
          code: structured.code,
          message:
            typeof structured.message === "string"
              ? structured.message
              : message,
          detail: structured.detail,
          items: structured.items,
        }
      : { message };
  const failed = {
    ...task.job,
    status: aborted ? ("cancelled" as const) : ("failed" as const),
    updated_at: nowIso(),
    error: jobError,
  };
  await writeJob(failed);
  appendEvent(task.job.id, aborted ? "job.cancelled" : "job.failed", {
    status: failed.status,
    error: failed.error,
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
    const result = await runGenerationRequest(
      request,
      provider,
      apiKey,
      provider.supports_n ? planned : undefined,
      task.abort.signal,
      (asyncTask) => updateAsyncTask(task, asyncTask),
    );
    await saveBlobOutputs(task, result.blobs, partials);
  } else {
    const errors: BrowserBatchError[] = [];
    await Promise.all(
      Array.from({ length: planned }).map(async (_, index) => {
        try {
          const result = await runGenerationRequest(
            request,
            provider,
            apiKey,
            undefined,
            task.abort.signal,
            (asyncTask) => updateAsyncTask(task, asyncTask, index),
          );
          await saveBlobOutputs(
            task,
            result.blobs.slice(0, 1),
            partials,
            index,
          );
        } catch (error) {
          errors.push({ index, message: errorText(error) });
        }
      }),
    );
    if (errors.length > 0) {
      errors.sort((a, b) => a.index - b.index);
      if (partials.length > 0) {
        await completePartialTask(task, partials, errors);
        return;
      }
      throw {
        code: "batch_failed",
        message: batchErrorMessage(errors),
        items: errors,
      };
    }
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
    const result = await runEditRequest(
      form,
      provider,
      apiKey,
      provider.supports_n ? planned : undefined,
      task.abort.signal,
      (asyncTask) => updateAsyncTask(task, asyncTask),
    );
    await saveBlobOutputs(task, result.blobs, partials);
  } else {
    const errors: BrowserBatchError[] = [];
    await Promise.all(
      Array.from({ length: planned }).map(async (_, index) => {
        try {
          const result = await runEditRequest(
            form,
            provider,
            apiKey,
            undefined,
            task.abort.signal,
            (asyncTask) => updateAsyncTask(task, asyncTask, index),
          );
          await saveBlobOutputs(
            task,
            result.blobs.slice(0, 1),
            partials,
            index,
          );
        } catch (error) {
          errors.push({ index, message: errorText(error) });
        }
      }),
    );
    if (errors.length > 0) {
      errors.sort((a, b) => a.index - b.index);
      if (partials.length > 0) {
        await completePartialTask(task, partials, errors);
        return;
      }
      throw {
        code: "batch_failed",
        message: batchErrorMessage(errors),
        items: errors,
      };
    }
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

export async function enqueueBrowserTask(
  job: Job,
  run: BrowserQueuedTask["run"],
) {
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
  const interrupted = jobs.filter((job) => isActiveJobStatus(job.status));
  for (const job of interrupted) {
    const remoteTask = activeRemoteTask(job);
    await writeJob({
      ...job,
      status: "failed",
      updated_at: nowIso(),
      error: {
        message: remoteTask
          ? `页面刷新或关闭后，本地轮询已中断；远端任务可能仍在运行。任务 ID：${remoteTask.task_id}`
          : "页面刷新或关闭，浏览器任务已中断。",
      },
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
