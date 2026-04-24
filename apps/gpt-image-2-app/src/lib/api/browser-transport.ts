import type {
  GenerateRequest,
  Job,
  JobEvent,
  OutputRef,
  ProviderConfig,
  QueueStatus,
  ServerConfig,
  TestProviderResult,
} from "../types";
import {
  jobOutputPath,
  jobOutputPaths,
  normalizeConfig,
  normalizeJob,
  normalizeJobResponse,
  outputPath,
  outputPaths,
  rememberJobOutputs,
} from "./shared";
import type {
  ApiClient,
  ConfigPaths,
  EventHandler,
  JobUpdateHandler,
  TauriJobResponse,
} from "./types";
import { isTerminalJobStatus } from "./types";

const DB_NAME = "gpt-image-2-web";
const DB_VERSION = 1;
const CONFIG_KEY = "config";
const CORS_MESSAGE =
  "该服务商不允许浏览器直连，请改用 Docker/App，或换一个允许 CORS 的服务地址。";

type KvRecord<T = unknown> = {
  key: string;
  value: T;
};

type StoredOutput = {
  key: string;
  jobId: string;
  index: number;
  path: string;
  blob: Blob;
  bytes: number;
};

type BrowserQueuedTask = {
  job: Job;
  abort: AbortController;
  cancelled: boolean;
  run: (task: BrowserQueuedTask) => Promise<void>;
};

type OpenAiImageItem = {
  b64_json?: string;
  url?: string;
  revised_prompt?: string;
};

type OpenAiImagePayload = {
  data?: OpenAiImageItem[];
  created?: number;
  error?: { message?: string };
};

const dbPromise = { current: null as Promise<IDBDatabase> | null };
const objectUrls = new Map<string, string>();
const blobsByPath = new Map<string, Blob>();
const eventLog = new Map<string, JobEvent[]>();
const nextSeq = new Map<string, number>();
const jobSubscribers = new Map<string, Set<EventHandler>>();
const updateSubscribers = new Set<JobUpdateHandler>();
const queue: BrowserQueuedTask[] = [];
const running = new Map<string, BrowserQueuedTask>();
let maxParallel = 2;
let prepared: Promise<void> | null = null;

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}

function openDb() {
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
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise.current;
}

async function readConfigRecord() {
  const db = await openDb();
  const tx = db.transaction("kv", "readonly");
  const record = await requestToPromise<KvRecord<ServerConfig> | undefined>(
    tx.objectStore("kv").get(CONFIG_KEY),
  );
  return record?.value ?? ({ version: 1, providers: {} } satisfies ServerConfig);
}

async function writeStoredConfig(config: ServerConfig) {
  const db = await openDb();
  const tx = db.transaction("kv", "readwrite");
  tx.objectStore("kv").put({ key: CONFIG_KEY, value: config });
  await transactionDone(tx);
}

async function readStoredJob(id: string) {
  const db = await openDb();
  const tx = db.transaction("jobs", "readonly");
  const raw = await requestToPromise<Record<string, unknown> | undefined>(
    tx.objectStore("jobs").get(id),
  );
  return raw ? normalizeJob(raw) : undefined;
}

async function readStoredJobs() {
  const db = await openDb();
  const tx = db.transaction("jobs", "readonly");
  const rows = await requestToPromise<Record<string, unknown>[]>(
    tx.objectStore("jobs").getAll(),
  );
  return rows
    .map(normalizeJob)
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
}

async function writeJob(job: Job) {
  const db = await openDb();
  const tx = db.transaction("jobs", "readwrite");
  tx.objectStore("jobs").put(job);
  await transactionDone(tx);
  rememberJobOutputs(job);
}

async function outputsForJob(jobId: string) {
  const db = await openDb();
  const tx = db.transaction("outputs", "readonly");
  const index = tx.objectStore("outputs").index("jobId");
  return requestToPromise<StoredOutput[]>(index.getAll(jobId));
}

