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
