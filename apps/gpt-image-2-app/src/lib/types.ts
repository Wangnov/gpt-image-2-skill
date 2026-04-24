export type CredentialSource = "file" | "env" | "keychain";
export type ProviderKind = "openai-compatible" | "openai" | "codex";

export interface CredentialRef {
  source: CredentialSource;
  value?: string | { _omitted: string };
  present?: boolean;
  env?: string;
  service?: string;
  account?: string;
}

export interface ProviderConfig {
  type: ProviderKind;
  api_base?: string;
  endpoint?: string;
  model?: string;
  supports_n?: boolean;
  edit_region_mode?: "native-mask" | "reference-hint" | "none";
  credentials: Record<string, CredentialRef>;
  builtin?: boolean;
  allow_overwrite?: boolean;
  set_default?: boolean;
}

export interface ServerConfig {
  version: 1;
  default_provider?: string;
  providers: Record<string, ProviderConfig>;
}

export type JobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface QueueStatus {
  max_parallel: number;
  running: number;
  queued: number;
  queued_job_ids: string[];
}

export interface OutputRef {
  index: number;
  path: string;
  bytes: number;
}

export interface Job {
  id: string;
  command: "images generate" | "images edit" | "request create";
  provider: string;
  status: JobStatus;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
  outputs: OutputRef[];
  output_path?: string;
  error?: Record<string, unknown> | null;
}

export interface JobEvent {
  seq: number;
  kind: "progress" | "sse" | "local";
  type: string;
  data: Record<string, unknown> & {
    message?: string;
    percent?: number;
    status?: string;
    output?: { path?: string };
  };
}

export interface GenerateRequest {
  prompt: string;
  provider?: string;
  size?: string;
  format?: string;
  quality?: string;
  background?: string;
  n?: number;
  compression?: number;
  moderation?: string;
  metadata?: Record<string, unknown>;
}

export interface TestProviderResult {
  ok: boolean;
  latency_ms: number;
  message: string;
  detail?: Record<string, unknown>;
}

export type Tweaks = {
  theme: "light" | "dark";
  accent: "green" | "black" | "blue" | "violet" | "orange";
  font: "system" | "mono" | "serif";
  density: "compact" | "comfortable";
  maxParallel: number;
  notifyOnComplete: boolean;
  notifyOnFailure: boolean;
};
