import {
  allowedOrigins,
  relayEnabled,
  sessionTtlSeconds,
  v2Ready,
} from "./config";
import {
  API_BASE_HEADER,
  API_MAX_ERROR_RESPONSE_BYTES,
  ASSET_MAX_REDIRECTS,
  ASSET_MAX_ERROR_RESPONSE_BYTES,
  ASSET_MAX_REQUEST_BYTES,
  ASSET_MAX_RESPONSE_BYTES,
  ASSET_TIMEOUT_MS,
  classifyLegacyRequest,
  LEGACY_METHOD_HEADER,
  LEGACY_UPSTREAM_HEADER,
  operationUrl,
  OPERATION_SPECS,
  requireLegacyRequestOrigin,
  requireSameOriginPost,
  requireSameOriginRead,
  validateApiBase,
  validateAssetTarget,
  validateContentLength,
  validateContentType,
  type OperationSpec,
} from "./policy";
import {
  createSessionCookie,
  enforceRateLimit,
  rateKeyForRequest,
  verifySession,
  verifyTurnstile,
} from "./session";
import {
  limitRequestBody,
  limitResponseBody,
  readJsonLimited,
} from "./streams";
import { RelayHttpError, type Env, type RelayOperation } from "./types";

export type { Env } from "./types";

const RELAY_ROOT = "/api/relay";
const V2_ROOT = `${RELAY_ROOT}/v2`;
const API_RESPONSE_HEADERS = new Set([
  "content-disposition",
  "content-type",
  "openai-request-id",
  "request-id",
  "retry-after",
  "x-request-id",
]);

function securityHeaders(headers = new Headers()): Headers {
  headers.set("Cache-Control", "no-store");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  return headers;
}

function legacyCorsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers();
  const origin = request.headers.get("Origin");
  if (origin && allowedOrigins(env).includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "authorization,content-type,accept,x-gpt-image-2-upstream,x-gpt-image-2-method",
  );
  headers.set(
    "Access-Control-Expose-Headers",
    "content-type,content-disposition,deprecation,retry-after,request-id,x-request-id,openai-request-id,x-gpt-image-2-relay,x-gpt-image-2-relay-policy",
  );
  headers.set("Access-Control-Max-Age", "86400");
  return headers;
}

