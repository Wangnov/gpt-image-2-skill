import type {
  Job,
  NotificationConfig,
  OutputUploadRef,
  OutputRef,
  PathConfig,
  ServerConfig,
  StorageConfig,
  StorageFallbackPolicy,
  StorageTargetConfig,
} from "../types";
import type { TauriJobResponse } from "./types";

export const outputPaths = new Map<string, string>();

export function rememberJobOutputs(
  job?: Partial<Job> | null,
  payload?: TauriJobResponse["payload"],
) {
  if (!job?.id) return;
  for (const output of job.outputs ?? []) {
    outputPaths.set(`${job.id}:${output.index}`, output.path);
  }
  // Only fall back to output_path as index 0 when outputs is empty
  // (legacy single-shot jobs). During streaming, output_path may point at
  // an arbitrary index and must not masquerade as index 0.
  if (job.output_path && (!job.outputs || job.outputs.length === 0)) {
    outputPaths.set(`${job.id}:0`, job.output_path);
  }
  const files = payload?.output?.files ?? [];
  for (const output of files) {
    outputPaths.set(`${job.id}:${output.index}`, output.path);
  }
  const primary = payload?.output?.path;
  if (primary && files.length === 0) {
    outputPaths.set(`${job.id}:0`, primary);
  }
}

export function normalizeJob(raw: Record<string, unknown>): Job {
  const metadata = (
    raw.metadata && typeof raw.metadata === "object" ? raw.metadata : {}
  ) as Record<string, unknown>;
  const output = (
    metadata.output && typeof metadata.output === "object"
      ? metadata.output
      : {}
  ) as {
    files?: OutputRef[];
    path?: string | null;
  };
  const outputs = Array.isArray(raw.outputs)
    ? normalizeOutputs(raw.outputs)
    : Array.isArray(output.files)
      ? normalizeOutputs(output.files)
      : [];
  const outputPath =
    typeof raw.output_path === "string"
      ? raw.output_path
      : typeof output.path === "string"
        ? output.path
        : outputs[0]?.path;
  const rawStatus = String(raw.status ?? "completed");
  const status = rawStatus === "canceled" ? "cancelled" : rawStatus;
  const job: Job = {
    id: String(raw.id ?? ""),
    command: (raw.command as Job["command"]) ?? "images generate",
    provider: String(raw.provider ?? "auto"),
    status: (status as Job["status"]) ?? "completed",
    created_at: String(raw.created_at ?? ""),
    updated_at: String(raw.updated_at ?? raw.created_at ?? ""),
    metadata,
    outputs,
    output_path: outputPath,
    storage_status:
      typeof raw.storage_status === "string"
        ? raw.storage_status
        : "not_configured",
    error: (raw.error as Job["error"]) ?? null,
  };
  rememberJobOutputs(job);
  return job;
}

function safeHttpUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? value
      : null;
  } catch {
    return null;
  }
}

function normalizeOutputs(value: unknown[]): OutputRef[] {
  return value.map((item, index) => {
    const raw =
      item && typeof item === "object"
        ? (item as Record<string, unknown>)
        : {};
    return {
      index: Number.isFinite(Number(raw.index)) ? Number(raw.index) : index,
      path: String(raw.path ?? ""),
      bytes: Number.isFinite(Number(raw.bytes)) ? Number(raw.bytes) : 0,
      uploads: Array.isArray(raw.uploads)
        ? raw.uploads.map(normalizeOutputUpload)
        : [],
    };
  });
}

function normalizeOutputUpload(value: unknown): OutputUploadRef {
  const raw =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return {
    target: String(raw.target ?? ""),
    target_type: String(raw.target_type ?? "unknown"),
    status: String(raw.status ?? "pending"),
    url: safeHttpUrl(raw.url),
    error: typeof raw.error === "string" ? raw.error : null,
    bytes: Number.isFinite(Number(raw.bytes)) ? Number(raw.bytes) : null,
    attempts: Number.isFinite(Number(raw.attempts))
      ? Number(raw.attempts)
      : 0,
    updated_at:
      typeof raw.updated_at === "string" ? raw.updated_at : undefined,
    metadata:
      raw.metadata && typeof raw.metadata === "object"
        ? (raw.metadata as Record<string, unknown>)
        : null,
  };
}

export function normalizeJobResponse(raw: TauriJobResponse): TauriJobResponse {
  const job = raw.job
    ? normalizeJob(raw.job as unknown as Record<string, unknown>)
    : undefined;
  rememberJobOutputs(job, raw.payload);
  return { ...raw, job };
}

