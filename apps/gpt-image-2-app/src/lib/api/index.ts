import { browserApi } from "./browser-transport";
import type { ApiClient, RuntimeKind } from "./types";

export type { ConfigPaths, TauriJobResponse } from "./types";

declare global {
  interface Window {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  }
}

function detectRuntime(): RuntimeKind {
  if (typeof window === "undefined") return "browser";
  return window.__TAURI_INTERNALS__ || window.__TAURI__ ? "tauri" : "browser";
}

const runtime = detectRuntime();
let activeClient: ApiClient = browserApi;
let clientPromise: Promise<ApiClient> | null = null;

function loadClient() {
  if (runtime === "browser") return Promise.resolve(browserApi);
  if (!clientPromise) {
    clientPromise = import("./tauri-transport").then((mod) => {
      activeClient = mod.tauriApi;
      return activeClient;
    });
  }
  return clientPromise;
}

function invokeClient<K extends keyof ApiClient>(
  key: K,
  ...args: ApiClient[K] extends (...args: infer Args) => unknown ? Args : never
) {
  return loadClient().then((client) => {
    const fn = client[key] as (...fnArgs: typeof args) => unknown;
    return fn(...args);
  });
}

export const api: ApiClient = {
  get kind() {
    return activeClient.kind;
  },
  get canUseLocalFiles() {
    return activeClient.canUseLocalFiles;
  },
  get canRevealFiles() {
    return activeClient.canRevealFiles;
  },
  get canUseSystemCredentials() {
    return activeClient.canUseSystemCredentials;
  },
  get canUseCodexProvider() {
    return activeClient.canUseCodexProvider;
  },
  get canExportToDownloadsFolder() {
    return activeClient.canExportToDownloadsFolder;
  },
  getConfig: () => invokeClient("getConfig") as ReturnType<ApiClient["getConfig"]>,
  configPaths: () =>
    invokeClient("configPaths") as ReturnType<ApiClient["configPaths"]>,
  setDefault: (name) =>
    invokeClient("setDefault", name) as ReturnType<ApiClient["setDefault"]>,
  upsertProvider: (name, cfg) =>
    invokeClient("upsertProvider", name, cfg) as ReturnType<
      ApiClient["upsertProvider"]
    >,
  revealProviderCredential: (name, credential) =>
    invokeClient("revealProviderCredential", name, credential) as ReturnType<
      ApiClient["revealProviderCredential"]
    >,
  deleteProvider: (name) =>
    invokeClient("deleteProvider", name) as ReturnType<
      ApiClient["deleteProvider"]
    >,
  testProvider: (name) =>
    invokeClient("testProvider", name) as ReturnType<ApiClient["testProvider"]>,
  listJobs: () => invokeClient("listJobs") as ReturnType<ApiClient["listJobs"]>,
  getJob: (id) => invokeClient("getJob", id) as ReturnType<ApiClient["getJob"]>,
  deleteJob: (id) =>
    invokeClient("deleteJob", id) as ReturnType<ApiClient["deleteJob"]>,
  cancelJob: (id) =>
    invokeClient("cancelJob", id) as ReturnType<ApiClient["cancelJob"]>,
  queueStatus: () =>
    invokeClient("queueStatus") as ReturnType<ApiClient["queueStatus"]>,
  setQueueConcurrency: (maxParallel) =>
    invokeClient("setQueueConcurrency", maxParallel) as ReturnType<
      ApiClient["setQueueConcurrency"]
    >,
  openPath: (path) =>
    invokeClient("openPath", path) as ReturnType<ApiClient["openPath"]>,
  revealPath: (path) =>
    invokeClient("revealPath", path) as ReturnType<ApiClient["revealPath"]>,
  exportFilesToDownloads: (paths) =>
    invokeClient("exportFilesToDownloads", paths) as ReturnType<
      ApiClient["exportFilesToDownloads"]
    >,
  createGenerate: (body) =>
    invokeClient("createGenerate", body) as ReturnType<
      ApiClient["createGenerate"]
    >,
  createEdit: (form) =>
    invokeClient("createEdit", form) as ReturnType<ApiClient["createEdit"]>,
  outputUrl(jobId, index) {
    return activeClient.outputUrl(jobId, index);
  },
  outputPath(jobId, index) {
    return activeClient.outputPath(jobId, index);
  },
  fileUrl(path) {
    return activeClient.fileUrl(path);
  },
  jobOutputUrl(job, index) {
    return activeClient.jobOutputUrl(job, index);
  },
  jobOutputPath(job, index) {
    return activeClient.jobOutputPath(job, index);
  },
  jobOutputPaths(job) {
    return activeClient.jobOutputPaths(job);
  },
  subscribeJobEvents(jobId, onEvent, onDone) {
    let closed = false;
    let unsubscribe: (() => void) | undefined;
    void loadClient().then((client) => {
      if (closed) return;
      unsubscribe = client.subscribeJobEvents(jobId, onEvent, onDone);
    });
    return () => {
      closed = true;
      unsubscribe?.();
    };
  },
  subscribeJobUpdates(onEvent) {
    let closed = false;
    let unsubscribe: (() => void) | undefined;
    void loadClient().then((client) => {
      if (closed) return;
      unsubscribe = client.subscribeJobUpdates(onEvent);
    });
    return () => {
      closed = true;
      unsubscribe?.();
    };
  },
};