function jsonResponse(
  status: number,
  value: unknown,
  request?: Request,
  env?: Env,
  legacy = false,
  extraHeaders?: HeadersInit,
): Response {
  const headers = new Headers(extraHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  if (legacy && request && env) {
    legacyCorsHeaders(request, env).forEach((value, key) =>
      headers.set(key, value),
    );
    headers.set("Deprecation", "true");
  }
  return new Response(JSON.stringify(value), {
    status,
    headers: securityHeaders(headers),
  });
}

function errorResponse(
  error: RelayHttpError,
  request: Request,
  env: Env,
  legacy: boolean,
): Response {
  const headers = new Headers();
  if (error.retryAfter) headers.set("Retry-After", String(error.retryAfter));
  const payload: {
    error: {
      message: string;
      code: string;
      retry_after_seconds?: number;
    };
  } = { error: { message: error.message, code: error.code } };
  if (error.retryAfter) {
    payload.error.retry_after_seconds = error.retryAfter;
  }
  return jsonResponse(error.status, payload, request, env, legacy, headers);
}

function responseHeaders(
  upstream: Response,
  request: Request,
  env: Env,
  legacy: boolean,
): Headers {
  const headers = new Headers();
  upstream.headers.forEach((value, key) => {
    const normalized = key.toLowerCase();
    if (
      API_RESPONSE_HEADERS.has(normalized) ||
      normalized.startsWith("x-ratelimit-") ||
      normalized.startsWith("ratelimit-")
    ) {
      headers.set(key, value);
    }
  });
  if (legacy) {
    legacyCorsHeaders(request, env).forEach((value, key) =>
      headers.set(key, value),
    );
    headers.set("Deprecation", "true");
  }
  headers.set("X-GPT-Image-2-Relay", "1");
  headers.set("X-GPT-Image-2-Relay-Policy", legacy ? "restricted-v1" : "v2");
  return securityHeaders(headers);
}

function checkUpstreamContentLength(
  response: Response,
  maxBytes: number,
): void {
  const raw = response.headers.get("Content-Length");
  if (!raw) return;
  const length = Number(raw);
  if (Number.isFinite(length) && length > maxBytes) {
    response.body?.cancel("relay response exceeded size limit");
    throw new RelayHttpError(
      413,
      `Relay response exceeds the ${maxBytes}-byte limit.`,
      "response_too_large",
    );
  }
}

function relayResponse(
  upstream: Response,
  maxBytes: number,
  request: Request,
  env: Env,
  legacy: boolean,
): Response {
  checkUpstreamContentLength(upstream, maxBytes);
  return new Response(
    upstream.body ? limitResponseBody(upstream.body, maxBytes) : null,
    {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders(upstream, request, env, legacy),
    },
  );
}

function authorizationHeader(request: Request): string {
  const authorization = request.headers.get("Authorization")?.trim() ?? "";
  if (!authorization || authorization.length > 16 * 1024) {
    throw new RelayHttpError(
      400,
      "A valid Authorization header is required.",
      "authorization_required",
    );
  }
  return authorization;
}

function apiRequestHeaders(request: Request, spec: OperationSpec): Headers {
  const headers = new Headers({
    Authorization: authorizationHeader(request),
    "Accept-Encoding": "identity",
  });
  const accept = request.headers.get("Accept");
  if (accept && accept.length <= 512) headers.set("Accept", accept);
  if (spec.requestContentType) {
    const contentType = request.headers.get("Content-Type");
    if (!contentType || contentType.length > 1024) {
      throw new RelayHttpError(
        415,
        "Invalid relay request Content-Type.",
        "unsupported_media_type",
      );
    }
    headers.set("Content-Type", contentType);
  }
  return headers;
}

function requireIdentityEncoding(response: Response): void {
  const encoding = response.headers
    .get("Content-Encoding")
    ?.trim()
    .toLowerCase();
  if (encoding && encoding !== "identity") {
    response.body?.cancel("encoded upstream response rejected");
    throw new RelayHttpError(
      502,
      "Upstream ignored the relay's identity encoding requirement.",
      "upstream_encoding_denied",
    );
  }
}

function requireJsonSuccessResponse(response: Response): void {
  if (!response.ok) return;
  const mediaType =
    response.headers
      .get("Content-Type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase() ?? "";
  if (
    mediaType !== "application/json" &&
    mediaType !== "text/json" &&
    !mediaType.endsWith("+json")
  ) {
    response.body?.cancel("non-JSON upstream response rejected");
    throw new RelayHttpError(
      502,
      "Upstream returned an unsupported success content type.",
      "upstream_content_type_denied",
    );
  }
}

async function fetchApiOperation(
  request: Request,
  env: Env,
  spec: OperationSpec,
  base: URL,
  legacy: boolean,
): Promise<Response> {
  if (spec.requestContentType)
    validateContentType(request, spec.requestContentType);
  validateContentLength(request, spec.maxRequestBytes);
  if (spec.upstreamMethod === "POST" && !request.body) {
    throw new RelayHttpError(400, "Request body is required.", "body_required");
  }
  if (spec.upstreamMethod === "GET" && request.body) {
    throw new RelayHttpError(
      400,
      "Models request must not have a body.",
      "body_not_allowed",
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(operationUrl(base, spec), {
      method: spec.upstreamMethod,
      headers: apiRequestHeaders(request, spec),
      body:
        spec.upstreamMethod === "POST"
          ? limitRequestBody(request.body, spec.maxRequestBytes)
          : undefined,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.any([
        request.signal,
        AbortSignal.timeout(spec.timeoutMs),
      ]),
    });
  } catch (error) {
    if (error instanceof RelayHttpError) throw error;
    throw new RelayHttpError(
      502,
      "Upstream request failed.",
      "upstream_unavailable",
    );
  }
  if (upstream.status >= 300 && upstream.status < 400) {
    upstream.body?.cancel("upstream redirect rejected");
    throw new RelayHttpError(
      502,
      "Upstream API redirects are not allowed.",
      "upstream_redirect_denied",
    );
  }
  requireIdentityEncoding(upstream);
  requireJsonSuccessResponse(upstream);
  return relayResponse(
    upstream,
    upstream.ok
      ? spec.maxResponseBytes
      : Math.min(spec.maxResponseBytes, API_MAX_ERROR_RESPONSE_BYTES),
    request,
    env,
    legacy,
  );
}

async function fetchAsset(
  request: Request,
  env: Env,
  initialTarget: URL,
  legacy: boolean,
): Promise<Response> {
  let target = initialTarget;
  const signal = AbortSignal.any([
    request.signal,
    AbortSignal.timeout(ASSET_TIMEOUT_MS),
  ]);
  for (let redirects = 0; redirects <= ASSET_MAX_REDIRECTS; redirects += 1) {
    let upstream: Response;
    try {
      upstream = await fetch(target, {
        method: "GET",
        headers: {
          Accept: "image/*, application/octet-stream;q=0.9, */*;q=0.1",
          "Accept-Encoding": "identity",
        },
        redirect: "manual",
        cache: "no-store",
        signal,
      });
    } catch {
      throw new RelayHttpError(
        502,
        "Asset download failed.",
        "asset_unavailable",
      );
    }

    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get("Location");
      upstream.body?.cancel("following validated asset redirect");
      if (!location || redirects === ASSET_MAX_REDIRECTS) {
        throw new RelayHttpError(
          502,
          "Asset redirect could not be followed safely.",
          "asset_redirect_denied",
        );
      }
      let next: URL;
      try {
        next = new URL(location, target);
      } catch {
        throw new RelayHttpError(
          502,
          "Asset redirect could not be followed safely.",
          "asset_redirect_denied",
        );
      }
      try {
        target = validateAssetTarget(next.href, new URL(request.url), env);
      } catch {
        throw new RelayHttpError(
          502,
          "Asset redirect could not be followed safely.",
          "asset_redirect_denied",
        );
      }
      continue;
    }

    requireIdentityEncoding(upstream);

    if (upstream.ok) {
      const contentType =
        upstream.headers.get("Content-Type")?.toLowerCase() ?? "";
      if (
        !contentType.startsWith("image/") &&
        !contentType.startsWith("application/octet-stream") &&
        !contentType.startsWith("binary/octet-stream")
      ) {
        upstream.body?.cancel("unexpected asset content type");
        throw new RelayHttpError(
          502,
          "Asset server returned an unsupported content type.",
          "asset_content_type_denied",
        );
      }
    }
    return relayResponse(
      upstream,
      upstream.ok ? ASSET_MAX_RESPONSE_BYTES : ASSET_MAX_ERROR_RESPONSE_BYTES,
      request,
      env,
      legacy,
    );
  }
  throw new RelayHttpError(502, "Asset download failed.", "asset_unavailable");
}

function requireRelayEnabled(env: Env): void {
  if (!relayEnabled(env)) {
    throw new RelayHttpError(503, "Relay is disabled.", "relay_disabled");
  }
}

function requireV2Ready(env: Env): void {
  if (!v2Ready(env)) {
    throw new RelayHttpError(
      503,
      "Relay v2 is not configured.",
      "relay_not_configured",
    );
  }
}

async function handleSessionCreate(
  request: Request,
  env: Env,
): Promise<Response> {
  requireV2Ready(env);
  const origin = requireSameOriginPost(request, env);
  validateContentType(request, "application/json");
  validateContentLength(request, 8 * 1024);
  await enforceRateLimit(
    env.RELAY_SESSION_ISSUE_RATE,
    await rateKeyForRequest(request),
  );
  const payload = await readJsonLimited<{ token?: unknown }>(
    request.body,
    8 * 1024,
  );
  const token = typeof payload.token === "string" ? payload.token : "";
  await verifyTurnstile(request, env, token, origin);
  const issued = await createSessionCookie(env);
  return jsonResponse(
    201,
    { active: true, expires_at: issued.session.expiresAt },
    request,
    env,
    false,
    { "Set-Cookie": issued.header },
  );
}

async function handleSessionStatus(
  request: Request,
  env: Env,
): Promise<Response> {
  requireV2Ready(env);
  requireSameOriginRead(request, env);
  const session = await verifySession(request, env);
  return jsonResponse(200, {
    active: Boolean(session),
    expires_at: session?.expiresAt ?? null,
  });
}

async function authenticatedV2Session(request: Request, env: Env) {
  requireV2Ready(env);
  requireSameOriginPost(request, env);
  const session = await verifySession(request, env);
  if (!session) {
    throw new RelayHttpError(
      401,
      "Relay session is missing or expired.",
      "session_required",
    );
  }
  await enforceRateLimit(env.RELAY_SESSION_RATE, session.sid);
  return session;
}

async function handleV2Operation(
  request: Request,
  env: Env,
  operation: RelayOperation,
): Promise<Response> {
  await authenticatedV2Session(request, env);
  if (operation === "asset") {
    validateContentType(request, "application/json");
    validateContentLength(request, ASSET_MAX_REQUEST_BYTES);
    const payload = await readJsonLimited<{ url?: unknown }>(
      request.body,
      ASSET_MAX_REQUEST_BYTES,
    );
    const target = validateAssetTarget(
      typeof payload.url === "string" ? payload.url : null,
      new URL(request.url),
      env,
    );
    return fetchAsset(request, env, target, false);
  }

  const spec = OPERATION_SPECS[operation];
  const base = validateApiBase(
    request.headers.get(API_BASE_HEADER),
    new URL(request.url),
    env,
  );
  return fetchApiOperation(request, env, spec, base, false);
}

async function handleLegacy(request: Request, env: Env): Promise<Response> {
  requireRelayEnabled(env);
  if (env.RELAY_V1_MODE?.trim().toLowerCase() === "disabled") {
    throw new RelayHttpError(
      410,
      "Legacy relay has been disabled.",
      "legacy_relay_disabled",
    );
  }
  requireLegacyRequestOrigin(request, env);
  await enforceRateLimit(
    env.RELAY_LEGACY_RATE,
    await rateKeyForRequest(request),
  );
  const method = request.headers.get(LEGACY_METHOD_HEADER) ?? "";
  const decision = classifyLegacyRequest(
    request.headers.get(LEGACY_UPSTREAM_HEADER),
    method,
    Boolean(request.headers.get("Authorization")),
    new URL(request.url),
    env,
  );
  if (decision.operation === "asset") {
    validateContentLength(request, 0);
    if (request.body) {
      throw new RelayHttpError(
        400,
        "Asset requests must not have a body.",
        "body_not_allowed",
      );
    }
    return fetchAsset(request, env, decision.target, true);
  }
  return fetchApiOperation(
    request,
    env,
    OPERATION_SPECS[decision.operation],
    decision.base,
    true,
  );
}

function configResponse(env: Env): Response {
  return jsonResponse(200, {
    version: 2,
    enabled: v2Ready(env),
    auth_mode: "turnstile",
    turnstile_site_key: env.TURNSTILE_SITE_KEY?.trim() || null,
    session_ttl_seconds: sessionTtlSeconds(env),
    operations: ["models", "generations", "edits", "asset"],
  });
}

function methodNotAllowed(allow: string): never {
  throw new RelayHttpError(
    405,
    `Method must be ${allow}.`,
    "method_not_allowed",
  );
}

async function route(request: Request, env: Env): Promise<Response> {
  const path = new URL(request.url).pathname;
  const method = request.method.toUpperCase();

  if (path === `${V2_ROOT}/config`) {
    if (method !== "GET") methodNotAllowed("GET");
    return configResponse(env);
  }
  if (path === `${V2_ROOT}/session`) {
    if (method === "GET") return handleSessionStatus(request, env);
    if (method === "POST") return handleSessionCreate(request, env);
    methodNotAllowed("GET or POST");
  }

  const operation = path.slice(`${V2_ROOT}/`.length) as RelayOperation;
  if (
    path.startsWith(`${V2_ROOT}/`) &&
    ["models", "generations", "edits", "asset"].includes(operation)
  ) {
    if (method !== "POST") methodNotAllowed("POST");
    return handleV2Operation(request, env, operation);
  }

  if (path === RELAY_ROOT) {
    if (method === "OPTIONS") {
      requireLegacyRequestOrigin(request, env);
      return new Response(null, {
        status: 204,
        headers: securityHeaders(legacyCorsHeaders(request, env)),
      });
    }
    if (method !== "POST") methodNotAllowed("POST");
    return handleLegacy(request, env);
  }

  throw new RelayHttpError(404, "Relay route was not found.", "not_found");
}

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const legacy = new URL(request.url).pathname === RELAY_ROOT;
    try {
      return await route(request, env);
    } catch (error) {
      if (error instanceof RelayHttpError) {
        return errorResponse(error, request, env, legacy);
      }
      return errorResponse(
        new RelayHttpError(500, "Relay request failed.", "internal_error"),
        request,
        env,
        legacy,
      );
    }
  },
};
