import type {
  GenerateRequest,
  Job,
  JobEvent,
  JobStatus,
  NotificationCapabilities,
  NotificationConfig,
  NotificationTestResult,
  PathConfig,
  ProviderConfig,
  QueueStatus,
  ServerConfig,
  StorageConfig,
  StorageTargetConfig,
  TestProviderResult,
} from "../types";
import {
  jobOutputPath,
  jobOutputPaths,
  normalizeConfig,
  normalizeJob,
  normalizeJobResponse,
  outputPath,
} from "./shared";
import type {
  ApiClient,
  ConfigPaths,
  EventHandler,
  JobUpdateHandler,
  StorageTestResult,
  TauriJobResponse,
} from "./types";
import { isTerminalJobStatus } from "./types";
import { fileApiUrl, jsonBody, requestJson } from "./http/client";
import { basename, downloadJobZip, downloadUrl } from "./http/downloads";
import { formUploadPayload } from "./http/edit-payload";
import {
  jobUpdateSignature,
  listJobsPage as requestJobsPage,
  mergeJobsById,
  rememberEventJob,
} from "./http/jobs";

export {
  configuredHttpApiBase,
  hasConfiguredHttpRuntime,
} from "./http/client";

export const httpApi: ApiClient = {
  kind: "http",
  canUseLocalFiles: false,
  canRevealFiles: false,
  canUseSystemCredentials: true,
  canUseCodexProvider: true,
  canExportToDownloadsFolder: false,
  canExportToConfiguredFolder: false,
  canChooseExportFolder: false,
  canUsePersistentResultLibrary: true,
  async getConfig() {
    return normalizeConfig(await requestJson<ServerConfig>("/config"));
  },
  async configPaths() {
    return requestJson<ConfigPaths>("/config-paths");
  },
  async updateNotifications(config: NotificationConfig) {
    return normalizeConfig(
      await requestJson<ServerConfig>("/notifications", {
        method: "PUT",
        body: jsonBody(config),
      }),
    );
  },
  async testNotifications(status?: JobStatus) {
    return requestJson<NotificationTestResult>("/notifications/test", {
      method: "POST",
      body: jsonBody({ status: status ?? "completed" }),
    });
  },
  async notificationCapabilities() {
    return requestJson<NotificationCapabilities>("/notifications/capabilities");
  },
  async updatePaths(config: PathConfig) {
    return normalizeConfig(
      await requestJson<ServerConfig>("/paths", {
        method: "PUT",
        body: jsonBody(config),
      }),
    );
  },
  async updateStorage(config: StorageConfig) {
    return normalizeConfig(
      await requestJson<ServerConfig>("/storage", {
        method: "PUT",
        body: jsonBody(config),
      }),
    );
  },
  async testStorageTarget(name: string, target?: StorageTargetConfig) {
    return requestJson<StorageTestResult>(
      `/storage/${encodeURIComponent(name)}/test`,
      {
        method: "POST",
        body: jsonBody({ target }),
      },
    );
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
      await requestJson<ServerConfig>(
        `/providers/${encodeURIComponent(name)}`,
        {
          method: "PUT",
          body: jsonBody(cfg),
        },
      ),
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
      await requestJson<ServerConfig>(
        `/providers/${encodeURIComponent(name)}`,
        {
          method: "DELETE",
        },
      ),
    );
  },
  async testProvider(name: string) {
    return requestJson<TestProviderResult>(
      `/providers/${encodeURIComponent(name)}/test`,
      { method: "POST" },
    );
  },
  async listJobs() {
    const [page, active] = await Promise.all([
      httpApi.listJobsPage({ limit: 100 }),
      httpApi.listActiveJobs(),
    ]);
    return mergeJobsById([...active, ...page.jobs]);
  },
  async listJobsPage(options = {}) {
    return requestJobsPage(options);
  },
  async listActiveJobs() {
    const payload = await requestJson<{ jobs: Record<string, unknown>[] }>(
      "/jobs/active",
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
  async softDeleteJob(id: string) {
    // HTTP backend has no soft-delete endpoint — fall back to hard delete.
    // The executor that calls this also suppresses the "undo" toast button
    // when `runtime !== "tauri"` so the UX stays honest.
    await this.deleteJob(id);
  },
  async restoreDeletedJob(_id: string) {
    throw new Error("HTTP 模式不支持恢复，请重新生成。");
  },
  async hardDeleteJob(id: string) {
    await this.deleteJob(id);
  },
  async copyImageToClipboard(_path: string, _prompt?: string | null) {
    // HTTP runtime has no Rust bridge. The image-actions executor is expected
    // to use `navigator.clipboard.write` with a `ClipboardItem` instead of
    // calling this transport method.
    throw new Error("HTTP 模式请使用浏览器内置剪贴板。");
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
    throw new Error("Web 页面不能打开服务端文件夹，请在服务器环境中查看。");
  },
  async exportFilesToDownloads(paths: string[]) {
    return httpApi.exportFilesToConfiguredFolder(paths);
  },
  async exportJobToDownloads(jobId: string) {
    return httpApi.exportJobToConfiguredFolder(jobId);
  },
  async exportFilesToConfiguredFolder(paths: string[]) {
    for (const [index, path] of paths.entries()) {
      const url = httpApi.fileUrl(path);
      if (!url) throw new Error("没有可下载的图片。");
      downloadUrl(url, basename(path, `gpt-image-2-${index + 1}.png`));
    }
    return paths;
  },
  async exportJobToConfiguredFolder(jobId: string) {
    const { job } = await httpApi.getJob(jobId);
    return downloadJobZip(job, httpApi.fileUrl, httpApi.jobOutputPaths);
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
  async retryJob(jobId: string) {
    const result = await requestJson<TauriJobResponse>(
      `/jobs/${encodeURIComponent(jobId)}/retry`,
      { method: "POST" },
    );
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
  subscribeJobEvents(
    jobId: string,
    onEvent: EventHandler,
    onDone?: () => void,
  ) {
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

    const poll = async () => {
      if (closed) return;
      try {
        const jobs = await httpApi.listJobs();
        for (const job of jobs) {
          const next = jobUpdateSignature(job);
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
