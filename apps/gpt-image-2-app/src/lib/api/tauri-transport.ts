import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
  JobListOptions,
  JobListPage,
  JobUpdateHandler,
  StorageTestResult,
  TauriJobResponse,
} from "./types";
import { isTerminalJobStatus } from "./types";

type QueueEventPayload = {
  job_id?: string;
  event?: JobEvent;
};

function rememberEventJob(event: JobEvent) {
  const job = event.data?.job;
  if (job && typeof job === "object") {
    rememberJobOutputs(normalizeJob(job as Record<string, unknown>));
  }
}

function jobTimestamp(job: Job) {
  const raw = job.created_at || job.updated_at || "";
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && raw.trim() !== "") return numeric * 1000;
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function mergeJobsById(jobs: Job[]) {
  const byId = new Map<string, Job>();
  for (const job of jobs) byId.set(job.id, job);
  return Array.from(byId.values()).sort(
    (a, b) => jobTimestamp(b) - jobTimestamp(a),
  );
}

function subscribeTauriJobUpdates(onEvent: JobUpdateHandler) {
  let disposed = false;
  let unlisten: (() => void) | undefined;
  void listen<QueueEventPayload>("gpt-image-2-job-event", (message) => {
    const jobId = message.payload?.job_id;
    const event = message.payload?.event;
    if (!jobId || !event) return;
    rememberEventJob(event);
    onEvent(jobId, event);
  }).then((fn) => {
    if (disposed) {
      fn();
    } else {
      unlisten = fn;
    }
  });
  return () => {
    disposed = true;
    unlisten?.();
  };
}

