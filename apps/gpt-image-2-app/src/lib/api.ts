import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type {
  GenerateRequest,
  Job,
  JobEvent,
  OutputRef,
  ProviderConfig,
  QueueStatus,
  ServerConfig,
  TestProviderResult,
} from "./types";

export type TauriJobResponse = {
  job_id: string;
  job?: Job;
  events?: JobEvent[];
  queue?: QueueStatus;
  queued?: boolean;
  payload?: {
    output?: {
      path?: string | null;
      files?: OutputRef[];
    };
  };
};

const outputPaths = new Map<string, string>();

function rememberJobOutputs(
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

function normalizeJob(raw: Record<string, unknown>): Job {
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

function normalizeJobResponse(raw: TauriJobResponse): TauriJobResponse {
  const job = raw.job
    ? normalizeJob(raw.job as unknown as Record<string, unknown>)
    : undefined;
  rememberJobOutputs(job, raw.payload);
  return { ...raw, job };
}

function normalizeConfig(config: ServerConfig): ServerConfig {
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
  };
}

async function fileToUpload(file: File) {
  return {
    name: file.name,
    bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
  };
}

export type ConfigPaths = {
  config_dir: string;
  config_file: string;
  history_file: string;
  jobs_dir: string;
};

export const api = {
  async getConfig() {
    return normalizeConfig(await invoke<ServerConfig>("get_config"));
  },
  async configPaths() {
    return invoke<ConfigPaths>("config_path");
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
    const payload = await invoke<{ jobs: Record<string, unknown>[] }>(
      "history_list",
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
  async cancelJob(id: string) {
    const result = await invoke<TauriJobResponse>("cancel_job", { jobId: id });
    return normalizeJobResponse(result);
  },
  async queueStatus() {
    return invoke<QueueStatus>("queue_status");
  },
  async openPath(path: string) {
    await invoke("open_path", { path });
  },
  async revealPath(path: string) {
    await invoke("reveal_path", { path });
  },
  async exportFilesToDownloads(paths: string[]) {
    return invoke<string[]>("export_files_to_downloads", { paths });
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
  outputUrl(jobId: string, index = 0) {
    const path =
      outputPaths.get(`${jobId}:${index}`) ??
      (index === 0 ? outputPaths.get(`${jobId}:0`) : undefined);
    return path ? convertFileSrc(path) : "";
  },
  outputPath(jobId: string, index = 0) {
    return (
      outputPaths.get(`${jobId}:${index}`) ??
      (index === 0 ? outputPaths.get(`${jobId}:0`) : undefined)
    );
  },
  fileUrl(path?: string | null) {
    return path ? convertFileSrc(path) : "";
  },
  jobOutputUrl(job: Job, index = 0) {
    const direct = job.outputs.find((output) => output.index === index)?.path;
    if (direct) return convertFileSrc(direct);
    const remembered = outputPaths.get(`${job.id}:${index}`);
    if (remembered) return convertFileSrc(remembered);
    // Legacy single-output jobs: outputs is empty and output_path is the one image.
    if (index === 0 && job.outputs.length === 0 && job.output_path) {
      return convertFileSrc(job.output_path);
    }
    return "";
  },
  jobOutputPath(job: Job, index = 0) {
    const direct = job.outputs.find((output) => output.index === index)?.path;
    if (direct) return direct;
    if (index === 0 && job.outputs.length === 0 && job.output_path) {
      return job.output_path;
    }
    return undefined;
  },
  jobOutputPaths(job: Job) {
    const paths = job.outputs
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((output) => output.path)
      .filter(Boolean);
    if (paths.length > 0) return paths;
    return job.output_path ? [job.output_path] : [];
  },
};