export function defaultNotificationConfig(): NotificationConfig {
  return {
    enabled: true,
    on_completed: true,
    on_failed: true,
    on_cancelled: true,
    toast: { enabled: true },
    system: { enabled: false, mode: "auto" },
    email: {
      enabled: false,
      smtp_host: "",
      smtp_port: 587,
      tls: "start-tls",
      username: undefined,
      password: null,
      from: "",
      to: [],
      timeout_seconds: 10,
    },
    webhooks: [],
  };
}

export function defaultStorageConfig(): StorageConfig {
  return {
    targets: {
      "local-default": {
        type: "local",
        directory: "",
        public_base_url: null,
      },
    },
    default_targets: [],
    fallback_targets: ["local-default"],
    fallback_policy: "on_failure",
    upload_concurrency: 4,
    target_concurrency: 2,
  };
}

export function defaultPathConfig(): PathConfig {
  return {
    app_data_dir: { mode: "default", path: null },
    result_library_dir: { mode: "default", path: null },
    default_export_dir: { mode: "downloads", path: null },
    legacy_shared_codex_dir: {
      path: "~/.codex/gpt-image-2-skill",
      enabled_for_read: true,
    },
  };
}

export function storageTargetType(target?: StorageTargetConfig | null) {
  if (!target) return "local";
  if (target.type) return target.type;
  if ("bucket" in target) return "s3";
  if ("remote_dir" in target) return "sftp";
  if ("method" in target || "public_url_json_pointer" in target) return "http";
  if ("url" in target) return "webdav";
  return "local";
}

function normalizeStorageTarget(target: StorageTargetConfig): StorageTargetConfig {
  const type = storageTargetType(target);
  if (type === "s3") {
    return {
      type,
      bucket: "bucket" in target ? target.bucket : "",
      region: "region" in target ? (target.region ?? null) : null,
      endpoint: "endpoint" in target ? (target.endpoint ?? null) : null,
      prefix: "prefix" in target ? (target.prefix ?? null) : null,
      access_key_id:
        "access_key_id" in target ? (target.access_key_id ?? null) : null,
      secret_access_key:
        "secret_access_key" in target
          ? (target.secret_access_key ?? null)
          : null,
      session_token:
        "session_token" in target ? (target.session_token ?? null) : null,
      public_base_url:
        "public_base_url" in target ? (target.public_base_url ?? null) : null,
    };
  }
  if (type === "webdav") {
    return {
      type,
      url: "url" in target ? target.url : "",
      username: "username" in target ? (target.username ?? null) : null,
      password: "password" in target ? (target.password ?? null) : null,
      public_base_url:
        "public_base_url" in target ? (target.public_base_url ?? null) : null,
    };
  }
  if (type === "http") {
    return {
      type,
      url: "url" in target ? target.url : "",
      method: "method" in target ? target.method || "POST" : "POST",
      headers: "headers" in target ? (target.headers ?? {}) : {},
      public_url_json_pointer:
        "public_url_json_pointer" in target
          ? (target.public_url_json_pointer ?? null)
          : null,
    };
  }
  if (type === "sftp") {
    return {
      type,
      host: "host" in target ? target.host : "",
      port: "port" in target ? Number(target.port || 22) : 22,
      host_key_sha256:
        "host_key_sha256" in target ? (target.host_key_sha256 ?? null) : null,
      username:
        "username" in target && typeof target.username === "string"
          ? target.username
          : "",
      password: "password" in target ? (target.password ?? null) : null,
      private_key:
        "private_key" in target ? (target.private_key ?? null) : null,
      remote_dir:
        "remote_dir" in target && typeof target.remote_dir === "string"
          ? target.remote_dir
          : "",
      public_base_url:
        "public_base_url" in target ? (target.public_base_url ?? null) : null,
    };
  }
  return {
    type: "local",
    directory: "directory" in target ? target.directory : "",
    public_base_url:
      "public_base_url" in target ? (target.public_base_url ?? null) : null,
  };
}

export function normalizeStorageConfig(
  config?: Partial<StorageConfig> | null,
): StorageConfig {
  const defaults = defaultStorageConfig();
  const targets = Object.fromEntries(
    Object.entries(config?.targets ?? defaults.targets).map(([name, target]) => [
      name,
      normalizeStorageTarget(target as StorageTargetConfig),
    ]),
  );
  const fallbackPolicy = String(
    config?.fallback_policy ?? defaults.fallback_policy,
  ) as StorageFallbackPolicy;
  return {
    targets,
    default_targets: Array.isArray(config?.default_targets)
      ? config.default_targets
      : defaults.default_targets,
    fallback_targets: Array.isArray(config?.fallback_targets)
      ? config.fallback_targets
      : defaults.fallback_targets,
    fallback_policy: ["never", "on_failure", "always"].includes(fallbackPolicy)
      ? fallbackPolicy
      : defaults.fallback_policy,
    upload_concurrency: Math.max(
      1,
      Math.round(Number(config?.upload_concurrency ?? defaults.upload_concurrency)),
    ),
    target_concurrency: Math.max(
      1,
      Math.round(Number(config?.target_concurrency ?? defaults.target_concurrency)),
    ),
  };
}

