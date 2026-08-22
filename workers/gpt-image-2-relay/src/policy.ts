import { allowedOrigins, blockedHosts } from "./config";
import { RelayHttpError, type Env, type RelayOperation } from "./types";

export const LEGACY_UPSTREAM_HEADER = "x-gpt-image-2-upstream";
export const LEGACY_METHOD_HEADER = "x-gpt-image-2-method";
export const API_BASE_HEADER = "x-gpt-image-2-api-base";
export const RELAY_VERSION_HEADER = "x-gpt-image-2-relay-version";

export type OperationSpec = {
  operation: Exclude<RelayOperation, "asset">;
  suffix: string;
  upstreamMethod: "GET" | "POST";
  maxRequestBytes: number;
  maxResponseBytes: number;
  timeoutMs: number;
  requestContentType?: "application/json" | "multipart/form-data";
};

export const OPERATION_SPECS: Record<
  Exclude<RelayOperation, "asset">,
  OperationSpec
> = {
  models: {
    operation: "models",
    suffix: "/models",
    upstreamMethod: "GET",
    maxRequestBytes: 0,
    maxResponseBytes: 2 * 1024 * 1024,
    timeoutMs: 15_000,
  },
  generations: {
    operation: "generations",
    suffix: "/images/generations",
    upstreamMethod: "POST",
    maxRequestBytes: 1024 * 1024,
    maxResponseBytes: 120 * 1024 * 1024,
    timeoutMs: 300_000,
    requestContentType: "application/json",
  },
  edits: {
    operation: "edits",
    suffix: "/images/edits",
    upstreamMethod: "POST",
    maxRequestBytes: 50 * 1024 * 1024,
    maxResponseBytes: 120 * 1024 * 1024,
    timeoutMs: 300_000,
    requestContentType: "multipart/form-data",
  },
};

export const ASSET_MAX_REQUEST_BYTES = 8 * 1024;
export const ASSET_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
export const ASSET_MAX_ERROR_RESPONSE_BYTES = 64 * 1024;
export const API_MAX_ERROR_RESPONSE_BYTES = 2 * 1024 * 1024;
export const ASSET_TIMEOUT_MS = 60_000;
export const ASSET_MAX_REDIRECTS = 2;

function invalidTarget(message: string): never {
  throw new RelayHttpError(400, message, "invalid_upstream");
}

function normalizedHostname(url: URL): string {
  return url.hostname.toLowerCase().replace(/\.$/, "");
}

function validatePublicHost(url: URL, requestUrl: URL, env: Env): void {
  const hostname = normalizedHostname(url);
  if (!hostname || !hostname.includes(".")) {
    invalidTarget("Upstream must use a public DNS hostname.");
  }
  if (hostname.includes(":") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) {
    invalidTarget("IP literal upstreams are not allowed.");
  }
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".home.arpa")
  ) {
    invalidTarget("Local upstreams are not allowed.");
  }
  const ownHost = normalizedHostname(requestUrl);
  if (hostname === ownHost || blockedHosts(env).has(hostname)) {
    invalidTarget("The relay cannot target itself.");
  }
  url.hostname = hostname;
}

function parsePublicHttpsUrl(
  raw: string | null | undefined,
  maxLength: number,
  requestUrl: URL,
  env: Env,
): URL {
  if (!raw || raw !== raw.trim())
    invalidTarget("Missing or invalid upstream URL.");
  if (raw.length > maxLength) invalidTarget("Upstream URL is too long.");
  if (/\\|[\u0000-\u001f\u007f]/u.test(raw)) {
    invalidTarget("Upstream URL contains forbidden characters.");
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    invalidTarget("Invalid upstream URL.");
  }
  if (url.protocol !== "https:") {
    invalidTarget("Only HTTPS upstreams are allowed.");
  }
  if (url.username || url.password) {
    invalidTarget("Upstream URLs must not include credentials.");
  }
  if (url.port && url.port !== "443") {
    invalidTarget("Only the default HTTPS port is allowed.");
  }
  validatePublicHost(url, requestUrl, env);
  return url;
}

export function validateApiBase(
  raw: string | null | undefined,
  requestUrl: URL,
  env: Env,
): URL {
  if (/%(?:2e|2f|5c|25)/iu.test(raw ?? "")) {
    invalidTarget("Encoded path separators are not allowed in the API base.");
  }
  const url = parsePublicHttpsUrl(raw, 2048, requestUrl, env);
  if (url.search || url.hash) {
    invalidTarget("API base URL must not contain a query or fragment.");
  }
  if (url.pathname.length > 512 || url.pathname.includes("//")) {
    invalidTarget("API base path is invalid.");
  }
  return url;
}

export function operationUrl(base: URL, spec: OperationSpec): URL {
  const basePath =
    base.pathname === "/" ? "" : base.pathname.replace(/\/+$/, "");
  return new URL(`${basePath}${spec.suffix}`, base.origin);
}

