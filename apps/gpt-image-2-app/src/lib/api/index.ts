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
  if (window.__TAURI_INTERNALS__ || window.__TAURI__) return "tauri";
  const configuredHttpApi =
    window.__GPT_IMAGE_2_API_BASE__?.trim() ||
    import.meta.env.VITE_GPT_IMAGE_2_API_BASE?.trim();
  return window.__GPT_IMAGE_2_RUNTIME__ === "http" || configuredHttpApi
    ? "http"
    : "browser";
}

const runtime = detectRuntime();
let activeClient: ApiClient = browserApi;
let clientPromise: Promise<ApiClient> | null = null;

function loadClient() {
  if (runtime === "browser") return Promise.resolve(browserApi);
  if (!clientPromise) {
    const loader =
      runtime === "http"
        ? import("./http-transport").then((mod) => mod.httpApi)
        : import("./tauri-transport").then((mod) => mod.tauriApi);
    clientPromise = loader.then((client) => {
      activeClient = client;
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
  getConfig: () =>
    invokeClient("getConfig") as ReturnType<ApiClient["getConfig"]>,
  configPaths: () =>
    invokeClient("configPaths") as ReturnType<ApiClient["configPaths"]>,
  updateNotifications: (config) =>
    invokeClient("updateNotifications", config) as ReturnType<
      ApiClient["updateNotifications"]
    >,
  testNotifications: (status) =>
    invokeClient("testNotifications", status) as ReturnType<
      ApiClient["testNotifications"]
    >,
  notificationCapabilities: () =>
    invokeClient("notificationCapabilities") as ReturnType<
      ApiClient["notificationCapabilities"]
    >,
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
  listJobsPage: (options) =>
    invokeClient("listJobsPage", options) as ReturnType<
      ApiClient["listJobsPage"]
    >,
  listActiveJobs: () =>
    invokeClient("listActiveJobs") as ReturnType<ApiClient["listActiveJobs"]>,
  getJob: (id) => invokeClient("getJob", id) as ReturnType<ApiClient["getJob"]>,
  deleteJob: (id) =>
    invokeClient("deleteJob", id) as ReturnType<ApiClient["deleteJob"]>,
  softDeleteJob: (id) =>
    invokeClient("softDeleteJob", id) as ReturnType<ApiClient["softDeleteJob"]>,
  restoreDeletedJob: (id) =>
    invokeClient("restoreDeletedJob", id) as ReturnType<
      ApiClient["restoreDeletedJob"]
    >,
  hardDeleteJob: (id) =>
    invokeClient("hardDeleteJob", id) as ReturnType<ApiClient["hardDeleteJob"]>,
  copyImageToClipboard: (path, prompt) =>
    invokeClient("copyImageToClipboard", path, prompt) as ReturnType<
      ApiClient["copyImageToClipboard"]
    >,
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
  exportJobToDownloads: (jobId) =>
    invokeClient("exportJobToDownloads", jobId) as ReturnType<
      ApiClient["exportJobToDownloads"]
    >,
  createGenerate: (body) =>
    invokeClient("createGenerate", body) as ReturnType<
      ApiClient["createGenerate"]
    >,
  createEdit: (form) =>
    invokeClient("createEdit", form) as ReturnType<ApiClient["createEdit"]>,
  retryJob: (jobId) =>
    invokeClient("retryJob", jobId) as ReturnType<ApiClient["retryJob"]>,
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
