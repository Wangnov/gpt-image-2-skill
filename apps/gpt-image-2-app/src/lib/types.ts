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
  disabled?: boolean;
  disabled_reason?: string;
  allow_overwrite?: boolean;
  set_default?: boolean;
}

export type EmailTlsMode = "start-tls" | "smtps" | "none";

export interface ToastNotificationConfig {
  enabled: boolean;
}

export interface SystemNotificationConfig {
  enabled: boolean;
  mode: "auto" | "tauri" | "browser" | string;
}

export interface EmailNotificationConfig {
  enabled: boolean;
  smtp_host: string;
  smtp_port: number;
  tls: EmailTlsMode;
  username?: string | null;
  password?: CredentialRef | null;
  from: string;
  to: string[];
  timeout_seconds: number;
}

export interface WebhookNotificationConfig {
  id: string;
  name: string;
  enabled: boolean;
  url: string;
  method: string;
  headers: Record<string, CredentialRef>;
  timeout_seconds: number;
}

export interface NotificationConfig {
  enabled: boolean;
  on_completed: boolean;
  on_failed: boolean;
  on_cancelled: boolean;
  toast: ToastNotificationConfig;
  system: SystemNotificationConfig;
  email: EmailNotificationConfig;
  webhooks: WebhookNotificationConfig[];
}

export type StorageTargetKind =
  | "local"
  | "s3"
  | "webdav"
  | "http"
  | "sftp"
  | "baidu_netdisk"
  | "pan123_open";
export type BaiduNetdiskAuthMode = "personal" | "oauth";
export type Pan123OpenAuthMode = "client" | "access_token";
export type StorageFallbackPolicy = "never" | "on_failure" | "always";
export type StorageStatus =
  | "not_configured"
  | "pending"
  | "running"
  | "completed"
  | "partial_failed"
  | "failed"
  | "fallback_completed";
export type OutputUploadStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "unsupported";

export interface LocalStorageTargetConfig {
  type?: "local";
  directory: string;
  public_base_url?: string | null;
}

export interface S3StorageTargetConfig {
  type?: "s3";
  bucket: string;
  region?: string | null;
  endpoint?: string | null;
  prefix?: string | null;
  access_key_id?: CredentialRef | null;
  secret_access_key?: CredentialRef | null;
  session_token?: CredentialRef | null;
  public_base_url?: string | null;
}

export interface WebDavStorageTargetConfig {
  type?: "webdav";
  url: string;
  username?: string | null;
  password?: CredentialRef | null;
  public_base_url?: string | null;
}

export interface HttpStorageTargetConfig {
  type?: "http";
  url: string;
  method: string;
  headers: Record<string, CredentialRef>;
  public_url_json_pointer?: string | null;
}

export interface SftpStorageTargetConfig {
  type?: "sftp";
  host: string;
  port: number;
  host_key_sha256?: string | null;
  username: string;
  password?: CredentialRef | null;
  private_key?: CredentialRef | null;
  remote_dir: string;
  public_base_url?: string | null;
}

export interface BaiduNetdiskStorageTargetConfig {
  type?: "baidu_netdisk";
  auth_mode?: BaiduNetdiskAuthMode;
  app_key: string;
  secret_key?: CredentialRef | null;
  access_token?: CredentialRef | null;
  refresh_token?: CredentialRef | null;
  app_name: string;
  remote_dir?: string | null;
  public_base_url?: string | null;
}

export interface Pan123OpenStorageTargetConfig {
  type?: "pan123_open";
  auth_mode?: Pan123OpenAuthMode;
  client_id: string;
  client_secret?: CredentialRef | null;
  access_token?: CredentialRef | null;
  parent_id: number;
  use_direct_link: boolean;
}

export type StorageTargetConfig =
  | LocalStorageTargetConfig
  | S3StorageTargetConfig
  | WebDavStorageTargetConfig
  | HttpStorageTargetConfig
  | SftpStorageTargetConfig
  | BaiduNetdiskStorageTargetConfig
  | Pan123OpenStorageTargetConfig;

