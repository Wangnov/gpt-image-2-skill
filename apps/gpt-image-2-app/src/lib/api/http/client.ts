function trimTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function configuredHttpApiBase() {
  const fromWindow =
    typeof window !== "undefined" ? window.__GPT_IMAGE_2_API_BASE__ : undefined;
  const fromEnv = import.meta.env.VITE_GPT_IMAGE_2_API_BASE;
  const value = (fromWindow || fromEnv || "").trim();
  return value ? trimTrailingSlash(value) : undefined;
}

export function hasConfiguredHttpRuntime() {
  if (typeof window === "undefined") return false;
  return (
    window.__GPT_IMAGE_2_RUNTIME__ === "http" ||
    Boolean(configuredHttpApiBase())
  );
}

export function apiResourceUrl(path: string) {
  const base = configuredHttpApiBase() ?? "/api";
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

export function fileApiUrl(path: string) {
  const base = configuredHttpApiBase() ?? "/api";
  return `${base}/files?path=${encodeURIComponent(path)}`;
}

/**
 * Error thrown by {@link requestJson} for non-2xx HTTP responses. Extends
 * `Error` so existing `error.message` consumers keep working, while carrying the
 * structured `code`/`detail` from the server's `{ error: { message, detail,
 * code? } }` envelope so the real, already-redacted cause survives to the UI.
 */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly detail?: unknown;

  constructor(
    message: string,
    options: { status: number; code?: string; detail?: unknown },
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.status = options.status;
    this.code = options.code;
    this.detail = options.detail;
  }
}

async function parseErrorResponse(
  response: Response,
): Promise<{ message: string; code?: string; detail?: unknown }> {
  const fallback = `${response.status} ${response.statusText}`.trim();
  const text = await response.text();
  if (!text) return { message: fallback };
  try {
    const payload = JSON.parse(text) as {
      error?: { message?: string; code?: string; detail?: unknown };
      message?: string;
    };
    return {
      message: payload.error?.message || payload.message || fallback,
      code: payload.error?.code,
      detail: payload.error?.detail,
    };
  } catch {
    return { message: text || fallback };
  }
}

export async function requestJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(apiResourceUrl(path), { ...init, headers });
  if (!response.ok) {
    const parsed = await parseErrorResponse(response);
    throw new ApiRequestError(parsed.message, {
      status: response.status,
      code: parsed.code,
      detail: parsed.detail,
    });
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function jsonBody(value: unknown) {
  return JSON.stringify(value);
}