export function normalizePathConfig(
  config?: Partial<PathConfig> | null,
): PathConfig {
  const defaults = defaultPathConfig();
  const pathRef = (
    value: Partial<PathConfig["app_data_dir"]> | undefined,
  ): PathConfig["app_data_dir"] => ({
    mode: value?.mode === "custom" ? "custom" : "default",
    path: typeof value?.path === "string" && value.path ? value.path : null,
  });
  const exportDir = (
    value: Partial<PathConfig["default_export_dir"]> | undefined,
  ): PathConfig["default_export_dir"] => {
    const allowed = new Set([
      "downloads",
      "documents",
      "pictures",
      "result_library",
      "custom",
      "browser_default",
    ]);
    return {
      mode: allowed.has(String(value?.mode))
        ? (value?.mode as PathConfig["default_export_dir"]["mode"])
        : defaults.default_export_dir.mode,
      path: typeof value?.path === "string" && value.path ? value.path : null,
    };
  };
  return {
    app_data_dir: pathRef(config?.app_data_dir),
    result_library_dir: pathRef(config?.result_library_dir),
    default_export_dir: exportDir(config?.default_export_dir),
    legacy_shared_codex_dir: {
      path:
        typeof config?.legacy_shared_codex_dir?.path === "string" &&
        config.legacy_shared_codex_dir.path
          ? config.legacy_shared_codex_dir.path
          : defaults.legacy_shared_codex_dir.path,
      enabled_for_read:
        config?.legacy_shared_codex_dir?.enabled_for_read !== false,
    },
  };
}

export function normalizeNotificationConfig(
  config?: Partial<NotificationConfig> | null,
): NotificationConfig {
  const defaults = defaultNotificationConfig();
  return {
    ...defaults,
    ...(config ?? {}),
    toast: { ...defaults.toast, ...(config?.toast ?? {}) },
    system: { ...defaults.system, ...(config?.system ?? {}) },
    email: {
      ...defaults.email,
      ...(config?.email ?? {}),
      to: Array.isArray(config?.email?.to) ? config.email.to : [],
      smtp_port: Number(config?.email?.smtp_port ?? defaults.email.smtp_port),
      timeout_seconds: Number(
        config?.email?.timeout_seconds ?? defaults.email.timeout_seconds,
      ),
    },
    webhooks: Array.isArray(config?.webhooks)
      ? config.webhooks.map((webhook) => ({
          id: webhook.id,
          name: webhook.name ?? "",
          enabled: webhook.enabled !== false,
          url: webhook.url,
          method: webhook.method || "POST",
          headers: webhook.headers ?? {},
          timeout_seconds: Number(webhook.timeout_seconds ?? 10),
        }))
      : [],
  };
}

export function normalizeConfig(config: ServerConfig): ServerConfig {
  return {
    version: config.version,
    default_provider: config.default_provider,
    providers: Object.fromEntries(
      Object.entries(config.providers ?? {}).map(([name, provider]) => [
        name,
        {
          ...provider,
          credentials: provider.credentials ?? {},
        },
      ]),
    ),
    notifications: normalizeNotificationConfig(config.notifications),
    storage: normalizeStorageConfig(config.storage),
    paths: normalizePathConfig(config.paths),
  };
}

export function outputPath(jobId: string, index = 0) {
  return (
    outputPaths.get(`${jobId}:${index}`) ??
    (index === 0 ? outputPaths.get(`${jobId}:0`) : undefined)
  );
}

export function jobOutputPath(job: Job, index = 0) {
  const direct = job.outputs.find((output) => output.index === index)?.path;
  if (direct) return direct;
  if (index === 0 && job.outputs.length === 0 && job.output_path) {
    return job.output_path;
  }
  return undefined;
}

export function jobOutputPaths(job: Job) {
  const paths = job.outputs
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((output) => output.path)
    .filter(Boolean);
  if (paths.length > 0) return paths;
  return job.output_path ? [job.output_path] : [];
}

export async function fileToUpload(file: File) {
  return {
    name: file.name,
    bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
  };
}
