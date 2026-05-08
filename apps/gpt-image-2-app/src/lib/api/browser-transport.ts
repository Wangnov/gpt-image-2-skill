import type {
  CredentialRef,
  GenerateRequest,
  Job,
  JobEvent,
  JobStatus,
  NotificationCapabilities,
  NotificationConfig,
  NotificationTestResult,
  OutputRef,
  PathConfig,
  ProviderConfig,
  QueueStatus,
  ServerConfig,
  StorageConfig,
  StorageTargetConfig,
  TestProviderResult,
} from "../types";
import {
  defaultNotificationConfig,
  defaultPathConfig,
  defaultStorageConfig,
  jobOutputPath,
  jobOutputPaths,
  normalizeConfig,
  normalizeNotificationConfig,
  normalizePathConfig,
  normalizeJob,
  normalizeJobResponse,
  normalizeStorageConfig,
  outputPath,
  outputPaths,
  rememberJobOutputs,
  storageTargetType,
} from "./shared";
import type {
  ApiClient,
  ConfigPaths,
  EventHandler,
  JobListOptions,
  JobListPage,
  JobUpdateHandler,
  TauriJobResponse,
} from "./types";
import { isActiveJobStatus, isTerminalJobStatus } from "./types";
import { jobExportBaseName, outputFileName } from "@/lib/job-export";
import { createStoredZip } from "@/lib/zip";

const DB_NAME = "gpt-image-2-web";
const DB_VERSION = 2;
const CONFIG_KEY = "config";
const CORS_MESSAGE =
  "该服务商不允许浏览器直连，且本站中转暂时不可用。请稍后重试，或改用 Docker/App。";

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

type StoredUpload = {
  key: string;
  name: string;
  type: string;
  blob: Blob;
};

