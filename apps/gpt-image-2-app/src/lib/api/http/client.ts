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

function apiUrl(path: string) {
  const base = configuredHttpApiBase() ?? "/api";
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

export function fileApiUrl(path: string) {
  const base = configuredHttpApiBase() ?? "/api";
  return `${base}/files?path=${encodeURIComponent(path)}`;
}

async function parseErrorResponse(response: Response) {
  const fallback = `${response.status} ${response.statusText}`.trim();
  const text = await response.text();
  if (!text) return fallback;
  try {
    const payload = JSON.parse(text) as {
      error?: { message?: string };
      message?: string;
    };
    return payload.error?.message || payload.message || fallback;
  } catch {
    return text || fallback;
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
  const response = await fetch(apiUrl(path), { ...init, headers });
  if (!response.ok) throw new Error(await parseErrorResponse(response));
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function jsonBody(value: unknown) {
  return JSON.stringify(value);
}
