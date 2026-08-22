type RelayOperation = "models" | "generations" | "edits" | "asset";
type ApiRelayOperation = Exclude<RelayOperation, "asset">;
type TransportMode = "direct" | "relay";

type RelayConfig = {
  version?: number;
  enabled?: boolean;
  auth_mode?: string;
  turnstile_site_key?: string | null;
};

type SessionStatus = {
  active?: boolean;
};

type EndpointInfo =
  | { operation: ApiRelayOperation; apiBase: string }
  | { operation: "asset"; target: string };

const OPERATION_SUFFIXES: Record<ApiRelayOperation, string> = {
  models: "/models",
  generations: "/images/generations",
  edits: "/images/edits",
};
const RELAY_VERSION_HEADER = "X-GPT-Image-2-Relay-Version";
const API_BASE_HEADER = "X-GPT-Image-2-Api-Base";
const TURNSTILE_SCRIPT_ID = "gpt-image-2-turnstile-script";
const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

const transportModes = new Map<string, TransportMode>();
const transportNegotiations = new Map<string, Promise<TransportMode>>();
let relaySessionKnown = false;
let relaySessionPromise: Promise<void> | undefined;
let relayConfigPromise: Promise<RelayConfig> | undefined;
let turnstileScriptPromise: Promise<TurnstileApi> | undefined;

export class AmbiguousProviderRequestError extends Error {
  constructor() {
    super(
      "请求可能已经到达服务商，但浏览器没有收到响应。为避免重复生成或重复扣费，本次不会自动切换中转站重试；请先到服务商后台确认结果，再决定是否手动重试。",
    );
    this.name = "AmbiguousProviderRequestError";
  }
}

export function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function safeSameOriginRelayBase(value: string): string | undefined {
  if (/\\|[\u0000-\u001f\u007f]/u.test(value) || value.includes("#")) {
    return undefined;
  }
  const pageOrigin = window.location?.origin;
  if (!pageOrigin) {
    if (
      !value.startsWith("/") ||
      value.startsWith("//") ||
      value.includes("?")
    ) {
      return undefined;
    }
    return trimTrailingSlash(value);
  }
  try {
    const resolved = new URL(value, pageOrigin);
    if (
      resolved.origin !== pageOrigin ||
      resolved.username ||
      resolved.password ||
      resolved.search ||
      resolved.hash
    ) {
      return undefined;
    }
    if (value.startsWith("/") && !value.startsWith("//")) {
      return trimTrailingSlash(resolved.pathname);
    }
    return trimTrailingSlash(resolved.href);
  } catch {
    return undefined;
  }
}

export function configuredRelayBase(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const configured =
    window.__GPT_IMAGE_2_RELAY_BASE__ ||
    import.meta.env.VITE_GPT_IMAGE_2_RELAY_BASE;
  const value = configured?.trim();
  if (value) return safeSameOriginRelayBase(value);
  const host = window.location?.hostname;
  if (host === "image.codex-pool.com") {
    return "/api/relay";
  }
  return undefined;
}

export function isLikelyCorsError(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof Error && error.name === "TimeoutError") ||
    String(error).includes("Failed to fetch")
  );
}

function endpointInfo(endpoint: string, init: RequestInit): EndpointInfo {
  const authorization = new Headers(init.headers).get("Authorization");
  if (!authorization) return { operation: "asset", target: endpoint };

  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error("服务地址不是有效的 URL。");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("API 请求地址不能包含查询参数或片段。");
  }
  const method = (init.method ?? "GET").toUpperCase();
  for (const [operation, suffix] of Object.entries(OPERATION_SUFFIXES) as [
    ApiRelayOperation,
    string,
  ][]) {
    const expectedMethod = operation === "models" ? "GET" : "POST";
    if (method !== expectedMethod || !parsed.pathname.endsWith(suffix))
      continue;
    const prefix = parsed.pathname.slice(0, -suffix.length) || "/";
    return { operation, apiBase: `${parsed.origin}${prefix}` };
  }
  throw new Error("中转站只支持模型检查、图片生成、图片编辑和图片下载。");
}

function relayUrl(relayBase: string, path: string): string {
  return `${relayBase}/v2/${path}`;
}

async function responseJson<T>(response: Response): Promise<T | undefined> {
  try {
    return (await response.clone().json()) as T;
  } catch {
    return undefined;
  }
}

