import type {
  GenerateRequest,
  Job,
  JobEvent,
  JobStatus,
  LoggingConfig,
  LogLevel,
  LogsResult,
  NotificationCapabilities,
  NotificationConfig,
  NotificationTestResult,
  PathConfig,
  ProviderConfig,
  ProxyConfig,
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
import {
  apiResourceUrl,
  configuredHttpApiBase,
  fileApiUrl,
  jsonBody,
  requestJson,
} from "./http/client";
import {
  basename,
  downloadJobZip,
  downloadUrl,
  jobOutputDownloadName,
} from "./http/downloads";
import { formUploadPayload } from "./http/edit-payload";
import {
  jobUpdateSignature,
  listJobsPage as requestJobsPage,
  mergeJobsById,
  rememberEventJob,
} from "./http/jobs";

export { configuredHttpApiBase, hasConfiguredHttpRuntime } from "./http/client";

function isHttpRuntimeUrl(value: string): boolean {
  return (
    value.startsWith("/api/") ||
    value.startsWith(`${configuredHttpApiBase() ?? "/api"}/`) ||
    /^https?:\/\//i.test(value)
  );
}

export const httpApi: ApiClient = {
  kind: "http",
  canUseLocalFiles: false,
  canRevealFiles: false,
  // HTTP deployments (Docker Web, bare-server systemd, K8s pod, serverless)
  // typically lack a running dbus/libsecret/keyring service and a user
  // session for it to attach to, so the keyring crate fails to open an
  // entry. Advertising keychain here just produces a misleading dropdown
  // option and a confusing "keychain_error" at upload time. A future
  // capability probe can flip this back on for self-hosters that did wire
  // a real keyring into their server.
  canUseSystemCredentials: false,
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
  async updateProxy(config: ProxyConfig) {
    return normalizeConfig(
      await requestJson<ServerConfig>("/proxy", {
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
  async getLogs(options?: { limit?: number; level?: LogLevel }) {
    const params = new URLSearchParams();
    if (options?.limit != null) params.set("limit", String(options.limit));
    if (options?.level) params.set("level", options.level);
    const query = params.toString();
    return requestJson<LogsResult>(`/logs${query ? `?${query}` : ""}`);
  },
  async updateLogging(config: LoggingConfig) {
    return normalizeConfig(
      await requestJson<ServerConfig>("/logging", {
        method: "PUT",
        body: jsonBody(config),
      }),
    );
  },
  async openLogsDir() {
    // No native file-manager on a remote server; surface the server-side path
    // so the UI can show users where the logs live inside the container.
    const result = await requestJson<LogsResult>("/logs?limit=1");
    return result.logs_dir;
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
    return downloadJobZip(job, httpApi.fileUrl, httpApi.jobOutputUrl);
  },
  async exportJobOutputToConfiguredFolder(jobId: string, outputIndex: number) {
    const { job } = await httpApi.getJob(jobId);
    const url = apiResourceUrl(
      `/jobs/${encodeURIComponent(jobId)}/outputs/${outputIndex}`,
    );
    downloadUrl(url, jobOutputDownloadName(job, outputIndex));
    return [url];
  },
  async ensureJobOutputCached(jobId: string, outputIndex: number) {
    if (!jobId.trim() || !Number.isFinite(outputIndex) || outputIndex < 0) {
      return null;
    }
    const url = apiResourceUrl(
      `/jobs/${encodeURIComponent(jobId)}/outputs/${outputIndex}`,
    );
    return url;
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
  async resumeJob(
    jobId: string,
    action:
      | "continue_save"
      | "fill_missing"
      | "reupload"
      | "resubmit"
      | "discard",
  ) {
    const result = await requestJson<TauriJobResponse>(
      `/jobs/${encodeURIComponent(jobId)}/resume`,
      { method: "POST", body: jsonBody({ action }) },
    );
    return normalizeJobResponse(result);
  },
  outputUrl(jobId: string, index = 0) {
    const path = outputPath(jobId, index);
    return path ? httpApi.fileUrl(path) : "";
  },
  outputPath,
  fileUrl(path?: string | null) {
    if (!path) return "";
    return isHttpRuntimeUrl(path) ? path : fileApiUrl(path);
  },
  jobOutputUrl(job: Job, index = 0) {
    return apiResourceUrl(
      `/jobs/${encodeURIComponent(job.id)}/outputs/${index}`,
    );
  },
  async jobReferenceUrls(job: Job) {
    return (job.reference_images ?? []).map((ref) =>
      apiResourceUrl(`/jobs/${encodeURIComponent(job.id)}/refs/${ref.index}`),
    );
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    const known = new Map<string, string>();
    // Poll fast while work is in flight, but back off to 8s when everything
    // is terminal so an idle Web session isn't hitting listJobs every 1.5s
    // forever. Self-scheduling timeout (not setInterval) so the cadence can
    // adapt to the latest result.
    const ACTIVE_INTERVAL_MS = 1_500;
    const IDLE_INTERVAL_MS = 8_000;

    const poll = async () => {
      if (closed) return;
      let hasActive = false;
      try {
        const jobs = await httpApi.listJobs();
        for (const job of jobs) {
          if (!isTerminalJobStatus(job.status)) hasActive = true;
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
      if (closed) return;
      timer = setTimeout(
        poll,
        hasActive ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS,
      );
    };

    void poll();
    return () => {
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  },
};