type StoredJobInput =
  | {
      jobId: string;
      kind: "generate";
      request: GenerateRequest;
    }
  | {
      jobId: string;
      kind: "edit";
      meta: Record<string, unknown>;
      files: StoredUpload[];
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

function deleteDatabase() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

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

async function readConfigRecord() {
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

function jobTimestamp(job: Job) {
  const raw = job.created_at || job.updated_at || "";
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && raw.trim() !== "") return numeric * 1000;
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareJobsDesc(a: Job, b: Job) {
  const delta = jobTimestamp(b) - jobTimestamp(a);
  return delta === 0 ? b.id.localeCompare(a.id) : delta;
}

function mergeJobsById(jobs: Job[]) {
  const byId = new Map<string, Job>();
  for (const job of jobs) byId.set(job.id, job);
  return Array.from(byId.values()).sort(compareJobsDesc);
}

function jobCursor(job: Job) {
  return `${job.created_at}|${job.id}`;
}

function jobMatchesQuery(job: Job, query?: string) {
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

function filterJobs(
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

async function readStoredJobs() {
  const db = await openDb();
  const tx = db.transaction("jobs", "readonly");
  const rows = await requestToPromise<Record<string, unknown>[]>(
    tx.objectStore("jobs").getAll(),
  );
  return rows.map(normalizeJob).sort(compareJobsDesc);
}

async function readStoredJobsPage(options: JobListOptions = {}) {
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

async function writeJob(job: Job) {
  const db = await openDb();
  const tx = db.transaction("jobs", "readwrite");
  tx.objectStore("jobs").put(job);
  await transactionDone(tx);
  rememberJobOutputs(job);
}

async function readJobInput(jobId: string) {
  const db = await openDb();
  const tx = db.transaction("jobInputs", "readonly");
  return requestToPromise<StoredJobInput | undefined>(
    tx.objectStore("jobInputs").get(jobId),
  );
}

async function writeJobInput(input: StoredJobInput) {
  const db = await openDb();
  const tx = db.transaction("jobInputs", "readwrite");
  tx.objectStore("jobInputs").put(input);
  await transactionDone(tx);
}

async function deleteJobInput(jobId: string) {
  const db = await openDb();
  const tx = db.transaction("jobInputs", "readwrite");
  tx.objectStore("jobInputs").delete(jobId);
  await transactionDone(tx);
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

// Replace any inline file secret with an empty value, keeping the source so
// the editor still renders the right input shape. env / keychain credentials
// hold only references, so they pass through unchanged.
function scrubFileCredentialSecret<
  T extends NotificationConfig["email"]["password"],
>(credential: T): T {
  if (credential && credential.source === "file") {
    return { source: "file", value: "" } as unknown as T;
  }
  return credential;
}

function scrubStorageCredential(credential?: CredentialRef | null) {
  return scrubFileCredentialSecret(credential ?? null);
}

function scrubStorageTargetSecrets(
  target: StorageTargetConfig,
): StorageTargetConfig {
  const type = storageTargetType(target);
  if (type === "s3") {
    return {
      ...target,
      type,
      access_key_id:
        "access_key_id" in target
          ? scrubStorageCredential(target.access_key_id)
          : null,
      secret_access_key:
        "secret_access_key" in target
          ? scrubStorageCredential(target.secret_access_key)
          : null,
      session_token:
        "session_token" in target
          ? scrubStorageCredential(target.session_token)
          : null,
    } as StorageTargetConfig;
  }
  if (type === "webdav") {
    return {
      ...target,
      type,
      password:
        "password" in target ? scrubStorageCredential(target.password) : null,
    } as StorageTargetConfig;
  }
  if (type === "http") {
    return {
      ...target,
      type,
      headers:
        "headers" in target
          ? Object.fromEntries(
              Object.entries(target.headers ?? {}).map(([name, credential]) => [
                name,
                scrubStorageCredential(credential)!,
              ]),
            )
          : {},
    } as StorageTargetConfig;
  }
  if (type === "sftp") {
    return {
      ...target,
      type,
      password:
        "password" in target ? scrubStorageCredential(target.password) : null,
      private_key:
        "private_key" in target
          ? scrubStorageCredential(target.private_key)
          : null,
    } as StorageTargetConfig;
  }
  return { ...target, type: "local" } as StorageTargetConfig;
}

function sanitizeStorageTargetConfig(
  target: StorageTargetConfig,
): StorageTargetConfig {
  const scrubbed = scrubStorageTargetSecrets(target);
  const type = storageTargetType(scrubbed);
  if (type === "s3") {
    return {
      ...scrubbed,
      access_key_id:
        "access_key_id" in scrubbed
          ? sanitizeNotificationCredential(scrubbed.access_key_id)
          : null,
      secret_access_key:
        "secret_access_key" in scrubbed
          ? sanitizeNotificationCredential(scrubbed.secret_access_key)
          : null,
      session_token:
        "session_token" in scrubbed
          ? sanitizeNotificationCredential(scrubbed.session_token)
          : null,
    } as StorageTargetConfig;
  }
  if (type === "webdav") {
    return {
      ...scrubbed,
      password:
        "password" in scrubbed
          ? sanitizeNotificationCredential(scrubbed.password)
          : null,
    } as StorageTargetConfig;
  }
  if (type === "http") {
    return {
      ...scrubbed,
      headers:
        "headers" in scrubbed
          ? Object.fromEntries(
              Object.entries(scrubbed.headers ?? {}).map(
                ([name, credential]) => [
                  name,
                  sanitizeNotificationCredential(credential)!,
                ],
              ),
            )
          : {},
    } as StorageTargetConfig;
  }
  if (type === "sftp") {
    return {
      ...scrubbed,
      password:
        "password" in scrubbed
          ? sanitizeNotificationCredential(scrubbed.password)
          : null,
      private_key:
        "private_key" in scrubbed
          ? sanitizeNotificationCredential(scrubbed.private_key)
          : null,
    } as StorageTargetConfig;
  }
  return scrubbed;
}

function sanitizeStorageConfig(config: StorageConfig): StorageConfig {
  const normalized = normalizeStorageConfig(config);
  const localTargetNames = new Set(
    Object.entries(normalized.targets)
      .filter(([, target]) => storageTargetType(target) === "local")
      .map(([name]) => name),
  );
  return {
    ...normalized,
    default_targets: normalized.default_targets.filter((name) =>
      localTargetNames.has(name),
    ),
    fallback_targets: normalized.fallback_targets.filter((name) =>
      localTargetNames.has(name),
    ),
    targets: Object.fromEntries(
      Object.entries(normalized.targets).map(([name, target]) => [
        name,
        sanitizeStorageTargetConfig(target),
      ]),
    ),
  };
}

function sanitizeNotificationCredential(
  credential: NotificationConfig["email"]["password"],
) {
  if (!credential) return credential;
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

function sanitizeNotificationConfig(
  config: NotificationConfig,
): NotificationConfig {
  return {
    ...config,
    email: {
      ...config.email,
      password: sanitizeNotificationCredential(config.email.password),
    },
    webhooks: config.webhooks.map((webhook) => ({
      ...webhook,
      headers: Object.fromEntries(
        Object.entries(webhook.headers ?? {}).map(([header, credential]) => [
          header,
          sanitizeNotificationCredential(credential)!,
        ]),
      ),
    })),
  };
}

function browserConfigForUi(config: ServerConfig): ServerConfig {
  const providers = Object.fromEntries(
    Object.entries(config.providers ?? {}).map(([name, provider]) => [
      name,
      {
        ...provider,
        credentials: Object.fromEntries(
          Object.entries(provider.credentials ?? {}).map(
            ([key, credential]) => [key, sanitizeCredential(credential)],
          ),
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
    disabled_reason:
      "静态 Web 不能读取 Codex 登录态，请使用桌面 App 或 Docker。",
  };
  const defaultProvider =
    config.default_provider &&
    providers[config.default_provider]?.disabled !== true
      ? config.default_provider
      : Object.entries(providers).find(
          ([, provider]) => !provider.disabled,
        )?.[0];
  return normalizeConfig({
    version: 1,
    default_provider: defaultProvider,
    providers,
    notifications: sanitizeNotificationConfig(
      normalizeNotificationConfig(config.notifications),
    ),
    storage: sanitizeStorageConfig(config.storage),
    paths: normalizePathConfig(config.paths),
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
    notifications: normalizeNotificationConfig(config.notifications),
    storage: normalizeStorageConfig(config.storage),
    paths: normalizePathConfig(config.paths),
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
    throw new Error("静态 Web 只支持保留在当前浏览器数据中的 API Key。");
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

function trimTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function configuredRelayBase() {
  if (typeof window === "undefined") return undefined;
  const configured =
    window.__GPT_IMAGE_2_RELAY_BASE__ ||
    import.meta.env.VITE_GPT_IMAGE_2_RELAY_BASE;
  const value = configured?.trim();
  if (value) return trimTrailingSlash(value);
  const host = window.location?.hostname;
  if (
    host === "image.codex-pool.com" ||
    host === "gpt-image-2-dpm.pages.dev" ||
    host?.endsWith(".gpt-image-2-dpm.pages.dev")
  ) {
    return "/api/relay";
  }
  return undefined;
}

function relayRequest(endpoint: string, init: RequestInit) {
  const relayBase = configuredRelayBase();
  if (!relayBase) return undefined;
  try {
    const upstream = new URL(endpoint);
    if (window.location?.origin && upstream.origin === window.location.origin) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  const headers = new Headers(init.headers);
  headers.set("X-GPT-Image-2-Upstream", endpoint);
  headers.set("X-GPT-Image-2-Method", init.method || "GET");
  return {
    url: relayBase,
    init: {
      ...init,
      method: "POST",
      headers,
    } satisfies RequestInit,
  };
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

function cloneGenerateRequest(request: GenerateRequest): GenerateRequest {
  return JSON.parse(JSON.stringify(request)) as GenerateRequest;
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
  return (
    error instanceof TypeError || String(error).includes("Failed to fetch")
  );
}

function networkError(error: unknown, endpoint: string) {
  if (isLikelyCorsError(error)) {
    return new Error(`${CORS_MESSAGE}\n${endpoint}`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

async function fetchProvider(endpoint: string, init: RequestInit) {
  try {
    return await fetch(endpoint, init);
  } catch (error) {
    if (!isLikelyCorsError(error)) throw networkError(error, endpoint);
    const relay = relayRequest(endpoint, init);
    if (!relay) throw networkError(error, endpoint);
    try {
      return await fetch(relay.url, relay.init);
    } catch (relayError) {
      throw networkError(relayError, endpoint);
    }
  }
}

function explainOriginDnsError(endpoint?: string) {
  let hostHint = "";
  try {
    const host = endpoint ? new URL(endpoint).hostname : "";
    if (host) {
      hostHint = ` 当前 Base URL 域名：${host}。`;
    }
  } catch {
    /* ignore */
  }
  return `上游服务域名无法解析或回源失败（Cloudflare 1016/530）。请检查 Base URL 是否写错，或换一个当前可公网访问的服务地址。${hostHint}`;
}

async function parseErrorResponse(response: Response, endpoint?: string) {
  const text = await response.text().catch(() => "");
  if (response.status === 530 && /error code:\s*1016/i.test(text)) {
    return explainOriginDnsError(endpoint);
  }
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
    response = await fetchProvider(endpoint, {
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
    throw new Error(
      `${response.status} ${await parseErrorResponse(response, endpoint)}`,
    );
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
    response = await fetchProvider(endpoint, {
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
    throw new Error(
      `${response.status} ${await parseErrorResponse(response, endpoint)}`,
    );
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
    const response = await fetchProvider(item.url, { signal });
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
  return Promise.all(
    items.map((item) => blobFromImageItem(item, format, signal)),
  );
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

function editBodyField(form: FormData, key: string, value: unknown) {
  if (value === undefined || value === null || value === "") return;
  form.append(key, String(value));
}

function sortedFiles(form: FormData, prefix: string) {
  return Array.from(form.entries())
    .filter(([key, value]) => key.startsWith(prefix) && value instanceof File)
    .sort(([a], [b]) => a.localeCompare(b)) as [string, File][];
}

async function storedEditInputFromForm(jobId: string, form: FormData) {
  const metaRaw = form.get("meta");
  const meta =
    typeof metaRaw === "string"
      ? (JSON.parse(metaRaw) as Record<string, unknown>)
      : {};
  const files: StoredUpload[] = [];
  for (const [key, value] of form.entries()) {
    if (key === "meta" || !(value instanceof File)) continue;
    files.push({
      key,
      name: value.name,
      type: value.type || "application/octet-stream",
      blob: value,
    });
  }
  return { jobId, kind: "edit" as const, meta, files };
}

function formFromStoredEdit(input: Extract<StoredJobInput, { kind: "edit" }>) {
  const form = new FormData();
  form.append("meta", JSON.stringify(input.meta));
  for (const file of input.files) {
    form.append(
      file.key,
      new File([file.blob], file.name, {
        type: file.blob.type || file.type || "application/octet-stream",
      }),
      file.name,
    );
  }
  return form;
}

function generateRequestFromJob(job: Job): GenerateRequest {
  const meta = job.metadata ?? {};
  const readString = (key: string) =>
    typeof meta[key] === "string" ? String(meta[key]) : undefined;
  const readNumber = (key: string) =>
    typeof meta[key] === "number" && Number.isFinite(meta[key])
      ? Number(meta[key])
      : undefined;
  return {
    prompt: readString("prompt") ?? "",
    provider: readString("provider") ?? job.provider,
    size: readString("size"),
    format: readString("format"),
    quality: readString("quality"),
    background: readString("background"),
    n: readNumber("n"),
    compression: readNumber("compression"),
    moderation: readString("moderation"),
  };
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
    message: "当前浏览器数据空间接近上限，请清理历史或导出图片。",
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

async function enqueueBrowserTask(job: Job, run: BrowserQueuedTask["run"]) {
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
  maxParallel = 2;
  prepared = null;
  const db = await dbPromise.current?.catch(() => null);
  db?.close();
  dbPromise.current = null;
  await deleteDatabase();
}

async function downloadBlob(path: string, fileName: (blob: Blob) => string) {
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

async function blobForPath(path: string) {
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

async function downloadJobZip(job: Job) {
  const paths = browserApi.jobOutputPaths(job);
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

export const browserApi: ApiClient = {
  kind: "browser",
  canUseLocalFiles: false,
  canRevealFiles: false,
  canUseSystemCredentials: false,
  canUseCodexProvider: false,
  canExportToDownloadsFolder: false,
  canExportToConfiguredFolder: false,
  canChooseExportFolder: false,
  canUsePersistentResultLibrary: false,
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
      app_data_dir: "IndexedDB: gpt-image-2-web",
      result_library_dir: "IndexedDB: outputs",
      default_export_dir: "浏览器默认下载位置",
      default_export_dirs: {
        browser_default: "浏览器默认下载位置",
        downloads: "浏览器默认下载位置",
        documents: "浏览器默认下载位置",
        pictures: "浏览器默认下载位置",
        result_library: "IndexedDB: outputs",
      },
      storage_fallback_dir: "IndexedDB: outputs",
      legacy_codex_config_dir: "",
      legacy_jobs_dir: "",
    };
  },
  async updateNotifications(config: NotificationConfig) {
    await prepareBrowserRuntime();
    const current = await readConfigRecord();
    const notifications = normalizeNotificationConfig(config);
    // Defense-in-depth: NotificationCenterPanel hides email/webhook rows in
    // this runtime, but if a config arrives with them enabled (preset sync,
    // manual IndexedDB tweak) we both force the toggles off AND strip any
    // inline secrets. The browser cannot deliver SMTP / webhook calls, and
    // persisting plaintext SMTP passwords or Bearer tokens to IndexedDB
    // would leave them on disk for anyone with file-system access. env /
    // keychain references hold no secret so they pass through unchanged.
    current.notifications = {
      ...notifications,
      email: {
        ...notifications.email,
        enabled: false,
        password: scrubFileCredentialSecret(notifications.email.password),
      },
      webhooks: notifications.webhooks.map((webhook) => ({
        ...webhook,
        enabled: false,
        headers: Object.fromEntries(
          Object.entries(webhook.headers ?? {}).map(([name, credential]) => [
            name,
            scrubFileCredentialSecret(credential)!,
          ]),
        ),
      })),
    };
    await writeStoredConfig(browserStoredConfig(current));
    return browserConfigForUi(current);
  },
  async testNotifications(status?: JobStatus): Promise<NotificationTestResult> {
    const config = normalizeNotificationConfig(
      (await readConfigRecord()).notifications,
    );
    const allowed =
      (config.enabled ?? true) &&
      ((status === "failed" && config.on_failed) ||
        (status === "cancelled" && config.on_cancelled) ||
        ((!status || status === "completed") && config.on_completed));
    const localChannelEnabled =
      config.toast.enabled || config.system.enabled;
    if (!allowed || !localChannelEnabled) {
      return {
        ok: false,
        reason: "no_eligible_channel",
        deliveries: [],
      };
    }
    return {
      ok: true,
      // Static Web has no server-side channels at all; mirror the server's
      // `local_only` shape so the settings UI takes the same code path.
      reason: "local_only",
      deliveries: [
        {
          channel: "browser",
          name: "Browser runtime",
          ok: true,
          message:
            "已校验本地 toast / 系统通知配置；邮件和 webhook 需要桌面 App 或服务端 Web。",
        },
      ],
    };
  },
  async notificationCapabilities(): Promise<NotificationCapabilities> {
    return {
      system: {
        tauri_native: false,
        browser: typeof window !== "undefined" && "Notification" in window,
      },
      server: { email: false, webhook: false },
    };
  },
  async updatePaths(config: PathConfig) {
    await prepareBrowserRuntime();
    const current = await readConfigRecord();
    current.paths = normalizePathConfig(config);
    current.paths.default_export_dir = {
      mode: "browser_default",
      path: null,
    };
    await writeStoredConfig(browserStoredConfig(current));
    return browserConfigForUi(current);
  },
  async updateStorage(config: StorageConfig) {
    await prepareBrowserRuntime();
    const current = await readConfigRecord();
    const normalized = normalizeStorageConfig(config);
    current.storage = {
      ...normalized,
      default_targets: normalized.default_targets.filter((name) => {
        const target = normalized.targets[name];
        return target && storageTargetType(target) === "local";
      }),
      fallback_targets: normalized.fallback_targets.filter((name) => {
        const target = normalized.targets[name];
        return target && storageTargetType(target) === "local";
      }),
      targets: Object.fromEntries(
        Object.entries(normalized.targets).map(([name, target]) => [
          name,
          scrubStorageTargetSecrets(target),
        ]),
      ),
    };
    await writeStoredConfig(browserStoredConfig(current));
    return browserConfigForUi(current);
  },
  async testStorageTarget(name: string, target?: StorageTargetConfig) {
    const targetType = storageTargetType(target);
    if (targetType === "local") {
      return {
        ok: true,
        target: name,
        target_type: targetType,
        message:
          "静态 Web 仅会把结果保存在当前浏览器数据中，不会写入服务器或本机目录。",
        local_only: true,
      };
    }
    return {
      ok: false,
      target: name,
      target_type: targetType,
      message:
        "远端存储上传需要桌面 App 或服务端 Web；静态 Web 不会保存远端密钥。",
      unsupported: true,
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
      throw new Error(
        "静态 Web 不能添加 Codex 凭证，请使用桌面 App 或 Docker。",
      );
    }
    if (cfg.type !== "openai-compatible") {
      throw new Error("静态 Web 只支持 OpenAI-compatible API Key 凭证。");
    }
    const apiKey = cfg.credentials.api_key;
    if (!apiKey || apiKey.source !== "file") {
      throw new Error(
        "静态 Web 只支持直接填写并保留在当前浏览器数据中的 API Key。",
      );
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
      const response = await fetchProvider(endpoint, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
      });
      const latency_ms = Math.round(performance.now() - started);
      if (!response.ok) {
        return {
          ok: false,
          latency_ms,
          message: `${response.status} ${await parseErrorResponse(
            response,
            endpoint,
          )}`,
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
    const [page, active] = await Promise.all([
      readStoredJobsPage({ limit: 100 }),
      browserApi.listActiveJobs(),
    ]);
    const jobs = mergeJobsById([...active, ...page.jobs]);
    await Promise.all(jobs.map(hydrateJobOutputs));
    return jobs;
  },
  async listJobsPage(options = {}) {
    await prepareBrowserRuntime();
    const page = await readStoredJobsPage(options);
    await Promise.all(page.jobs.map(hydrateJobOutputs));
    return page;
  },
  async listActiveJobs() {
    await prepareBrowserRuntime();
    const jobs = filterJobs(await readStoredJobs(), "running");
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
    await deleteJobInput(id);
    eventLog.delete(id);
    nextSeq.delete(id);
  },
  async softDeleteJob(id: string) {
    // Browser runtime has no recoverable trash; the executor suppresses the
    // "undo" toast on non-Tauri runtimes so the UX matches reality.
    await this.deleteJob(id);
  },
  async restoreDeletedJob(_id: string) {
    throw new Error("浏览器模式不支持恢复，请重新生成。");
  },
  async hardDeleteJob(id: string) {
    await this.deleteJob(id);
  },
  async copyImageToClipboard(_path: string, _prompt?: string | null) {
    throw new Error("浏览器模式请使用 ClipboardItem。");
  },
  async cancelJob(id: string) {
    await prepareBrowserRuntime();
    const queuedIndex = queue.findIndex((task) => task.job.id === id);
    const task =
      queuedIndex >= 0 ? queue.splice(queuedIndex, 1)[0] : running.get(id);
    if (!task)
      throw new Error("Only queued or running browser jobs can be cancelled.");
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
    throw new Error("Web 不能打开文件夹，请使用桌面 App 查看文件位置。");
  },
  async exportFilesToDownloads(paths: string[]) {
    return browserApi.exportFilesToConfiguredFolder(paths);
  },
  async exportJobToDownloads(jobId: string) {
    return browserApi.exportJobToConfiguredFolder(jobId);
  },
  async exportFilesToConfiguredFolder(paths: string[]) {
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
  async exportJobToConfiguredFolder(jobId: string) {
    await prepareBrowserRuntime();
    const { job } = await browserApi.getJob(jobId);
    return downloadJobZip(job);
  },
  async createGenerate(body: GenerateRequest) {
    if (!body.prompt.trim()) throw new Error("Prompt is required.");
    const provider = selectedProviderName(body.provider);
    const request = cloneGenerateRequest(body);
    const job: Job = {
      id: browserJobId(),
      command: "images generate",
      provider,
      status: "queued",
      created_at: nowIso(),
      updated_at: nowIso(),
      metadata: { ...request },
      outputs: [],
      error: null,
    };
    await writeJobInput({ jobId: job.id, kind: "generate", request });
    return enqueueBrowserTask(job, (task) => runGenerateTask(task, request));
  },
  async createEdit(form: FormData) {
    const metaRaw = form.get("meta");
    const meta =
      typeof metaRaw === "string"
        ? (JSON.parse(metaRaw) as Record<string, unknown>)
        : {};
    if (!String(meta.prompt ?? "").trim())
      throw new Error("Prompt is required.");
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
    await writeJobInput(await storedEditInputFromForm(job.id, form));
    return enqueueBrowserTask(job, (task) => runEditTask(task, form));
  },
  async retryJob(jobId: string) {
    await prepareBrowserRuntime();
    const job = await readStoredJob(jobId);
    if (!job) throw new Error("History job was not found.");
    const input = await readJobInput(jobId);
    if (job.command === "images generate") {
      const request =
        input?.kind === "generate"
          ? input.request
          : generateRequestFromJob(job);
      if (!request.prompt.trim()) {
        throw new Error("这个生成任务缺少 prompt，无法原样重试。");
      }
      return browserApi.createGenerate(request);
    }
    if (job.command === "images edit") {
      if (input?.kind !== "edit" || input.files.length === 0) {
        throw new Error("这个编辑任务缺少原始参考图，无法原样重试。");
      }
      return browserApi.createEdit(formFromStoredEdit(input));
    }
    throw new Error("这个任务类型暂不支持重试。");
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
  subscribeJobEvents(
    jobId: string,
    onEvent: EventHandler,
    onDone?: () => void,
  ) {
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
