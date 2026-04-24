import type {
  GenerateRequest,
  Job,
  JobEvent,
  ProviderConfig,
  QueueStatus,
  ServerConfig,
  TestProviderResult,
} from "../types";
import {
  fileToUpload,
  jobOutputPath,
  jobOutputPaths,
  normalizeConfig,
  normalizeJob,
  normalizeJobResponse,
  outputPath,
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

type UploadPayload = Awaited<ReturnType<typeof fileToUpload>>;

function trimTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function configuredHttpApiBase() {
  const fromWindow =
    typeof window !== "undefined" ? window.__GPT_IMAGE_2_API_BASE__ : undefined;
  const fromEnv = import.meta.env.VITE_GPT_IMAGE_2_API_BASE;
  const value = (fromWindow || fromEnv || "").trim();
  return value ? trimTrailingSlash(value) : undefined;
}

export function hasConfiguredHttpRuntime() {
  if (typeof window === "undefined") return false;
  return (
    window.__GPT_IMAGE_2_RUNTIME__ === "http" ||
    Boolean(configuredHttpApiBase())
  );
}

function apiUrl(path: string) {
  const base = configuredHttpApiBase() ?? "/api";
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

function fileApiUrl(path: string) {
  const base = configuredHttpApiBase() ?? "/api";
  return `${base}/files?path=${encodeURIComponent(path)}`;
}

async function parseErrorResponse(response: Response) {
  const fallback = `${response.status} ${response.statusText}`.trim();
  const text = await response.text();
  if (!text) return fallback;
  try {
    const payload = JSON.parse(text) as {
      error?: { message?: string };
      message?: string;
    };
    return payload.error?.message || payload.message || fallback;
  } catch {
    return text || fallback;
  }
}

async function requestJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(apiUrl(path), { ...init, headers });
  if (!response.ok) throw new Error(await parseErrorResponse(response));
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function jsonBody(value: unknown) {
  return JSON.stringify(value);
}

function rememberEventJob(event: JobEvent) {
  const job = event.data?.job;
  if (job && typeof job === "object") {
    rememberJobOutputs(normalizeJob(job as Record<string, unknown>));
  }
}

async function formUploadPayload(form: FormData) {
  const metaRaw = form.get("meta");
  const meta =
    typeof metaRaw === "string"
      ? (JSON.parse(metaRaw) as Record<string, unknown>)
      : {};
  const refs: Array<{ key: string; file: File }> = [];
  let mask: UploadPayload | undefined;
  let selection_hint: UploadPayload | undefined;

  for (const [key, value] of form.entries()) {
    if (key.startsWith("ref_") && value instanceof File) {
      refs.push({ key, file: value });
    }
    if (key === "mask" && value instanceof File) {
      mask = await fileToUpload(value);
    }
    if (key === "selection_hint" && value instanceof File) {
      selection_hint = await fileToUpload(value);
    }
  }

  refs.sort((a, b) => a.key.localeCompare(b.key));
  return {
    ...meta,
    refs: await Promise.all(refs.map((entry) => fileToUpload(entry.file))),
    mask,
    selection_hint,
  };
}

function downloadUrl(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function basename(path: string, fallback: string) {
  const value = path.split(/[\\/]/).pop();
  return value && value.trim() ? value : fallback;
}

export const httpApi: ApiClient = {
  kind: "http",
  canUseLocalFiles: false,
  canRevealFiles: false,
  canUseSystemCredentials: true,
  canUseCodexProvider: true,
  canExportToDownloadsFolder: false,
  async getConfig() {
    return normalizeConfig(await requestJson<ServerConfig>("/config"));
  },
  async configPaths() {
    return requestJson<ConfigPaths>("/config-paths");
  },
  async setDefault(name: string) {
    return normalizeConfig(
      await requestJson<ServerConfig>("/providers/default", {
        method: "POST",
        body: jsonBody({ name }),
      }),
    );
  },
  async upsertProvider(name: string, cfg: ProviderConfig) {
    return normalizeConfig(
      await requestJson<ServerConfig>(`/providers/${encodeURIComponent(name)}`, {
        method: "PUT",
        body: jsonBody(cfg),
      }),
    );
  },
  async revealProviderCredential(name: string, credential: string) {
    return requestJson<{ value: string }>(
      `/providers/${encodeURIComponent(name)}/credentials/${encodeURIComponent(
        credential,
      )}`,
    );
  },
  async deleteProvider(name: string) {
    return normalizeConfig(
      await requestJson<ServerConfig>(`/providers/${encodeURIComponent(name)}`, {
        method: "DELETE",
      }),
    );
  },
  async testProvider(name: string) {
    return requestJson<TestProviderResult>(
      `/providers/${encodeURIComponent(name)}/test`,
      { method: "POST" },
    );
  },
  async listJobs() {
    const payload = await requestJson<{ jobs: Record<string, unknown>[] }>(
      "/jobs",
    );
    return (payload.jobs ?? []).map(normalizeJob);
  },
  async getJob(id: string) {
    const payload = await requestJson<{
      job: Record<string, unknown>;
      events?: JobEvent[];
    }>(`/jobs/${encodeURIComponent(id)}`);
    const job = normalizeJob(payload.job ?? {});
    return { job, events: payload.events ?? [] };
  },
  async deleteJob(id: string) {
    await requestJson(`/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  async cancelJob(id: string) {
    const result = await requestJson<TauriJobResponse>(
      `/jobs/${encodeURIComponent(id)}/cancel`,
      { method: "POST" },
    );
    return normalizeJobResponse(result);
  },
  async queueStatus() {
    return requestJson<QueueStatus>("/queue");
  },
  async setQueueConcurrency(maxParallel: number) {
    return requestJson<QueueStatus>("/queue/concurrency", {
      method: "POST",
      body: jsonBody({ max_parallel: maxParallel }),
    });
  },
  async openPath(path: string) {
    const url = httpApi.fileUrl(path);
    if (!url) throw new Error("没有可打开的文件。");
    window.open(url, "_blank", "noopener,noreferrer");
  },
  async revealPath() {
    throw new Error("Docker Web 不能打开服务器文件夹。");
  },
  async exportFilesToDownloads(paths: string[]) {
    for (const [index, path] of paths.entries()) {
      const url = httpApi.fileUrl(path);
      if (!url) throw new Error("没有可保存的图片。");
      downloadUrl(url, basename(path, `gpt-image-2-${index + 1}.png`));
    }
    return paths;
  },
  async createGenerate(body: GenerateRequest) {
    const result = await requestJson<TauriJobResponse>("/images/generate", {
      method: "POST",
      body: jsonBody(body),
    });
    return normalizeJobResponse(result);
  },
  async createEdit(form: FormData) {
    const result = await requestJson<TauriJobResponse>("/images/edit", {
      method: "POST",
      body: jsonBody(await formUploadPayload(form)),
    });
    return normalizeJobResponse(result);
  },
  outputUrl(jobId: string, index = 0) {
    const path = outputPath(jobId, index);
    return path ? httpApi.fileUrl(path) : "";
  },
  outputPath,
  fileUrl(path?: string | null) {
    return path ? fileApiUrl(path) : "";
  },
  jobOutputUrl(job: Job, index = 0) {
    const path = jobOutputPath(job, index);
    return path ? httpApi.fileUrl(path) : "";
  },
  jobOutputPath,
  jobOutputPaths,
  subscribeJobEvents(jobId: string, onEvent: EventHandler, onDone?: () => void) {
    let closed = false;
    let seq = 0;
    const seen = new Set<number>();

    const deliver = (event: JobEvent) => {
      if (closed || seen.has(event.seq)) return;
      seen.add(event.seq);
      seq = Math.max(seq, event.seq);
      rememberEventJob(event);
      onEvent(event);
      if (event.kind === "local" && isTerminalJobStatus(event.type.slice(4))) {
        closed = true;
        onDone?.();
      }
    };

    const poll = async () => {
      if (closed) return;
      try {
        const payload = await httpApi.getJob(jobId);
        for (const event of payload.events ?? []) deliver(event);
        if (isTerminalJobStatus(payload.job.status)) {
          seq += 1;
          deliver({
            seq,
            kind: "local",
            type: `job.${payload.job.status}`,
            data: {
              status: payload.job.status,
              output: {
                path: payload.job.output_path,
                files: payload.job.outputs,
              },
              job: payload.job,
            },
          });
          closed = true;
          onDone?.();
        }
      } catch {
        closed = true;
        onDone?.();
      }
    };

    void poll();
    const timer = window.setInterval(poll, 1_200);
    return () => {
      closed = true;
      window.clearInterval(timer);
    };
  },
  subscribeJobUpdates(onEvent: JobUpdateHandler) {
    let closed = false;
    let initialized = false;
    const known = new Map<string, string>();

    const signature = (job: Job) =>
      `${job.status}:${job.updated_at}:${job.outputs.length}:${job.output_path ?? ""}`;

    const poll = async () => {
      if (closed) return;
      try {
        const jobs = await httpApi.listJobs();
        for (const job of jobs) {
          const next = signature(job);
          const previous = known.get(job.id);
          known.set(job.id, next);
          if (initialized && previous && previous !== next) {
            onEvent(job.id, {
              seq: Date.now(),
              kind: "local",
              type: `job.${job.status}`,
              data: { status: job.status, job },
            });
          }
        }
        initialized = true;
      } catch {
        // The regular query layer surfaces API errors; this subscription is only
        // a lightweight invalidation hint.
      }
    };

    void poll();
    const timer = window.setInterval(poll, 1_500);
    return () => {
      closed = true;
      window.clearInterval(timer);
    };
  },
};