export const tauriApi: ApiClient = {
  kind: "tauri",
  canUseLocalFiles: true,
  canRevealFiles: true,
  canUseSystemCredentials: true,
  canUseCodexProvider: true,
  canExportToDownloadsFolder: true,
  canExportToConfiguredFolder: true,
  canChooseExportFolder: false,
  canUsePersistentResultLibrary: true,
  async getConfig() {
    return normalizeConfig(await invoke<ServerConfig>("get_config"));
  },
  async configPaths() {
    return invoke<ConfigPaths>("config_path");
  },
  async updateNotifications(config: NotificationConfig) {
    return normalizeConfig(
      await invoke<ServerConfig>("update_notifications", { config }),
    );
  },
  async testNotifications(status?: JobStatus) {
    return invoke<NotificationTestResult>("test_notifications", {
      input: { status: status ?? "completed" },
    });
  },
  async notificationCapabilities() {
    return invoke<NotificationCapabilities>("notification_capabilities");
  },
  async updatePaths(config: PathConfig) {
    return normalizeConfig(await invoke<ServerConfig>("update_paths", { config }));
  },
  async updateStorage(config: StorageConfig) {
    return normalizeConfig(await invoke<ServerConfig>("update_storage", { config }));
  },
  async testStorageTarget(name: string, target?: StorageTargetConfig) {
    return invoke<StorageTestResult>("test_storage_target", { name, target });
  },
  async setDefault(name: string) {
    return normalizeConfig(
      await invoke<ServerConfig>("set_default_provider", { name }),
    );
  },
  async upsertProvider(name: string, cfg: ProviderConfig) {
    return normalizeConfig(
      await invoke<ServerConfig>("upsert_provider", { name, cfg }),
    );
  },
  async revealProviderCredential(name: string, credential: string) {
    return invoke<{ value: string }>("reveal_provider_credential", {
      name,
      credential,
    });
  },
  async deleteProvider(name: string) {
    return normalizeConfig(
      await invoke<ServerConfig>("delete_provider", { name }),
    );
  },
  async testProvider(name: string) {
    return invoke<TestProviderResult>("provider_test", { name });
  },
  async listJobs() {
    const [page, active] = await Promise.all([
      tauriApi.listJobsPage({ limit: 100 }),
      tauriApi.listActiveJobs(),
    ]);
    return mergeJobsById([...active, ...page.jobs]);
  },
  async listJobsPage(options: JobListOptions = {}) {
    const payload = await invoke<{
      jobs: Record<string, unknown>[];
      next_cursor?: string | null;
      has_more?: boolean;
      total?: number;
    }>("history_list", {
      limit: options.limit,
      cursor: options.cursor,
      status:
        options.filter && options.filter !== "all" ? options.filter : undefined,
      query: options.query?.trim() || undefined,
    });
    return {
      jobs: (payload.jobs ?? []).map(normalizeJob),
      next_cursor: payload.next_cursor ?? null,
      has_more: Boolean(payload.has_more),
      total: Number(payload.total ?? payload.jobs?.length ?? 0),
    } satisfies JobListPage;
  },
  async listActiveJobs() {
    const payload = await invoke<{ jobs: Record<string, unknown>[] }>(
      "history_active_list",
    );
    return (payload.jobs ?? []).map(normalizeJob);
  },
  async getJob(id: string) {
    const payload = await invoke<{
      job: Record<string, unknown>;
      events?: JobEvent[];
    }>("history_show", { jobId: id });
    const job = normalizeJob(payload.job ?? {});
    return { job, events: payload.events ?? [] };
  },
  async deleteJob(id: string) {
    await invoke("history_delete", { jobId: id });
  },
  async softDeleteJob(id: string) {
    await invoke("soft_delete_job", { jobId: id });
  },
  async restoreDeletedJob(id: string) {
    await invoke("restore_deleted_job", { jobId: id });
  },
  async hardDeleteJob(id: string) {
    await invoke("hard_delete_job", { jobId: id });
  },
  async copyImageToClipboard(path: string, prompt?: string | null) {
    await invoke("copy_image_to_clipboard", { path, prompt: prompt ?? null });
  },
  async cancelJob(id: string) {
    const result = await invoke<TauriJobResponse>("cancel_job", { jobId: id });
    return normalizeJobResponse(result);
  },
  async queueStatus() {
    return invoke<QueueStatus>("queue_status");
  },
  async setQueueConcurrency(maxParallel: number) {
    return invoke<QueueStatus>("set_queue_concurrency", { maxParallel });
  },
  async openPath(path: string) {
    await invoke("open_path", { path });
  },
  async revealPath(path: string) {
    await invoke("reveal_path", { path });
  },
  async exportFilesToDownloads(paths: string[]) {
    return tauriApi.exportFilesToConfiguredFolder(paths);
  },
  async exportJobToDownloads(jobId: string) {
    return tauriApi.exportJobToConfiguredFolder(jobId);
  },
  async exportFilesToConfiguredFolder(paths: string[]) {
    return invoke<string[]>("export_files_to_configured_folder", { paths });
  },
  async exportJobToConfiguredFolder(jobId: string) {
    return invoke<string[]>("export_job_to_configured_folder", { jobId });
  },
  async createGenerate(body: GenerateRequest) {
    const result = await invoke<TauriJobResponse>("enqueue_generate_image", {
      request: body,
    });
    return normalizeJobResponse(result);
  },
  async createEdit(form: FormData) {
    const metaRaw = form.get("meta");
    const meta = typeof metaRaw === "string" ? JSON.parse(metaRaw) : {};
    const refs: Awaited<ReturnType<typeof fileToUpload>>[] = [];
    let mask: Awaited<ReturnType<typeof fileToUpload>> | undefined;
    for (const [key, value] of form.entries()) {
      if (key.startsWith("ref_") && value instanceof File) {
        refs.push(await fileToUpload(value));
      }
      if (key === "mask" && value instanceof File) {
        mask = await fileToUpload(value);
      }
    }
    const selectionHintRaw = form.get("selection_hint");
    const selection_hint =
      selectionHintRaw instanceof File
        ? await fileToUpload(selectionHintRaw)
        : undefined;
    const result = await invoke<TauriJobResponse>("enqueue_edit_image", {
      request: {
        ...meta,
        refs,
        mask,
        selection_hint,
      },
    });
    return normalizeJobResponse(result);
  },
  async retryJob(jobId: string) {
    const result = await invoke<TauriJobResponse>("retry_job", { jobId });
    return normalizeJobResponse(result);
  },
  outputUrl(jobId: string, index = 0) {
    const path = outputPath(jobId, index);
    return path ? convertFileSrc(path) : "";
  },
  outputPath,
  fileUrl(path?: string | null) {
    return path ? convertFileSrc(path) : "";
  },
  jobOutputUrl(job: Job, index = 0) {
    const direct = job.outputs.find((output) => output.index === index)?.path;
    if (direct) return convertFileSrc(direct);
    const remembered = outputPath(job.id, index);
    if (remembered) return convertFileSrc(remembered);
    if (index === 0 && job.outputs.length === 0 && job.output_path) {
      return convertFileSrc(job.output_path);
    }
    return "";
  },
  jobOutputPath,
  jobOutputPaths,
  subscribeJobEvents(jobId, onEvent, onDone) {
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
        const payload = await tauriApi.getJob(jobId);
        for (const event of payload.events ?? []) deliver(event);
        if (isTerminalJobStatus(payload.job.status)) {
          seq += 1;
          deliver({
            seq,
            kind: "local",
            type: `job.${payload.job.status}`,
            data: {
              status: payload.job.status,
              output: { path: payload.job.output_path },
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

    const unlisten = subscribeTauriJobUpdates((nextJobId, event) => {
      if (nextJobId === jobId) deliver(event);
    });
    void poll();
    const timer = window.setInterval(poll, 1_200);
    return () => {
      closed = true;
      window.clearInterval(timer);
      unlisten();
    };
  },
  subscribeJobUpdates: subscribeTauriJobUpdates,
};