async function storeOutput(jobId: string, index: number, blob: Blob) {
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

async function deleteOutputsForJob(jobId: string) {
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

function rememberOutputBlob(output: StoredOutput) {
  blobsByPath.set(output.path, output.blob);
  outputPaths.set(`${output.jobId}:${output.index}`, output.path);
  if (!objectUrls.has(output.path)) {
    objectUrls.set(output.path, URL.createObjectURL(output.blob));
  }
}

async function hydrateJobOutputs(job: Job) {
  const stored = await outputsForJob(job.id);
  stored.forEach(rememberOutputBlob);
  rememberJobOutputs(job);
  return job;
}

function nowIso() {
  return new Date().toISOString();
}

function appendEvent(
  jobId: string,
  type: string,
  data: JobEvent["data"],
  kind: JobEvent["kind"] = "local",
) {
  const seq = (nextSeq.get(jobId) ?? 0) + 1;
  nextSeq.set(jobId, seq);
  const event: JobEvent = { seq, kind, type, data };
  const events = eventLog.get(jobId) ?? [];
  events.push(event);
  if (events.length > 200) events.shift();
  eventLog.set(jobId, events);
  jobSubscribers.get(jobId)?.forEach((handler) => handler(event));
  updateSubscribers.forEach((handler) => handler(jobId, event));
  return event;
}

function sanitizeCredential(credential: ProviderConfig["credentials"][string]) {
  if (credential.source === "file") {
    return {
      source: "file" as const,
      present: Boolean(
        credential.present ||
          (typeof credential.value === "string" && credential.value.length > 0),
      ),
    };
  }
  const { value: _value, ...rest } = credential;
  return rest;
}

function browserConfigForUi(config: ServerConfig): ServerConfig {
  const providers = Object.fromEntries(
    Object.entries(config.providers ?? {}).map(([name, provider]) => [
      name,
      {
        ...provider,
        credentials: Object.fromEntries(
          Object.entries(provider.credentials ?? {}).map(([key, credential]) => [
            key,
            sanitizeCredential(credential),
          ]),
        ),
      },
    ]),
  );
  providers.codex = {
    type: "codex",
    model: "gpt-5.4",
    credentials: {},
    builtin: true,
    disabled: true,
    disabled_reason: "静态 Web 不能读取 Codex 登录态，请使用桌面 App 或 Docker。",
  };
  const defaultProvider =
    config.default_provider && providers[config.default_provider]?.disabled !== true
      ? config.default_provider
      : Object.entries(providers).find(([, provider]) => !provider.disabled)?.[0];
  return normalizeConfig({
    version: 1,
    default_provider: defaultProvider,
    providers,
  });
}

function browserStoredConfig(config: ServerConfig): ServerConfig {
  const { codex: _codex, ...providers } = config.providers ?? {};
  return {
    version: 1,
    default_provider:
      config.default_provider && providers[config.default_provider]
        ? config.default_provider
        : Object.keys(providers)[0],
    providers,
  };
}

async function getStoredProvider(name: string) {
  const config = await readConfigRecord();
  const provider = config.providers[name];
  if (!provider || provider.disabled) {
    throw new Error(
      name === "codex"
        ? "静态 Web 不能使用 Codex 凭证，请改用桌面 App 或 Docker。"
        : `Unknown provider: ${name}`,
    );
  }
  return provider;
}

function requireApiKey(name: string, provider: ProviderConfig) {
  const credential = provider.credentials.api_key;
  if (!credential) throw new Error(`凭证「${name}」缺少 API Key。`);
  if (credential.source !== "file") {
    throw new Error("静态 Web 只支持保存在浏览器本地的 API Key。");
  }
  if (typeof credential.value !== "string" || !credential.value.trim()) {
    throw new Error(`凭证「${name}」的 API Key 为空。`);
  }
  return credential.value.trim();
}

function selectedProviderName(provider?: string) {
  return provider && provider.trim() ? provider : "";
}

function endpointFor(provider: ProviderConfig, path: string) {
  const base = provider.api_base?.trim().replace(/\/+$/, "");
  if (!base) throw new Error("服务地址不能为空。");
  return `${base}${path}`;
}

function imageMime(format?: string) {
  if (format === "jpeg" || format === "jpg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return "image/png";
}

function imageExtensionFromBlob(blob: Blob) {
  if (blob.type === "image/jpeg") return "jpg";
  if (blob.type === "image/webp") return "webp";
  return "png";
}

function base64ToBlob(value: string, type: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type });
}

function isLikelyCorsError(error: unknown) {
  return error instanceof TypeError || String(error).includes("Failed to fetch");
}

function networkError(error: unknown, endpoint: string) {
  if (isLikelyCorsError(error)) {
    return new Error(`${CORS_MESSAGE}\n${endpoint}`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

async function parseErrorResponse(response: Response) {
  const text = await response.text().catch(() => "");
  try {
    const json = JSON.parse(text) as OpenAiImagePayload;
    return json.error?.message || text || response.statusText;
  } catch {
    return text || response.statusText;
  }
}

function addJsonField(
  body: Record<string, unknown>,
  key: string,
  value: unknown,
) {
  if (value === undefined || value === null || value === "") return;
  body[key] = value;
}

async function fetchJson(
  endpoint: string,
  apiKey: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
) {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    throw networkError(error, endpoint);
  }
  if (!response.ok) {
    throw new Error(`${response.status} ${await parseErrorResponse(response)}`);
  }
  return (await response.json()) as OpenAiImagePayload;
}

async function fetchMultipart(
  endpoint: string,
  apiKey: string,
  form: FormData,
  signal: AbortSignal,
) {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      body: form,
      signal,
    });
  } catch (error) {
    throw networkError(error, endpoint);
  }
  if (!response.ok) {
    throw new Error(`${response.status} ${await parseErrorResponse(response)}`);
  }
  return (await response.json()) as OpenAiImagePayload;
}

