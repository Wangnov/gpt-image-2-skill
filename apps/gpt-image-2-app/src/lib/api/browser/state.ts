import type { GenerateRequest, Job, JobEvent } from "../../types";
import type { EventHandler, JobUpdateHandler } from "../types";

export const DB_NAME = "gpt-image-2-web";
export const DB_VERSION = 2;
export const CONFIG_KEY = "config";
export const CORS_MESSAGE =
  "该服务商不允许浏览器直连，且本站中转暂时不可用。请稍后重试，或改用 Docker/App。";

export type KvRecord<T = unknown> = {
  key: string;
  value: T;
};

export type StoredOutput = {
  key: string;
  jobId: string;
  index: number;
  path: string;
  blob: Blob;
  bytes: number;
};

export type StoredUpload = {
  key: string;
  name: string;
  type: string;
  blob: Blob;
};

export type StoredJobInput =
  | {
      jobId: string;
      kind: "generate";
      request: GenerateRequest;
    }
  | {
      jobId: string;
      kind: "edit";
      meta: Record<string, unknown>;
      files: StoredUpload[];
    };

export type BrowserQueuedTask = {
  job: Job;
  abort: AbortController;
  cancelled: boolean;
  run: (task: BrowserQueuedTask) => Promise<void>;
};

export type OpenAiImageItem = {
  b64_json?: string;
  url?: string;
  revised_prompt?: string;
};

export type OpenAiImagePayload = {
  data?: OpenAiImageItem[];
  created?: number;
  error?: { message?: string };
};

export const dbPromise = { current: null as Promise<IDBDatabase> | null };
export const objectUrls = new Map<string, string>();
export const blobsByPath = new Map<string, Blob>();
export const eventLog = new Map<string, JobEvent[]>();
export const nextSeq = new Map<string, number>();
export const jobSubscribers = new Map<string, Set<EventHandler>>();
export const updateSubscribers = new Set<JobUpdateHandler>();
export const queue: BrowserQueuedTask[] = [];
export const running = new Map<string, BrowserQueuedTask>();
export let maxParallel = 2;
export let prepared: Promise<void> | null = null;

export function setMaxParallel(value: number) {
  maxParallel = value;
}

export function setPrepared(value: Promise<void> | null) {
  prepared = value;
}