export function validateAssetTarget(
  raw: string | null | undefined,
  requestUrl: URL,
  env: Env,
): URL {
  const url = parsePublicHttpsUrl(raw, 8192, requestUrl, env);
  if (url.hash) invalidTarget("Asset URL must not contain a fragment.");
  return url;
}

export type LegacyDecision =
  | { operation: Exclude<RelayOperation, "asset">; base: URL }
  | { operation: "asset"; target: URL };

export function classifyLegacyRequest(
  raw: string | null,
  method: string,
  hasAuthorization: boolean,
  requestUrl: URL,
  env: Env,
): LegacyDecision {
  const normalizedMethod = method.trim().toUpperCase();
  if (normalizedMethod === "GET" && !hasAuthorization) {
    return {
      operation: "asset",
      target: validateAssetTarget(raw, requestUrl, env),
    };
  }
  if (!raw || raw.length > 2048) invalidTarget("Invalid legacy API endpoint.");

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    invalidTarget("Invalid legacy API endpoint.");
  }
  if (parsed.search || parsed.hash) {
    invalidTarget("Legacy API endpoints must not contain a query or fragment.");
  }

  const candidates = Object.values(OPERATION_SPECS).filter(
    (spec) =>
      spec.upstreamMethod === normalizedMethod &&
      parsed.pathname.endsWith(spec.suffix),
  );
  if (candidates.length !== 1) {
    throw new RelayHttpError(
      403,
      "Legacy relay only supports models, generations, edits, and asset downloads.",
      "operation_not_allowed",
    );
  }
  const spec = candidates[0];
  const prefix = parsed.pathname.slice(0, -spec.suffix.length) || "/";
  const base = validateApiBase(`${parsed.origin}${prefix}`, requestUrl, env);
  if (operationUrl(base, spec).href !== parsed.href) {
    invalidTarget("Invalid legacy API endpoint.");
  }
  return { operation: spec.operation, base };
}

export function requireAllowedOrigin(request: Request, env: Env): string {
  const origin = request.headers.get("Origin");
  if (
    !origin ||
    origin !== new URL(request.url).origin ||
    !allowedOrigins(env).includes(origin)
  ) {
    throw new RelayHttpError(403, "Origin is not allowed.", "origin_denied");
  }
  return origin;
}

export function requireSameOriginPost(request: Request, env: Env): string {
  const origin = requireAllowedOrigin(request, env);
  if (request.headers.get("Sec-Fetch-Site") !== "same-origin") {
    throw new RelayHttpError(
      403,
      "Cross-site relay requests are not allowed.",
      "cross_site_denied",
    );
  }
  if (request.headers.get(RELAY_VERSION_HEADER) !== "2") {
    throw new RelayHttpError(
      403,
      "Relay protocol version is missing.",
      "protocol_version_required",
    );
  }
  return origin;
}

export function requireSameOriginRead(request: Request, env: Env): void {
  const origin = request.headers.get("Origin");
  if (
    origin &&
    (origin !== new URL(request.url).origin ||
      !allowedOrigins(env).includes(origin))
  ) {
    throw new RelayHttpError(403, "Origin is not allowed.", "origin_denied");
  }
  if (request.headers.get("Sec-Fetch-Site") !== "same-origin") {
    throw new RelayHttpError(
      403,
      "Cross-site relay requests are not allowed.",
      "cross_site_denied",
    );
  }
}

export function requireLegacyRequestOrigin(request: Request, env: Env): void {
  requireAllowedOrigin(request, env);
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (fetchSite && fetchSite !== "same-origin") {
    throw new RelayHttpError(
      403,
      "Cross-site relay requests are not allowed.",
      "cross_site_denied",
    );
  }
}

export function validateContentType(
  request: Request,
  expected: "application/json" | "multipart/form-data",
): void {
  const contentType = request.headers.get("Content-Type")?.toLowerCase() ?? "";
  const mediaType = contentType.split(";", 1)[0].trim();
  const hasMultipartBoundary =
    /(?:^|;)\s*boundary=(?:"[^"]{1,200}"|[^;\s]{1,200})(?:;|$)/u.test(
      contentType,
    );
  if (
    (expected === "application/json" && mediaType !== "application/json") ||
    (expected === "multipart/form-data" &&
      (mediaType !== "multipart/form-data" || !hasMultipartBoundary))
  ) {
    throw new RelayHttpError(
      415,
      `Relay request must use ${expected}.`,
      "unsupported_media_type",
    );
  }
}

export function validateContentLength(
  request: Request,
  maxBytes: number,
): void {
  const raw = request.headers.get("Content-Length");
  if (!raw) return;
  if (!/^\d+$/.test(raw)) {
    throw new RelayHttpError(400, "Invalid Content-Length.", "invalid_length");
  }
  const length = Number(raw);
  if (!Number.isSafeInteger(length) || length > maxBytes) {
    throw new RelayHttpError(
      413,
      `Relay request exceeds the ${maxBytes}-byte limit.`,
      "request_too_large",
    );
  }
}