async function blobFromImageItem(
  item: OpenAiImageItem,
  format: string | undefined,
  signal: AbortSignal,
) {
  if (item.b64_json) return base64ToBlob(item.b64_json, imageMime(format));
  if (!item.url) {
    throw new Error("图片接口没有返回 b64_json 或 url。");
  }
  try {
    const response = await fetch(item.url, { signal });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return await response.blob();
  } catch (error) {
    throw networkError(error, item.url);
  }
}

async function decodeImagePayload(
  payload: OpenAiImagePayload,
  format: string | undefined,
  signal: AbortSignal,
) {
  const items = payload.data ?? [];
  if (items.length === 0) {
    throw new Error("接口响应里没有生成图片。");
  }
  return Promise.all(items.map((item) => blobFromImageItem(item, format, signal)));
}

function generateBody(
  request: GenerateRequest,
  provider: ProviderConfig,
  n?: number,
) {
  const body: Record<string, unknown> = {
    model: provider.model || "gpt-image-2",
    prompt: request.prompt,
  };
  addJsonField(body, "size", request.size);
  addJsonField(body, "quality", request.quality);
  addJsonField(body, "background", request.background);
  addJsonField(body, "output_format", request.format);
  addJsonField(body, "output_compression", request.compression);
  addJsonField(body, "moderation", request.moderation);
  addJsonField(body, "n", n);
  return body;
}

async function runGenerationRequest(
  request: GenerateRequest,
  provider: ProviderConfig,
  apiKey: string,
  n: number | undefined,
  signal: AbortSignal,
) {
  const endpoint = endpointFor(provider, "/images/generations");
  const payload = await fetchJson(
    endpoint,
    apiKey,
    generateBody(request, provider, n),
    signal,
  );
  return decodeImagePayload(payload, request.format, signal);
}

function editBodyField(
  form: FormData,
  key: string,
  value: unknown,
) {
  if (value === undefined || value === null || value === "") return;
  form.append(key, String(value));
}

function sortedFiles(form: FormData, prefix: string) {
  return Array.from(form.entries())
    .filter(([key, value]) => key.startsWith(prefix) && value instanceof File)
    .sort(([a], [b]) => a.localeCompare(b)) as [string, File][];
}