async function relayConfig(relayBase: string): Promise<RelayConfig> {
  if (!relayConfigPromise) {
    relayConfigPromise = (async () => {
      const response = await fetch(relayUrl(relayBase, "config"), {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
      });
      const config = await responseJson<RelayConfig>(response);
      if (
        !response.ok ||
        config?.version !== 2 ||
        config.enabled !== true ||
        config.auth_mode !== "turnstile" ||
        typeof config.turnstile_site_key !== "string" ||
        !config.turnstile_site_key ||
        config.turnstile_site_key.length > 256
      ) {
        throw new Error(
          "本站中转服务尚未准备好，请稍后再试或改用支持浏览器 CORS 的服务地址。",
        );
      }
      return config;
    })().catch((error) => {
      relayConfigPromise = undefined;
      throw error;
    });
  }
  return relayConfigPromise;
}

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (turnstileScriptPromise) return turnstileScriptPromise;
  if (typeof document === "undefined") {
    return Promise.reject(new Error("当前浏览器无法加载安全验证组件。"));
  }

  turnstileScriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const existing = document.getElementById(
      TURNSTILE_SCRIPT_ID,
    ) as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");
    const timeout = window.setTimeout(() => {
      reject(new Error("安全验证组件加载超时，请检查网络后重试。"));
    }, 20_000);
    const finish = () => {
      window.clearTimeout(timeout);
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("安全验证组件加载失败，请稍后重试。"));
    };
    script.addEventListener("load", finish, { once: true });
    script.addEventListener(
      "error",
      () => {
        window.clearTimeout(timeout);
        reject(new Error("安全验证组件加载失败，请检查网络后重试。"));
      },
      { once: true },
    );
    if (!existing) {
      script.id = TURNSTILE_SCRIPT_ID;
      script.src = TURNSTILE_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  }).catch((error) => {
    turnstileScriptPromise = undefined;
    throw error;
  });
  return turnstileScriptPromise;
}

async function turnstileToken(siteKey: string): Promise<string> {
  const api = await loadTurnstile();
  if (typeof document === "undefined" || !document.body) {
    throw new Error("当前浏览器无法显示安全验证组件。");
  }
  const host = document.createElement("div");
  host.dataset.gptImage2Turnstile = "true";
  host.setAttribute("role", "status");
  host.setAttribute("aria-label", "正在进行中转站安全验证");
  Object.assign(host.style, {
    position: "fixed",
    right: "20px",
    bottom: "20px",
    zIndex: "2147483647",
    minWidth: "300px",
    minHeight: "70px",
  });
  document.body.appendChild(host);

  return new Promise<string>((resolve, reject) => {
    let widgetId: string | undefined;
    let settled = false;
    const cleanup = () => {
      if (widgetId) api.remove(widgetId);
      host.remove();
    };
    const finish = (token?: string, error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      window.setTimeout(cleanup, 0);
      if (token) resolve(token);
      else reject(error ?? new Error("安全验证未完成，请重试。"));
    };
    const timeout = window.setTimeout(
      () => finish(undefined, new Error("安全验证超时，请重试。")),
      120_000,
    );
    try {
      widgetId = api.render(host, {
        sitekey: siteKey,
        action: "relay_session",
        appearance: "interaction-only",
        theme: "auto",
        callback: (token) => finish(token),
        "error-callback": () =>
          finish(undefined, new Error("安全验证失败，请稍后重试。")),
        "expired-callback": () =>
          finish(undefined, new Error("安全验证已过期，请重试。")),
        "timeout-callback": () =>
          finish(undefined, new Error("安全验证超时，请重试。")),
      });
    } catch {
      finish(undefined, new Error("安全验证组件初始化失败，请稍后重试。"));
    }
  });
}

async function establishRelaySession(relayBase: string): Promise<void> {
  const statusResponse = await fetch(relayUrl(relayBase, "session"), {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer",
  });
  const status = await responseJson<SessionStatus>(statusResponse);
  if (statusResponse.ok && status?.active === true) {
    relaySessionKnown = true;
    return;
  }

  const config = await relayConfig(relayBase);
  const token = await turnstileToken(config.turnstile_site_key!);
  const response = await fetch(relayUrl(relayBase, "session"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [RELAY_VERSION_HEADER]: "2",
    },
    body: JSON.stringify({ token }),
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer",
  });
  const result = await responseJson<SessionStatus>(response);
  if (!response.ok || result?.active !== true) {
    throw new Error("中转站安全会话建立失败，请稍后重试。");
  }
  relaySessionKnown = true;
}

async function ensureRelaySession(relayBase: string): Promise<void> {
  if (relaySessionKnown) return;
  if (!relaySessionPromise) {
    relaySessionPromise = establishRelaySession(relayBase).finally(() => {
      relaySessionPromise = undefined;
    });
  }
  return relaySessionPromise;
}

function relayInit(
  info: EndpointInfo,
  init: RequestInit,
): { path: RelayOperation; init: RequestInit } {
  const headers = new Headers();
  headers.set(RELAY_VERSION_HEADER, "2");
  const sourceHeaders = new Headers(init.headers);
  const authorization = sourceHeaders.get("Authorization");
  const accept = sourceHeaders.get("Accept");
  const contentType = sourceHeaders.get("Content-Type");
  if (authorization) headers.set("Authorization", authorization);
  if (accept) headers.set("Accept", accept);
  if (contentType) headers.set("Content-Type", contentType);

  if (info.operation === "asset") {
    headers.set("Content-Type", "application/json");
    return {
      path: "asset",
      init: {
        method: "POST",
        headers,
        body: JSON.stringify({ url: info.target }),
        signal: init.signal,
      },
    };
  }
  headers.set(API_BASE_HEADER, info.apiBase);
  return {
    path: info.operation,
    init: {
      method: "POST",
      headers,
      body: info.operation === "models" ? undefined : init.body,
      signal: init.signal,
    },
  };
}

