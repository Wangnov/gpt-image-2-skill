import type {
  GenerateRequest,
  Job,
  JobEvent,
  JobStatus,
  NotificationCapabilities,
  NotificationConfig,
  NotificationTestResult,
  OutputRef,
  ExportDirMode,
  PathConfig,
  ProviderConfig,
  QueueStatus,
  ServerConfig,
  StorageConfig,
  StorageTargetConfig,
  TestProviderResult,
} from "../types";

export type RuntimeKind = "tauri" | "browser" | "http";

export type RuntimeCapabilities = {
  kind: RuntimeKind;
  canUseLocalFiles: boolean;
  canRevealFiles: boolean;
  canUseSystemCredentials: boolean;
  canUseCodexProvider: boolean;
  canExportToDownloadsFolder: boolean;
  canExportToConfiguredFolder: boolean;
  canChooseExportFolder: boolean;
  canUsePersistentResultLibrary: boolean;
};

export type TauriJobResponse = {
  job_id: string;
  job?: Job;
  events?: JobEvent[];
  queue?: QueueStatus;
  queued?: boolean;
  canceled?: boolean;
  payload?: {
    output?: {
      path?: string | null;
      files?: OutputRef[];
    };
  };
};

export type ConfigPaths = {
  config_dir: string;
  config_file: string;
  history_file: string;
  jobs_dir: string;
  app_data_dir?: string;
  result_library_dir?: string;
  default_export_dir?: string;
  default_export_dirs?: Partial<Record<ExportDirMode, string>>;
  storage_fallback_dir?: string;
  legacy_codex_config_dir?: string;
  legacy_jobs_dir?: string;
};

export type EventHandler = (ev: JobEvent) => void;
export type JobUpdateHandler = (jobId: string, ev: JobEvent) => void;
export type JobListFilter = "all" | "running" | "completed" | "failed";

export type JobListOptions = {
  limit?: number;
  cursor?: string;
  filter?: JobListFilter;
  query?: string;
};

export type JobListPage = {
  jobs: Job[];
  next_cursor?: string | null;
  has_more: boolean;
  total: number;
};

export type StorageTestResult = {
  ok: boolean;
  target: string;
  target_type?: string;
  message: string;
  latency_ms?: number;
  detail?: Record<string, unknown>;
  unsupported?: boolean;
  local_only?: boolean;
};

export type ApiClient = RuntimeCapabilities & {
  getConfig(): Promise<ServerConfig>;
  configPaths(): Promise<ConfigPaths>;
  updateNotifications(config: NotificationConfig): Promise<ServerConfig>;
  testNotifications(status?: JobStatus): Promise<NotificationTestResult>;
  notificationCapabilities(): Promise<NotificationCapabilities>;
  updatePaths?(config: PathConfig): Promise<ServerConfig>;
  updateStorage?(config: StorageConfig): Promise<ServerConfig>;
  testStorageTarget?(
    name: string,
    target?: StorageTargetConfig,
  ): Promise<StorageTestResult>;
  setDefault(name: string): Promise<ServerConfig>;
  upsertProvider(name: string, cfg: ProviderConfig): Promise<ServerConfig>;
  revealProviderCredential(
    name: string,
    credential: string,
  ): Promise<{ value: string }>;
  deleteProvider(name: string): Promise<ServerConfig>;
  testProvider(name: string): Promise<TestProviderResult>;
  listJobs(): Promise<Job[]>;
  listJobsPage(options?: JobListOptions): Promise<JobListPage>;
  listActiveJobs(): Promise<Job[]>;
  getJob(id: string): Promise<{ job: Job; events: JobEvent[] }>;
  deleteJob(id: string): Promise<void>;
  /**
   * Soft delete: hide a job from listings but keep it recoverable for the
   * 5-second undo window. On Tauri this moves the job folder into
   * `result_library_dir/.trash/<id>` and sets the SQLite `deleted_at` timestamp; on
   * HTTP / Browser runtimes this falls back to a hard delete (no undo).
   */
  softDeleteJob(id: string): Promise<void>;
  /**
   * Reverse a soft delete. Tauri-only meaningful operation; other runtimes
   * throw because they have no recoverable trash state.
   */
  restoreDeletedJob(id: string): Promise<void>;
  /**
   * Permanently delete a job from the result library and then DELETE the
   * history row. Remote uploaded objects are not deleted by default.
   */
  hardDeleteJob(id: string): Promise<void>;
  /**
   * Tauri-only: read `path` from disk, decode as image, and write to the
   * system clipboard via `tauri-plugin-clipboard-manager`. Optionally also
   * writes `prompt` as plain text in the same write so a single Cmd+V on the
   * far side can yield image + prompt.
   *
   * On HTTP / Browser runtimes the executor is expected to use
   * `navigator.clipboard.write([new ClipboardItem(...)])` directly instead of
   * calling this method.
   */
  copyImageToClipboard(path: string, prompt?: string | null): Promise<void>;
  cancelJob(id: string): Promise<TauriJobResponse>;
  queueStatus(): Promise<QueueStatus>;
  setQueueConcurrency(maxParallel: number): Promise<QueueStatus>;
  openPath(path: string): Promise<void>;
  revealPath(path: string): Promise<void>;
  exportFilesToDownloads(paths: string[]): Promise<string[]>;
  exportJobToDownloads(jobId: string): Promise<string[]>;
  exportFilesToConfiguredFolder(paths: string[]): Promise<string[]>;
  exportJobToConfiguredFolder(jobId: string): Promise<string[]>;
  createGenerate(body: GenerateRequest): Promise<TauriJobResponse>;
  createEdit(form: FormData): Promise<TauriJobResponse>;
  retryJob(jobId: string): Promise<TauriJobResponse>;
  outputUrl(jobId: string, index?: number): string;
  outputPath(jobId: string, index?: number): string | undefined;
  fileUrl(path?: string | null): string;
  jobOutputUrl(job: Job, index?: number): string;
  jobOutputPath(job: Job, index?: number): string | undefined;
  jobOutputPaths(job: Job): string[];
  subscribeJobEvents(
    jobId: string,
    onEvent: EventHandler,
    onDone?: () => void,
  ): () => void;
  subscribeJobUpdates(onEvent: JobUpdateHandler): () => void;
};

export const TERMINAL_JOB_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "canceled",
]);

export const ACTIVE_JOB_STATUSES = new Set(["queued", "running", "uploading"]);

export function isTerminalJobStatus(status: string) {
  return TERMINAL_JOB_STATUSES.has(status);
}

export function isActiveJobStatus(status: string) {
  return ACTIVE_JOB_STATUSES.has(status);
}