function buildEditForm(
  source: FormData,
  provider: ProviderConfig,
  n: number | undefined,
) {
  const metaRaw = source.get("meta");
  const meta =
    typeof metaRaw === "string"
      ? (JSON.parse(metaRaw) as Record<string, unknown>)
      : {};
  const form = new FormData();
  editBodyField(form, "model", provider.model || "gpt-image-2");
  editBodyField(form, "prompt", meta.prompt);
  editBodyField(form, "size", meta.size);
  editBodyField(form, "quality", meta.quality);
  editBodyField(form, "background", meta.background);
  editBodyField(form, "output_format", meta.format);
  editBodyField(form, "output_compression", meta.compression);
  editBodyField(form, "moderation", meta.moderation);
  editBodyField(form, "n", n);
  for (const [, file] of sortedFiles(source, "ref_")) {
    form.append("image[]", file, file.name);
  }
  const selectionHint = source.get("selection_hint");
  if (selectionHint instanceof File) {
    form.append("image[]", selectionHint, selectionHint.name);
  }
  const mask = source.get("mask");
  if (mask instanceof File) form.append("mask", mask, mask.name);
  return { form, meta };
}

async function runEditRequest(
  form: FormData,
  provider: ProviderConfig,
  apiKey: string,
  n: number | undefined,
  signal: AbortSignal,
) {
  const endpoint = endpointFor(provider, "/images/edits");
  const { form: editForm, meta } = buildEditForm(form, provider, n);
  const payload = await fetchMultipart(endpoint, apiKey, editForm, signal);
  return decodeImagePayload(payload, String(meta.format ?? "png"), signal);
}

async function storagePressureWarning() {
  const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
  if (!estimate?.usage || !estimate.quota) return undefined;
  const ratio = estimate.usage / estimate.quota;
  if (ratio < 0.8) return undefined;
  return {
    usage: estimate.usage,
    quota: estimate.quota,
    message: "浏览器本地存储空间接近上限，请清理历史或导出图片。",
  };
}