async function workerSessionRequired(response: Response): Promise<boolean> {
  if (
    response.status !== 401 ||
    response.headers.get("X-GPT-Image-2-Relay") === "1"
  ) {
    return false;
  }
  const payload = await responseJson<{ error?: { code?: string } }>(response);
  return payload?.error?.code === "session_required";
}

async function fetchViaRelay(
  relayBase: string,
  info: EndpointInfo,
  init: RequestInit,
  retrySession = true,
): Promise<Response> {
  await ensureRelaySession(relayBase);
  const relay = relayInit(info, init);
  const response = await fetch(relayUrl(relayBase, relay.path), {
    ...relay.init,
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer",
  });
  if (retrySession && (await workerSessionRequired(response))) {
    relaySessionKnown = false;
    await ensureRelaySession(relayBase);
    return fetchViaRelay(relayBase, info, init, false);
  }
  if (response.ok && response.headers.get("X-GPT-Image-2-Relay") !== "1") {
    response.body?.cancel("invalid relay response");
    throw new Error("中转站返回了无法验证的响应，请稍后重试。");
  }
  return response;
}

async function cancelProbeBody(response: Response): Promise<void> {
  await response.body
    ?.cancel("transport probe completed")
    .catch(() => undefined);
}

async function negotiateTransport(
  relayBase: string,
  info: Extract<EndpointInfo, { operation: ApiRelayOperation }>,
  init: RequestInit,
): Promise<TransportMode> {
  const cached = transportModes.get(info.apiBase);
  if (cached) return cached;
  const existing = transportNegotiations.get(info.apiBase);
  if (existing) return existing;

  const negotiation = (async () => {
    const modelsEndpoint = `${trimTrailingSlash(info.apiBase)}/models`;
    const sourceHeaders = new Headers(init.headers);
    try {
      const direct = await fetch(modelsEndpoint, {
        method: "GET",
        headers: {
          Authorization: sourceHeaders.get("Authorization") ?? "",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
      });
      await cancelProbeBody(direct);
      transportModes.set(info.apiBase, "direct");
      return "direct";
    } catch (error) {
      if (!isLikelyCorsError(error)) throw error;
    }

    const relayProbe = await fetchViaRelay(
      relayBase,
      { operation: "models", apiBase: info.apiBase },
      {
        headers: {
          Authorization: sourceHeaders.get("Authorization") ?? "",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (relayProbe.headers.get("X-GPT-Image-2-Relay") !== "1") {
      const payload = await responseJson<{ error?: { message?: string } }>(
        relayProbe,
      );
      throw new Error(
        payload?.error?.message || "中转站连接检查失败，请稍后重试。",
      );
    }
    await cancelProbeBody(relayProbe);
    transportModes.set(info.apiBase, "relay");
    return "relay";
  })().finally(() => {
    transportNegotiations.delete(info.apiBase);
  });
  transportNegotiations.set(info.apiBase, negotiation);
  return negotiation;
}

async function fetchSafeOperation(
  relayBase: string,
  info: EndpointInfo,
  endpoint: string,
  init: RequestInit,
): Promise<Response> {
  if (info.operation === "asset") {
    try {
      return await fetch(endpoint, init);
    } catch (error) {
      if (!isLikelyCorsError(error)) throw error;
      return fetchViaRelay(relayBase, info, init);
    }
  }

  if (info.operation === "models") {
    try {
      const response = await fetch(endpoint, init);
      transportModes.set(info.apiBase, "direct");
      return response;
    } catch (error) {
      if (!isLikelyCorsError(error)) throw error;
      const response = await fetchViaRelay(relayBase, info, init);
      transportModes.set(info.apiBase, "relay");
      return response;
    }
  }

  const mode = await negotiateTransport(relayBase, info, init);
  if (init.signal?.aborted) throw init.signal.reason;
  try {
    return mode === "direct"
      ? await fetch(endpoint, init)
      : await fetchViaRelay(relayBase, info, init);
  } catch (error) {
    if (isLikelyCorsError(error)) throw new AmbiguousProviderRequestError();
    throw error;
  }
}

export async function fetchWithSafeTransport(
  endpoint: string,
  init: RequestInit,
): Promise<Response> {
  const relayBase = configuredRelayBase();
  if (!relayBase) return fetch(endpoint, init);
  const info = endpointInfo(endpoint, init);
  return fetchSafeOperation(relayBase, info, endpoint, init);
}

export function resetRelayClientForTests(): void {
  transportModes.clear();
  transportNegotiations.clear();
  relaySessionKnown = false;
  relaySessionPromise = undefined;
  relayConfigPromise = undefined;
  turnstileScriptPromise = undefined;
  if (typeof document !== "undefined") {
    document
      .querySelectorAll("[data-gpt-image2-turnstile]")
      .forEach((node) => node.remove());
  }
}
