import type { GenerateRequest, Job, ProviderConfig } from "../../types";
import {
  configuredRelayBase,
  fetchWithSafeTransport,
  isLikelyCorsError,
  trimTrailingSlash,
} from "./relay-client";
import { CORS_MESSAGE } from "./state";
import { t } from "../../i18n";
import type {
  AsyncImageTask,
  OpenAiImageItem,
  OpenAiImagePayload,
  StoredJobInput,
  StoredUpload,
  Sub2ApiTaskPayload,
} from "./state";

export type BrowserImageRequestResult = {
  blobs: Blob[];
  asyncTask?: AsyncImageTask;
};

export type AsyncTaskUpdate = (task: AsyncImageTask) => Promise<void> | void;

export { configuredRelayBase, isLikelyCorsError, trimTrailingSlash };

export function endpointFor(provider: ProviderConfig, path: string) {
  const base = provider.api_base?.trim().replace(/\/+$/, "");
  if (!base) throw new Error(t("服务地址不能为空。"));
  return `${base}${path}`;
}

export function imageMime(format?: string) {
  if (format === "jpeg" || format === "jpg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return "image/png";
}

export function imageExtensionFromBlob(blob: Blob) {
  if (blob.type === "image/jpeg") return "jpg";
  if (blob.type === "image/webp") return "webp";
  return "png";
}

export function cloneGenerateRequest(
  request: GenerateRequest,
): GenerateRequest {
  return JSON.parse(JSON.stringify(request)) as GenerateRequest;
}

export function base64ToBlob(value: string, type: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type });
}

function endpointForMessage(endpoint: string) {
  try {
    const parsed = new URL(endpoint);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return t("服务地址已省略");
  }
}