export interface StorageConfig {
  targets: Record<string, StorageTargetConfig>;
  default_targets: string[];
  fallback_targets: string[];
  fallback_policy: StorageFallbackPolicy;
  upload_concurrency: number;
  target_concurrency: number;
}

export type PathMode = "default" | "custom";
export type ExportDirMode =
  | "downloads"
  | "documents"
  | "pictures"
  | "result_library"
  | "custom"
  | "browser_default";

export interface PathRef {
  mode: PathMode;
  path?: string | null;
}

export interface ExportDirConfig {
  mode: ExportDirMode;
  path?: string | null;
}

export interface LegacyPathConfig {
  path: string;
  enabled_for_read: boolean;
}

export interface PathConfig {
  app_data_dir: PathRef;
  result_library_dir: PathRef;
  default_export_dir: ExportDirConfig;
  legacy_shared_codex_dir: LegacyPathConfig;
}

export interface OutputUploadRef {
  target: string;
  target_type: StorageTargetKind | string;
  status: OutputUploadStatus | string;
  url?: string | null;
  error?: string | null;
  bytes?: number | null;
  attempts?: number;
  updated_at?: string;
  metadata?: Record<string, unknown> | null;
}

export interface NotificationDelivery {
  channel: string;
  name?: string;
  ok: boolean;
  message: string;
}

export interface NotificationTestResult {
  ok: boolean;
  deliveries: NotificationDelivery[];
  reason?: string | null;
}

export interface NotificationCapabilities {
  system: {
    tauri_native: boolean;
    browser: boolean;
  };
  server: {
    email: boolean;
    webhook: boolean;
  };
}

export interface ServerConfig {
  version: 1;
  default_provider?: string;
  providers: Record<string, ProviderConfig>;
  notifications: NotificationConfig;
  storage: StorageConfig;
  paths: PathConfig;
}

export type JobStatus =
  | "queued"
  | "running"
  | "uploading"
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
  uploads?: OutputUploadRef[];
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
  storage_status?: StorageStatus | string;
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
    output?: { path?: string; files?: OutputRef[] };
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

import type { ThemePresetId } from "./theme-presets";

export type InterfaceMode = "modern" | "legacy";

export type Tweaks = {
  /**
   * Theme is single-value liquid dark — kept in the type only to preserve
   * older localStorage payloads. UI no longer exposes the toggle.
   */
  theme: "light" | "dark";
  /**
   * Same story for accent — fixed violet→cyan brand gradient now.
   */
  accent: "green" | "black" | "blue" | "violet" | "orange";
  font: "system" | "mono" | "serif";
  density: "compact" | "comfortable";
  maxParallel: number;
  notifyOnComplete: boolean;
  notifyOnFailure: boolean;
  /**
   * @deprecated Superseded by `themePreset`. The Mesh Mono preset is
   * now the static-background option; this flag is read from older
   * localStorage payloads but no longer exposed in the UI. Will be
   * removed once we're confident no old client persists it.
   */
  liquidBackground: boolean;
  /**
   * Glass panel opacity, expressed as a 0–100 percentage. Lower values
   * make panels more see-through, higher values make panels more solid.
   * Semantics shift slightly per surface style: paper-style surfaces
   * use it as a border-strength multiplier, neon-style uses it as a
   * ring-radius multiplier. Stored as a percentage so settings UI
   * doesn't have to deal with floats.
   */
  glassOpacity: number;
  /**
   * Active theme preset. Drives the WindowChrome background, the
   * accent color triplets, surface style, and (on switch) suggested
   * font/density. See `lib/theme-presets.ts`.
   */
  themePreset: ThemePresetId;
  /**
   * Visual shell mode. "modern" is the new themed canvas; "legacy"
   * restores the older three-column workbench and intentionally avoids
   * always-on animated backgrounds/glass filters.
   */
  interfaceMode: InterfaceMode;
  /**
   * Persist modern generate/edit form drafts across browser refreshes and app
   * restarts. Classic mode intentionally keeps its existing behavior.
   */
  persistCreativeDrafts: boolean;
};