async function saveBlobOutputs(
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

async function completeTask(task: BrowserQueuedTask, outputs: OutputRef[]) {
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

async function failTask(task: BrowserQueuedTask, error: unknown) {
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

async function runGenerateTask(
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

async function runEditTask(task: BrowserQueuedTask, form: FormData) {
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

function queueSnapshot(): QueueStatus {
  return {
    max_parallel: maxParallel,
    running: running.size,
    queued: queue.length,
    queued_job_ids: queue.map((task) => task.job.id),
  };
}

async function startQueuedJobs() {
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
    appendEvent(task.job.id, "job.running", { status: "running", job: runningJob });
    void task
      .run(task)
      .catch((error) => failTask(task, error))
      .finally(() => {
        running.delete(task.job.id);
        void startQueuedJobs();
      });
  }
}

async function enqueueBrowserTask(
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

function browserJobId() {
  return `web-${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
}

async function markInterruptedJobs() {
  const jobs = await readStoredJobs();
  const interrupted = jobs.filter(
    (job) => job.status === "queued" || job.status === "running",
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

function installBeforeUnloadGuard() {
  window.addEventListener("beforeunload", (event) => {
    if (queue.length === 0 && running.size === 0) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

function prepareBrowserRuntime() {
  if (!prepared) {
    prepared = markInterruptedJobs().then(installBeforeUnloadGuard);
  }
  return prepared;
}

async function downloadBlob(path: string, fileName: (blob: Blob) => string) {
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
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName(blob);
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

export const browserApi: ApiClient = {
  kind: "browser",
  canUseLocalFiles: false,
  canRevealFiles: false,
  canUseSystemCredentials: false,
  canUseCodexProvider: false,
  canExportToDownloadsFolder: false,
  async getConfig() {
    await prepareBrowserRuntime();
    return browserConfigForUi(await readConfigRecord());
  },
  async configPaths(): Promise<ConfigPaths> {
    await prepareBrowserRuntime();
    return {
      config_dir: "IndexedDB: gpt-image-2-web",
      config_file: "IndexedDB: kv/config",
      history_file: "IndexedDB: jobs",
      jobs_dir: "IndexedDB: outputs",
    };
  },
  async setDefault(name: string) {
    await prepareBrowserRuntime();
    const config = await readConfigRecord();
    if (!config.providers[name]) throw new Error(`Unknown provider: ${name}`);
    config.default_provider = name;
    await writeStoredConfig(config);
    return browserConfigForUi(config);
  },
  async upsertProvider(name: string, cfg: ProviderConfig) {
    await prepareBrowserRuntime();
    const trimmed = name.trim();
    if (!trimmed) throw new Error("凭证名称不能为空。");
    if (trimmed === "codex" || cfg.type === "codex") {
      throw new Error("静态 Web 不能添加 Codex 凭证，请使用桌面 App 或 Docker。");
    }
    if (cfg.type !== "openai-compatible") {
      throw new Error("静态 Web 只支持 OpenAI-compatible API Key 凭证。");
    }
    const apiKey = cfg.credentials.api_key;
    if (!apiKey || apiKey.source !== "file") {
      throw new Error("静态 Web 只支持直接填写并保存在浏览器本地的 API Key。");
    }
    const config = await readConfigRecord();
    const existing = config.providers[trimmed];
    if (!cfg.allow_overwrite && existing) {
      throw new Error(`凭证「${trimmed}」已存在。`);
    }
    const preserved =
      typeof existing?.credentials.api_key?.value === "string"
        ? existing.credentials.api_key.value
        : "";
    const value =
      typeof apiKey.value === "string" && apiKey.value
        ? apiKey.value
        : preserved;
    if (!value) throw new Error("API Key 不能为空。");
    config.providers[trimmed] = {
      type: "openai-compatible",
      api_base: cfg.api_base || undefined,
      model: cfg.model || "gpt-image-2",
      supports_n: Boolean(cfg.supports_n),
      edit_region_mode: cfg.edit_region_mode ?? "reference-hint",
      credentials: { api_key: { source: "file", value } },
    };
    if (cfg.set_default || !config.default_provider) {
      config.default_provider = trimmed;
    }
    await writeStoredConfig(browserStoredConfig(config));
    return browserConfigForUi(config);
  },
  async revealProviderCredential(name: string, credential: string) {
    await prepareBrowserRuntime();
    const provider = await getStoredProvider(name);
    const ref = provider.credentials[credential];
    if (ref?.source !== "file" || typeof ref.value !== "string" || !ref.value) {
      throw new Error(`凭证「${name}」还没有保存可查看的密钥。`);
    }
    return { value: ref.value };
  },
  async deleteProvider(name: string) {
    await prepareBrowserRuntime();
    if (name === "codex") throw new Error("内置 Codex 提示不能删除。");
    const config = await readConfigRecord();
    delete config.providers[name];
    if (config.default_provider === name) {
      config.default_provider = Object.keys(config.providers)[0];
    }
    await writeStoredConfig(config);
    return browserConfigForUi(config);
  },
  async testProvider(name: string): Promise<TestProviderResult> {
    await prepareBrowserRuntime();
    const started = performance.now();
    const provider = await getStoredProvider(name);
    const apiKey = requireApiKey(name, provider);
    const endpoint = endpointFor(provider, "/models");
    try {
      const response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      });
      const latency_ms = Math.round(performance.now() - started);
      if (!response.ok) {
        return {
          ok: false,
          latency_ms,
          message: `${response.status} ${await parseErrorResponse(response)}`,
        };
      }
      return { ok: true, latency_ms, message: "连接正常" };
    } catch (error) {
      return {
        ok: false,
        latency_ms: Math.round(performance.now() - started),
        message: networkError(error, endpoint).message,
      };
    }
  },
  async listJobs() {
    await prepareBrowserRuntime();
    const jobs = await readStoredJobs();
    await Promise.all(jobs.map(hydrateJobOutputs));
    return jobs;
  },
  async getJob(id: string) {
    await prepareBrowserRuntime();
    const job = await readStoredJob(id);
    if (!job) throw new Error("History job was not found.");
    await hydrateJobOutputs(job);
    return { job, events: eventLog.get(id) ?? [] };
  },
  async deleteJob(id: string) {
    await prepareBrowserRuntime();
    const db = await openDb();
    const tx = db.transaction("jobs", "readwrite");
    tx.objectStore("jobs").delete(id);
    await transactionDone(tx);
    await deleteOutputsForJob(id);
    eventLog.delete(id);
    nextSeq.delete(id);
  },
  async cancelJob(id: string) {
    await prepareBrowserRuntime();
    const queuedIndex = queue.findIndex((task) => task.job.id === id);
    const task = queuedIndex >= 0 ? queue.splice(queuedIndex, 1)[0] : running.get(id);
    if (!task) throw new Error("Only queued or running browser jobs can be cancelled.");
    task.cancelled = true;
    task.abort.abort();
    if (queuedIndex >= 0) await failTask(task, new Error("任务已取消。"));
    const job = (await readStoredJob(id)) ?? task.job;
    return normalizeJobResponse({
      job_id: id,
      job,
      events: eventLog.get(id) ?? [],
      queue: queueSnapshot(),
      canceled: true,
    });
  },
  async queueStatus() {
    await prepareBrowserRuntime();
    return queueSnapshot();
  },
  async setQueueConcurrency(nextMaxParallel: number) {
    maxParallel = Math.min(8, Math.max(1, Math.round(nextMaxParallel)));
    void startQueuedJobs();
    return queueSnapshot();
  },
  async openPath(path: string) {
    const url = browserApi.fileUrl(path);
    if (!url) throw new Error("没有可打开的文件。");
    window.open(url, "_blank", "noopener,noreferrer");
  },
  async revealPath() {
    throw new Error("浏览器不能打开本机文件夹，请使用桌面 App 或 Docker。");
  },
  async exportFilesToDownloads(paths: string[]) {
    await prepareBrowserRuntime();
    const saved: string[] = [];
    for (const [index, path] of paths.entries()) {
      await downloadBlob(path, (blob) => {
        const ext = imageExtensionFromBlob(blob);
        return `gpt-image-2-${Date.now()}-${index + 1}.${ext}`;
      });
      saved.push(path);
    }
    return saved;
  },
  async createGenerate(body: GenerateRequest) {
    if (!body.prompt.trim()) throw new Error("Prompt is required.");
    const provider = selectedProviderName(body.provider);
    const job: Job = {
      id: browserJobId(),
      command: "images generate",
      provider,
      status: "queued",
      created_at: nowIso(),
      updated_at: nowIso(),
      metadata: { ...body },
      outputs: [],
      error: null,
    };
    return enqueueBrowserTask(job, (task) => runGenerateTask(task, body));
  },
  async createEdit(form: FormData) {
    const metaRaw = form.get("meta");
    const meta =
      typeof metaRaw === "string"
        ? (JSON.parse(metaRaw) as Record<string, unknown>)
        : {};
    if (!String(meta.prompt ?? "").trim()) throw new Error("Prompt is required.");
    if (sortedFiles(form, "ref_").length === 0) {
      throw new Error("At least one reference image is required.");
    }
    const provider = selectedProviderName(String(meta.provider ?? ""));
    const job: Job = {
      id: browserJobId(),
      command: "images edit",
      provider,
      status: "queued",
      created_at: nowIso(),
      updated_at: nowIso(),
      metadata: { ...meta, ref_count: sortedFiles(form, "ref_").length },
      outputs: [],
      error: null,
    };
    return enqueueBrowserTask(job, (task) => runEditTask(task, form));
  },
  outputUrl(jobId: string, index = 0) {
    const path = outputPath(jobId, index);
    return path ? browserApi.fileUrl(path) : "";
  },
  outputPath,
  fileUrl(path?: string | null) {
    if (!path) return "";
    if (!path.startsWith("browser://")) return path;
    return objectUrls.get(path) ?? "";
  },
  jobOutputUrl(job: Job, index = 0) {
    const path = jobOutputPath(job, index);
    return path ? browserApi.fileUrl(path) : "";
  },
  jobOutputPath,
  jobOutputPaths,
  subscribeJobEvents(jobId: string, onEvent: EventHandler, onDone?: () => void) {
    const handlers = jobSubscribers.get(jobId) ?? new Set<EventHandler>();
    const wrapped: EventHandler = (event) => {
      onEvent(event);
      if (event.kind === "local" && isTerminalJobStatus(event.type.slice(4))) {
        onDone?.();
      }
    };
    handlers.add(wrapped);
    jobSubscribers.set(jobId, handlers);
    for (const event of eventLog.get(jobId) ?? []) wrapped(event);
    return () => {
      handlers.delete(wrapped);
      if (handlers.size === 0) jobSubscribers.delete(jobId);
    };
  },
  subscribeJobUpdates(onEvent: JobUpdateHandler) {
    updateSubscribers.add(onEvent);
    return () => updateSubscribers.delete(onEvent);
  },
};
