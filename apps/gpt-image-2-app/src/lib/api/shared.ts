import type {
  Job,
  NotificationConfig,
  OutputRef,
  ServerConfig,
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
    ? (raw.outputs as OutputRef[])
    : Array.isArray(output.files)
      ? output.files
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
    error: (raw.error as Job["error"]) ?? null,
  };
  rememberJobOutputs(job);
  return job;
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