export function networkError(error: unknown, endpoint: string) {
  if (isLikelyCorsError(error)) {
    return new Error(`${t(CORS_MESSAGE)}\n${endpointForMessage(endpoint)}`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

export async function fetchProvider(endpoint: string, init: RequestInit) {
  try {
    return await fetchWithSafeTransport(endpoint, init);
  } catch (error) {
    throw networkError(error, endpoint);
  }
}

export function explainOriginDnsError(endpoint?: string) {
  let hostHint = "";
  try {
    const host = endpoint ? new URL(endpoint).hostname : "";
    if (host) {
      hostHint = t(" 当前 Base URL 域名：{p0}。", { p0: host });
    }
  } catch {
    /* ignore */
  }
  return t(
    "上游服务域名无法解析或回源失败（Cloudflare 1016/530）。请检查 Base URL 是否写错，或换一个当前可公网访问的服务地址。{p0}",
    { p0: hostHint },
  );
}

export async function parseErrorResponse(
  response: Response,
  endpoint?: string,
) {
  const text = await response.text().catch(() => "");
  if (response.status === 530 && /error code:\s*1016/i.test(text)) {
    return explainOriginDnsError(endpoint);
  }
  try {
    const json = JSON.parse(text) as OpenAiImagePayload;
    return json.error?.message || text || response.statusText;
  } catch {
    return text || response.statusText;
  }
}

export function addJsonField(
  body: Record<string, unknown>,
  key: string,
  value: unknown,
) {
  if (value === undefined || value === null || value === "") return;
  body[key] = value;
}

export async function fetchJson(
  endpoint: string,
  apiKey: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
) {
  let response: Response;
  try {
    response = await fetchProvider(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    throw networkError(error, endpoint);
  }
  if (!response.ok) {
    throw new Error(
      `${response.status} ${await parseErrorResponse(response, endpoint)}`,
    );
  }
  return (await response.json()) as OpenAiImagePayload;
}

export async function fetchMultipart(
  endpoint: string,
  apiKey: string,
  form: FormData,
  signal: AbortSignal,
) {
  let response: Response;
  try {
    response = await fetchProvider(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      body: form,
      signal,
    });
  } catch (error) {
    throw networkError(error, endpoint);
  }
  if (!response.ok) {
    throw new Error(
      `${response.status} ${await parseErrorResponse(response, endpoint)}`,
    );
  }
  return (await response.json()) as OpenAiImagePayload;
}

function rawRetryAfterSeconds(response: Response, fallback: number) {
  const parsed = Number(response.headers.get("Retry-After"));
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(60, parsed)
    : fallback;
}

export function retryAfterSeconds(response: Response, fallback: number) {
  return Math.max(fallback, rawRetryAfterSeconds(response, fallback));
}

async function readSub2ApiTaskResponse(
  response: Response,
  endpoint: string,
): Promise<Sub2ApiTaskPayload> {
  if (!response.ok) {
    throw new Error(
      `${response.status} ${await parseErrorResponse(response, endpoint)}`,
    );
  }
  const payload = (await response.json()) as Sub2ApiTaskPayload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(t("sub2api 异步任务接口返回了无效 JSON。"));
  }
  return payload;
}

async function submitSub2ApiTask(
  endpoint: string,
  apiKey: string,
  body: BodyInit,
  contentType: string | undefined,
  signal: AbortSignal,
) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  };
  if (contentType) headers["Content-Type"] = contentType;
  const init: RequestInit = {
    method: "POST",
    headers,
    body,
    signal,
  };
  // A failed CORS read does not prove that the upstream rejected the POST.
  // The v2 relay only permits synchronous Images operations. Async tasks
  // require direct CORS access; never restore the old arbitrary-path relay.
  let response: Response;
  try {
    response = await fetch(endpoint, {
      ...init,
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
  } catch (error) {
    throw new Error(
      t(
        "异步请求未收到响应，远端可能已创建任务。本次不会重试提交；请先到服务端确认结果。浏览器异步模式要求服务端开启 CORS。",
      ),
      { cause: error },
    );
  }
  return {
    payload: await readSub2ApiTaskResponse(response, endpoint),
    retryAfter: rawRetryAfterSeconds(response, 3),
  };
}

export function resolveSub2ApiPollUrl(
  provider: ProviderConfig,
  pollUrl: string | undefined,
  taskId: string,
) {
  const baseText = provider.api_base?.trim().replace(/\/+$/, "");
  if (!baseText) throw new Error(t("服务地址不能为空。"));
  let base: URL;
  let resolved: URL;
  try {
    base = new URL(`${baseText}/`);
    resolved = pollUrl?.trim()
      ? new URL(pollUrl, base)
      : new URL(
          `${base.pathname.replace(/\/+$/, "")}/images/tasks/${encodeURIComponent(taskId)}`,
          base,
        );
  } catch {
    throw new Error(t("sub2api 返回了无效的任务轮询地址。"));
  }
  if (base.origin !== resolved.origin) {
    throw new Error(
      t(
        "sub2api 返回的任务轮询地址与 Base URL 不同源，已拒绝携带 API Key 请求。",
      ),
    );
  }
  return resolved.toString();
}

function isPendingTaskStatus(status: string) {
  return ["pending", "queued", "processing", "in_progress", "running"].includes(
    status,
  );
}

function isFailedTaskStatus(status: string) {
  return ["failed", "cancelled", "expired"].includes(status);
}

function waitForPoll(delaySeconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const cleanup = () => signal.removeEventListener("abort", abort);
    const timer = window.setTimeout(() => {
      cleanup();
      resolve();
    }, delaySeconds * 1_000);
    const abort = () => {
      window.clearTimeout(timer);
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function taskIdFromPayload(payload: Sub2ApiTaskPayload) {
  const value = payload.task_id || payload.id;
  if (!value?.trim()) {
    throw new Error(t("sub2api 异步提交成功，但响应中没有 task_id。"));
  }
  return value;
}

function completedTaskPayload(payload: Sub2ApiTaskPayload): OpenAiImagePayload {
  let result = payload.result;
  if (typeof result === "string") {
    try {
      result = JSON.parse(result) as OpenAiImagePayload;
    } catch {
      throw new Error(t("sub2api 任务已完成，但 result 不是有效 JSON。"));
    }
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error(t("sub2api 任务已完成，但没有返回 OpenAI Images 结果。"));
  }
  return result;
}

async function pollSub2ApiTask(
  provider: ProviderConfig,
  apiKey: string,
  initial: Sub2ApiTaskPayload,
  initialRetryAfter: number,
  signal: AbortSignal,
  onTaskUpdate?: AsyncTaskUpdate,
) {
  const taskId = taskIdFromPayload(initial);
  const pollUrl = resolveSub2ApiPollUrl(provider, initial.poll_url, taskId);
  const interval = Math.max(
    1,
    Math.min(60, Number(provider.poll_interval_seconds) || 3),
  );
  const timeout = Math.max(
    30,
    Math.min(3_600, Number(provider.poll_timeout_seconds) || 1_800),
  );
  let status = (initial.status || "processing").toLowerCase();
  let pollAttempts = 0;
  let transientRetries = 0;
  let delay = Math.max(
    interval,
    Math.max(1, Math.min(60, initialRetryAfter || interval)),
  );
  const started = Date.now();
  let task: AsyncImageTask = {
    task_id: taskId,
    poll_url: pollUrl,
    status,
    poll_attempts: pollAttempts,
    transient_retries: transientRetries,
  };
  await onTaskUpdate?.(task);

  if (status === "completed") {
    return { payload: completedTaskPayload(initial), task };
  }
  if (isFailedTaskStatus(status)) {
    throw new Error(
      t("sub2api 图片任务 {p0} 已结束（{p1}）。", { p0: taskId, p1: status }),
    );
  }
  if (!isPendingTaskStatus(status)) {
    throw new Error(t("sub2api 返回了未知任务状态：{p0}", { p0: status }));
  }

  while (true) {
    const remainingSeconds = (timeout * 1_000 - (Date.now() - started)) / 1_000;
    if (remainingSeconds <= 0) break;
    await waitForPoll(Math.min(delay, remainingSeconds), signal);
    if (Date.now() - started >= timeout * 1_000) break;
    pollAttempts += 1;
    let response: Response;
    try {
      response = await fetch(pollUrl, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        signal,
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
      });
    } catch (error) {
      if (signal.aborted) throw error;
      transientRetries += 1;
      task = {
        ...task,
        poll_attempts: pollAttempts,
        transient_retries: transientRetries,
      };
      await onTaskUpdate?.(task);
      delay = interval;
      continue;
    }
    const nextDelay = retryAfterSeconds(response, interval);
    if (!response.ok) {
      if (response.status === 429 || response.status >= 500) {
        transientRetries += 1;
        task = {
          ...task,
          poll_attempts: pollAttempts,
          transient_retries: transientRetries,
        };
        await onTaskUpdate?.(task);
        delay = nextDelay;
        continue;
      }
      throw new Error(
        `${response.status} ${await parseErrorResponse(response, pollUrl)}`,
      );
    }
    const payload = await readSub2ApiTaskResponse(response, pollUrl);
    status = (payload.status || "processing").toLowerCase();
    task = {
      task_id: taskId,
      poll_url: pollUrl,
      status,
      poll_attempts: pollAttempts,
      transient_retries: transientRetries,
    };
    await onTaskUpdate?.(task);
    if (status === "completed") {
      return { payload: completedTaskPayload(payload), task };
    }
    if (isFailedTaskStatus(status)) {
      const detail =
        typeof payload.error === "string"
          ? payload.error
          : JSON.stringify(payload.error ?? "");
      throw new Error(
        t("sub2api 图片任务 {p0} 已失败：{p1}", {
          p0: taskId,
          p1: detail || status,
        }),
      );
    }
    if (!isPendingTaskStatus(status)) {
      throw new Error(t("sub2api 返回了未知任务状态：{p0}", { p0: status }));
    }
    delay = nextDelay;
  }
  task = {
    ...task,
    remote_task_may_still_be_running: true,
  };
  await onTaskUpdate?.(task);
  throw new Error(
    t(
      "等待 sub2api 图片任务超时（{p0} 秒）；远端任务可能仍在运行。任务 ID：{p1}",
      { p0: timeout, p1: taskId },
    ),
  );
}

export async function blobFromImageItem(
  item: OpenAiImageItem,
  format: string | undefined,
  signal: AbortSignal,
) {
  if (item.b64_json) return base64ToBlob(item.b64_json, imageMime(format));
  if (!item.url) {
    throw new Error(t("图片接口没有返回 b64_json 或 url。"));
  }
  try {
    const response = await fetchProvider(item.url, { signal });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return await response.blob();
  } catch (error) {
    throw networkError(error, item.url);
  }
}

export async function decodeImagePayload(
  payload: OpenAiImagePayload,
  format: string | undefined,
  signal: AbortSignal,
) {
  const items = payload.data ?? [];
  if (items.length === 0) {
    throw new Error(t("接口响应里没有生成图片。"));
  }
  return Promise.all(
    items.map((item) => blobFromImageItem(item, format, signal)),
  );
}

export function generateBody(
  request: GenerateRequest,
  provider: ProviderConfig,
  n?: number,
) {
  const body: Record<string, unknown> = {
    model: provider.model || "gpt-image-2",
    prompt: request.prompt,
  };
  addJsonField(body, "size", request.size);
  addJsonField(body, "quality", request.quality);
  addJsonField(body, "background", request.background);
  addJsonField(body, "output_format", request.format);
  addJsonField(body, "output_compression", request.compression);
  addJsonField(body, "moderation", request.moderation);
  addJsonField(body, "n", n);
  return body;
}

export async function runGenerationRequest(
  request: GenerateRequest,
  provider: ProviderConfig,
  apiKey: string,
  n: number | undefined,
  signal: AbortSignal,
  onTaskUpdate?: AsyncTaskUpdate,
): Promise<BrowserImageRequestResult> {
  const body = generateBody(request, provider, n);
  if (provider.image_transport === "sub2api-async") {
    const endpoint = endpointFor(provider, "/images/generations/async");
    const submitted = await submitSub2ApiTask(
      endpoint,
      apiKey,
      JSON.stringify(body),
      "application/json",
      signal,
    );
    const completed = await pollSub2ApiTask(
      provider,
      apiKey,
      submitted.payload,
      submitted.retryAfter,
      signal,
      onTaskUpdate,
    );
    return {
      blobs: await decodeImagePayload(
        completed.payload,
        request.format,
        signal,
      ),
      asyncTask: completed.task,
    };
  }
  const endpoint = endpointFor(provider, "/images/generations");
  const payload = await fetchJson(endpoint, apiKey, body, signal);
  return {
    blobs: await decodeImagePayload(payload, request.format, signal),
  };
}

export function editBodyField(form: FormData, key: string, value: unknown) {
  if (value === undefined || value === null || value === "") return;
  form.append(key, String(value));
}

export function sortedFiles(form: FormData, prefix: string) {
  return Array.from(form.entries())
    .filter(([key, value]) => key.startsWith(prefix) && value instanceof File)
    .sort(([a], [b]) => a.localeCompare(b)) as [string, File][];
}

export async function storedEditInputFromForm(jobId: string, form: FormData) {
  const metaRaw = form.get("meta");
  const meta =
    typeof metaRaw === "string"
      ? (JSON.parse(metaRaw) as Record<string, unknown>)
      : {};
  const files: StoredUpload[] = [];
  for (const [key, value] of form.entries()) {
    if (key === "meta" || !(value instanceof File)) continue;
    files.push({
      key,
      name: value.name,
      type: value.type || "application/octet-stream",
      blob: value,
    });
  }
  return { jobId, kind: "edit" as const, meta, files };
}

export function formFromStoredEdit(
  input: Extract<StoredJobInput, { kind: "edit" }>,
) {
  const form = new FormData();
  form.append("meta", JSON.stringify(input.meta));
  for (const file of input.files) {
    form.append(
      file.key,
      new File([file.blob], file.name, {
        type: file.blob.type || file.type || "application/octet-stream",
      }),
      file.name,
    );
  }
  return form;
}

export function generateRequestFromJob(job: Job): GenerateRequest {
  const meta = job.metadata ?? {};
  const readString = (key: string) =>
    typeof meta[key] === "string" ? String(meta[key]) : undefined;
  const readNumber = (key: string) =>
    typeof meta[key] === "number" && Number.isFinite(meta[key])
      ? Number(meta[key])
      : undefined;
  return {
    prompt: readString("prompt") ?? "",
    provider: readString("provider") ?? job.provider,
    size: readString("size"),
    format: readString("format"),
    quality: readString("quality"),
    background: readString("background"),
    n: readNumber("n"),
    compression: readNumber("compression"),
    moderation: readString("moderation"),
  };
}

export function buildEditForm(
  source: FormData,
  provider: ProviderConfig,
  n: number | undefined,
) {
  const metaRaw = source.get("meta");
  const meta =
    typeof metaRaw === "string"
      ? (JSON.parse(metaRaw) as Record<string, unknown>)
      : {};
  const form = new FormData();
  editBodyField(form, "model", provider.model || "gpt-image-2");
  editBodyField(form, "prompt", meta.prompt);
  editBodyField(form, "size", meta.size);
  editBodyField(form, "quality", meta.quality);
  editBodyField(form, "background", meta.background);
  editBodyField(form, "output_format", meta.format);
  editBodyField(form, "output_compression", meta.compression);
  editBodyField(form, "moderation", meta.moderation);
  editBodyField(form, "n", n);
  for (const [, file] of sortedFiles(source, "ref_")) {
    form.append("image[]", file, file.name);
  }
  const selectionHint = source.get("selection_hint");
  if (selectionHint instanceof File) {
    form.append("image[]", selectionHint, selectionHint.name);
  }
  const mask = source.get("mask");
  if (mask instanceof File) form.append("mask", mask, mask.name);
  return { form, meta };
}

export async function runEditRequest(
  form: FormData,
  provider: ProviderConfig,
  apiKey: string,
  n: number | undefined,
  signal: AbortSignal,
  onTaskUpdate?: AsyncTaskUpdate,
): Promise<BrowserImageRequestResult> {
  const { form: editForm, meta } = buildEditForm(form, provider, n);
  if (provider.image_transport === "sub2api-async") {
    const endpoint = endpointFor(provider, "/images/edits/async");
    const submitted = await submitSub2ApiTask(
      endpoint,
      apiKey,
      editForm,
      undefined,
      signal,
    );
    const completed = await pollSub2ApiTask(
      provider,
      apiKey,
      submitted.payload,
      submitted.retryAfter,
      signal,
      onTaskUpdate,
    );
    return {
      blobs: await decodeImagePayload(
        completed.payload,
        String(meta.format ?? "png"),
        signal,
      ),
      asyncTask: completed.task,
    };
  }
  const endpoint = endpointFor(provider, "/images/edits");
  const payload = await fetchMultipart(endpoint, apiKey, editForm, signal);
  return {
    blobs: await decodeImagePayload(
      payload,
      String(meta.format ?? "png"),
      signal,
    ),
  };
}
