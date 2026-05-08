import type {
  GenerateRequest,
  Job,
  NotificationConfig,
  PathConfig,
  ProviderConfig,
  ServerConfig,
  StorageConfig,
  StorageTargetConfig,
  TestProviderResult,
} from "../types";
import {
  jobOutputPath,
  jobOutputPaths,
  normalizeJobResponse,
  normalizeNotificationConfig,
  normalizePathConfig,
  normalizeStorageConfig,
  outputPath,
  storageTargetType,
} from "./shared";
import type {
  ApiClient,
  EventHandler,
  JobUpdateHandler,
} from "./types";
import { isTerminalJobStatus } from "./types";
import * as browser from "./browser";

export { __resetBrowserApiForTests } from "./browser";

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
    await browser.prepareBrowserRuntime();
    return browser.browserConfigForUi(await browser.readConfigRecord());
  },
  configPaths: browser.browserConfigPaths,
  async updateNotifications(config: NotificationConfig) {
    await browser.prepareBrowserRuntime();
    const current = await browser.readConfigRecord();
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
        password: browser.scrubFileCredentialSecret(notifications.email.password),
      },
      webhooks: notifications.webhooks.map((webhook) => ({
        ...webhook,
        enabled: false,
        headers: Object.fromEntries(
          Object.entries(webhook.headers ?? {}).map(([name, credential]) => [
            name,
            browser.scrubFileCredentialSecret(credential)!,
          ]),
        ),
      })),
    };
    await browser.writeStoredConfig(browser.browserStoredConfig(current));
    return browser.browserConfigForUi(current);
  },
  testNotifications: browser.testBrowserNotifications,
  async notificationCapabilities() {
    return browser.browserNotificationCapabilities();
  },
  async updatePaths(config: PathConfig) {
    await browser.prepareBrowserRuntime();
    const current = await browser.readConfigRecord();
    current.paths = normalizePathConfig(config);
    current.paths.default_export_dir = {
      mode: "browser_default",
      path: null,
    };
    await browser.writeStoredConfig(browser.browserStoredConfig(current));
    return browser.browserConfigForUi(current);
  },
  async updateStorage(config: StorageConfig) {
    await browser.prepareBrowserRuntime();
    const current = await browser.readConfigRecord();
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
          browser.scrubStorageTargetSecrets(target),
        ]),
      ),
    };
    await browser.writeStoredConfig(browser.browserStoredConfig(current));
    return browser.browserConfigForUi(current);
  },
  testStorageTarget: browser.testBrowserStorageTarget,
  async setDefault(name: string) {
    await browser.prepareBrowserRuntime();
    const config = await browser.readConfigRecord();
    if (!config.providers[name]) throw new Error(`Unknown provider: ${name}`);
    config.default_provider = name;
    await browser.writeStoredConfig(config);
    return browser.browserConfigForUi(config);
  },
  async upsertProvider(name: string, cfg: ProviderConfig) {
    await browser.prepareBrowserRuntime();
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
    const config = await browser.readConfigRecord();
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
    await browser.writeStoredConfig(browser.browserStoredConfig(config));
    return browser.browserConfigForUi(config);
  },
  async revealProviderCredential(name: string, credential: string) {
    await browser.prepareBrowserRuntime();
    const provider = await browser.getStoredProvider(name);
    const ref = provider.credentials[credential];
    if (ref?.source !== "file" || typeof ref.value !== "string" || !ref.value) {
      throw new Error(`凭证「${name}」还没有保存可查看的密钥。`);
    }
    return { value: ref.value };
  },
  async deleteProvider(name: string) {
    await browser.prepareBrowserRuntime();
    if (name === "codex") throw new Error("内置 Codex 提示不能删除。");
    const config = await browser.readConfigRecord();
    delete config.providers[name];
    if (config.default_provider === name) {
      config.default_provider = Object.keys(config.providers)[0];
    }
    await browser.writeStoredConfig(config);
    return browser.browserConfigForUi(config);
  },
  async testProvider(name: string): Promise<TestProviderResult> {
    await browser.prepareBrowserRuntime();
    const started = performance.now();
    const provider = await browser.getStoredProvider(name);
    const apiKey = browser.requireApiKey(name, provider);
    const endpoint = browser.endpointFor(provider, "/models");
    try {
      const response = await browser.fetchProvider(endpoint, {
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
          message: `${response.status} ${await browser.parseErrorResponse(
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
        message: browser.networkError(error, endpoint).message,
      };
    }
  },
  async listJobs() {
    await browser.prepareBrowserRuntime();
    const [page, active] = await Promise.all([
      browser.readStoredJobsPage({ limit: 100 }),
      browserApi.listActiveJobs(),
    ]);
    const jobs = browser.mergeJobsById([...active, ...page.jobs]);
    await Promise.all(jobs.map(browser.hydrateJobOutputs));
    return jobs;
  },
  async listJobsPage(options = {}) {
    await browser.prepareBrowserRuntime();
    const page = await browser.readStoredJobsPage(options);
    await Promise.all(page.jobs.map(browser.hydrateJobOutputs));
    return page;
  },
  async listActiveJobs() {
    await browser.prepareBrowserRuntime();
    const jobs = browser.filterJobs(await browser.readStoredJobs(), "running");
    await Promise.all(jobs.map(browser.hydrateJobOutputs));
    return jobs;
  },
  async getJob(id: string) {
    await browser.prepareBrowserRuntime();
    const job = await browser.readStoredJob(id);
    if (!job) throw new Error("History job was not found.");
    await browser.hydrateJobOutputs(job);
    return { job, events: browser.eventLog.get(id) ?? [] };
  },
  async deleteJob(id: string) {
    await browser.prepareBrowserRuntime();
    const db = await browser.openDb();
    const tx = db.transaction("jobs", "readwrite");
    tx.objectStore("jobs").delete(id);
    await browser.transactionDone(tx);
    await browser.deleteOutputsForJob(id);
    await browser.deleteJobInput(id);
    browser.eventLog.delete(id);
    browser.nextSeq.delete(id);
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
    await browser.prepareBrowserRuntime();
    const queuedIndex = browser.queue.findIndex((task) => task.job.id === id);
    const task =
      queuedIndex >= 0 ? browser.queue.splice(queuedIndex, 1)[0] : browser.running.get(id);
    if (!task)
      throw new Error("Only queued or running browser jobs can be cancelled.");
    task.cancelled = true;
    task.abort.abort();
    if (queuedIndex >= 0) await browser.failTask(task, new Error("任务已取消。"));
    const job = (await browser.readStoredJob(id)) ?? task.job;
    return normalizeJobResponse({
      job_id: id,
      job,
      events: browser.eventLog.get(id) ?? [],
      queue: browser.queueSnapshot(),
      canceled: true,
    });
  },
  async queueStatus() {
    await browser.prepareBrowserRuntime();
    return browser.queueSnapshot();
  },
  async setQueueConcurrency(nextMaxParallel: number) {
    browser.setMaxParallel(Math.min(8, Math.max(1, Math.round(nextMaxParallel))));
    void browser.startQueuedJobs();
    return browser.queueSnapshot();
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
    await browser.prepareBrowserRuntime();
    const saved: string[] = [];
    for (const [index, path] of paths.entries()) {
      await browser.downloadBlob(path, (blob) => {
        const ext = browser.imageExtensionFromBlob(blob);
        return `gpt-image-2-${Date.now()}-${index + 1}.${ext}`;
      });
      saved.push(path);
    }
    return saved;
  },
  async exportJobToConfiguredFolder(jobId: string) {
    await browser.prepareBrowserRuntime();
    const { job } = await browserApi.getJob(jobId);
    return browser.downloadJobZip(job);
  },
  async createGenerate(body: GenerateRequest) {
    if (!body.prompt.trim()) throw new Error("Prompt is required.");
    const provider = browser.selectedProviderName(body.provider);
    const request = browser.cloneGenerateRequest(body);
    const job: Job = {
      id: browser.browserJobId(),
      command: "images generate",
      provider,
      status: "queued",
      created_at: browser.nowIso(),
      updated_at: browser.nowIso(),
      metadata: { ...request },
      outputs: [],
      error: null,
    };
    await browser.writeJobInput({ jobId: job.id, kind: "generate", request });
    return browser.enqueueBrowserTask(job, (task) => browser.runGenerateTask(task, request));
  },
  async createEdit(form: FormData) {
    const metaRaw = form.get("meta");
    const meta =
      typeof metaRaw === "string"
        ? (JSON.parse(metaRaw) as Record<string, unknown>)
        : {};
    if (!String(meta.prompt ?? "").trim())
      throw new Error("Prompt is required.");
    if (browser.sortedFiles(form, "ref_").length === 0) {
      throw new Error("At least one reference image is required.");
    }
    const provider = browser.selectedProviderName(String(meta.provider ?? ""));
    const job: Job = {
      id: browser.browserJobId(),
      command: "images edit",
      provider,
      status: "queued",
      created_at: browser.nowIso(),
      updated_at: browser.nowIso(),
      metadata: { ...meta, ref_count: browser.sortedFiles(form, "ref_").length },
      outputs: [],
      error: null,
    };
    await browser.writeJobInput(await browser.storedEditInputFromForm(job.id, form));
    return browser.enqueueBrowserTask(job, (task) => browser.runEditTask(task, form));
  },
  async retryJob(jobId: string) {
    await browser.prepareBrowserRuntime();
    const job = await browser.readStoredJob(jobId);
    if (!job) throw new Error("History job was not found.");
    const input = await browser.readJobInput(jobId);
    if (job.command === "images generate") {
      const request =
        input?.kind === "generate"
          ? input.request
          : browser.generateRequestFromJob(job);
      if (!request.prompt.trim()) {
        throw new Error("这个生成任务缺少 prompt，无法原样重试。");
      }
      return browserApi.createGenerate(request);
    }
    if (job.command === "images edit") {
      if (input?.kind !== "edit" || input.files.length === 0) {
        throw new Error("这个编辑任务缺少原始参考图，无法原样重试。");
      }
      return browserApi.createEdit(browser.formFromStoredEdit(input));
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
    return browser.objectUrls.get(path) ?? "";
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
    const handlers = browser.jobSubscribers.get(jobId) ?? new Set<EventHandler>();
    const wrapped: EventHandler = (event) => {
      onEvent(event);
      if (event.kind === "local" && isTerminalJobStatus(event.type.slice(4))) {
        onDone?.();
      }
    };
    handlers.add(wrapped);
    browser.jobSubscribers.set(jobId, handlers);
    for (const event of browser.eventLog.get(jobId) ?? []) wrapped(event);
    return () => {
      handlers.delete(wrapped);
      if (handlers.size === 0) browser.jobSubscribers.delete(jobId);
    };
  },
  subscribeJobUpdates(onEvent: JobUpdateHandler) {
    browser.updateSubscribers.add(onEvent);
    return () => browser.updateSubscribers.delete(onEvent);
  },
};
