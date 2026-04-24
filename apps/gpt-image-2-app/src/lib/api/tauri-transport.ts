import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  GenerateRequest,
  Job,
  JobEvent,
  ProviderConfig,
  QueueStatus,
  ServerConfig,
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
  JobUpdateHandler,
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
