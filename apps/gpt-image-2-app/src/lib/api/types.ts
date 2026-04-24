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

export type RuntimeKind = "tauri" | "browser" | "http";

export type RuntimeCapabilities = {
  kind: RuntimeKind;
  canUseLocalFiles: boolean;
  canRevealFiles: boolean;
  canUseSystemCredentials: boolean;
  canUseCodexProvider: boolean;
  canExportToDownloadsFolder: boolean;
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
};

export type EventHandler = (ev: JobEvent) => void;
export type JobUpdateHandler = (jobId: string, ev: JobEvent) => void;

export type ApiClient = RuntimeCapabilities & {
  getConfig(): Promise<ServerConfig>;
  configPaths(): Promise<ConfigPaths>;
  setDefault(name: string): Promise<ServerConfig>;
  upsertProvider(name: string, cfg: ProviderConfig): Promise<ServerConfig>;
  revealProviderCredential(
    name: string,
    credential: string,
  ): Promise<{ value: string }>;
  deleteProvider(name: string): Promise<ServerConfig>;
  testProvider(name: string): Promise<TestProviderResult>;
  listJobs(): Promise<Job[]>;
  getJob(id: string): Promise<{ job: Job; events: JobEvent[] }>;
  deleteJob(id: string): Promise<void>;
  cancelJob(id: string): Promise<TauriJobResponse>;
  queueStatus(): Promise<QueueStatus>;
  setQueueConcurrency(maxParallel: number): Promise<QueueStatus>;
  openPath(path: string): Promise<void>;
  revealPath(path: string): Promise<void>;
  exportFilesToDownloads(paths: string[]): Promise<string[]>;
  createGenerate(body: GenerateRequest): Promise<TauriJobResponse>;
  createEdit(form: FormData): Promise<TauriJobResponse>;
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

export function isTerminalJobStatus(status: string) {
  return TERMINAL_JOB_STATUSES.has(status);
}
