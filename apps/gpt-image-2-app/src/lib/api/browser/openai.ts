import type { GenerateRequest, Job, ProviderConfig } from "../../types";
import { CORS_MESSAGE } from "./state";
import type { OpenAiImageItem, OpenAiImagePayload, StoredJobInput, StoredUpload } from "./state";

export function endpointFor(provider: ProviderConfig, path: string) {
  const base = provider.api_base?.trim().replace(/\/+$/, "");
  if (!base) throw new Error("服务地址不能为空。");
  return `${base}${path}`;
}

export function trimTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function configuredRelayBase() {
  if (typeof window === "undefined") return undefined;
  const configured =
    window.__GPT_IMAGE_2_RELAY_BASE__ ||
    import.meta.env.VITE_GPT_IMAGE_2_RELAY_BASE;
  const value = configured?.trim();
  if (value) return trimTrailingSlash(value);
  const host = window.location?.hostname;
  if (
    host === "image.codex-pool.com" ||
    host === "gpt-image-2-dpm.pages.dev" ||
    host?.endsWith(".gpt-image-2-dpm.pages.dev")
  ) {
    return "/api/relay";
  }
  return undefined;
}

export function relayRequest(endpoint: string, init: RequestInit) {
  const relayBase = configuredRelayBase();
  if (!relayBase) return undefined;
  try {
    const upstream = new URL(endpoint);
    if (window.location?.origin && upstream.origin === window.location.origin) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  const headers = new Headers(init.headers);
  headers.set("X-GPT-Image-2-Upstream", endpoint);
  headers.set("X-GPT-Image-2-Method", init.method || "GET");
  return {
    url: relayBase,
    init: {
      ...init,
      method: "POST",
      headers,
    } satisfies RequestInit,
  };
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

export function cloneGenerateRequest(request: GenerateRequest): GenerateRequest {
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

export function isLikelyCorsError(error: unknown) {
  return (
    error instanceof TypeError || String(error).includes("Failed to fetch")
  );
}

export function networkError(error: unknown, endpoint: string) {
  if (isLikelyCorsError(error)) {
    return new Error(`${CORS_MESSAGE}\n${endpoint}`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

export async function fetchProvider(endpoint: string, init: RequestInit) {
  try {
    return await fetch(endpoint, init);
  } catch (error) {
    if (!isLikelyCorsError(error)) throw networkError(error, endpoint);
    const relay = relayRequest(endpoint, init);
    if (!relay) throw networkError(error, endpoint);
    try {
      return await fetch(relay.url, relay.init);
    } catch (relayError) {
      throw networkError(relayError, endpoint);
    }
  }
}

export function explainOriginDnsError(endpoint?: string) {
  let hostHint = "";
  try {
    const host = endpoint ? new URL(endpoint).hostname : "";
    if (host) {
      hostHint = ` 当前 Base URL 域名：${host}。`;
    }
  } catch {
    /* ignore */
  }
  return `上游服务域名无法解析或回源失败（Cloudflare 1016/530）。请检查 Base URL 是否写错，或换一个当前可公网访问的服务地址。${hostHint}`;
}

export async function parseErrorResponse(response: Response, endpoint?: string) {
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

export async function blobFromImageItem(
  item: OpenAiImageItem,
  format: string | undefined,
  signal: AbortSignal,
) {
  if (item.b64_json) return base64ToBlob(item.b64_json, imageMime(format));
  if (!item.url) {
    throw new Error("图片接口没有返回 b64_json 或 url。");
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
    throw new Error("接口响应里没有生成图片。");
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
) {
  const endpoint = endpointFor(provider, "/images/generations");
  const payload = await fetchJson(
    endpoint,
    apiKey,
    generateBody(request, provider, n),
    signal,
  );
  return decodeImagePayload(payload, request.format, signal);
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

export function formFromStoredEdit(input: Extract<StoredJobInput, { kind: "edit" }>) {
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
) {
  const endpoint = endpointFor(provider, "/images/edits");
  const { form: editForm, meta } = buildEditForm(form, provider, n);
  const payload = await fetchMultipart(endpoint, apiKey, editForm, signal);
  return decodeImagePayload(payload, String(meta.format ?? "png"), signal);
}
