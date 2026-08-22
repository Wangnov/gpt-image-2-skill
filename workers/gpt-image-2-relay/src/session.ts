import { cookieSecure, sessionTtlSeconds } from "./config";
import { readResponseJsonLimited } from "./streams";
import { RelayHttpError, type Env, type RateLimitBinding } from "./types";

const encoder = new TextEncoder();
const SESSION_COOKIE = "__Host-gpt2_relay";
const DEV_SESSION_COOKIE = "gpt2_relay_dev";
const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type RelaySession = {
  sid: string;
  issuedAt: number;
  expiresAt: number;
};

type TurnstileResult = {
  success?: boolean;
  hostname?: string;
  action?: string;
};

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(value),
  );
  return base64Url(new Uint8Array(signature));
}

function timingSafeEqual(left: string, right: string): boolean {
  let difference = left.length ^ right.length;
  const max = Math.max(left.length, right.length);
  for (let index = 0; index < max; index += 1) {
    difference |=
      (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function cookieName(env: Env): string {
  return cookieSecure(env) ? SESSION_COOKIE : DEV_SESSION_COOKIE;
}

function sessionSecret(env: Env): string {
  const secret = env.RELAY_SESSION_HMAC_KEY ?? "";
  if (secret.length < 32) {
    throw new RelayHttpError(
      503,
      "Relay session service is not configured.",
      "relay_not_configured",
    );
  }
  return secret;
}

function randomSid(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(16)));
}

export async function createSessionCookie(
  env: Env,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<{ header: string; session: RelaySession }> {
  const session: RelaySession = {
    sid: randomSid(),
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + sessionTtlSeconds(env),
  };
  const payload = `v2.${session.issuedAt}.${session.expiresAt}.${session.sid}`;
  const signature = await hmac(payload, sessionSecret(env));
  const attributes = [
    `${cookieName(env)}=${payload}.${signature}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${sessionTtlSeconds(env)}`,
  ];
  if (cookieSecure(env)) attributes.push("Secure");
  return { header: attributes.join("; "), session };
}

function cookieValue(request: Request, name: string): string | undefined {
  const raw = request.headers.get("Cookie");
  if (!raw || raw.length > 8192) return undefined;
  for (const part of raw.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return undefined;
}

export async function verifySession(
  request: Request,
  env: Env,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<RelaySession | undefined> {
  const token = cookieValue(request, cookieName(env));
  if (!token || token.length > 512) return undefined;
  const parts = token.split(".");
  if (parts.length !== 5 || parts[0] !== "v2") return undefined;
  const issuedAt = Number(parts[1]);
  const expiresAt = Number(parts[2]);
  const sid = parts[3];
  const signature = parts[4];
  if (
    !Number.isSafeInteger(issuedAt) ||
    !Number.isSafeInteger(expiresAt) ||
    !/^[A-Za-z0-9_-]{20,64}$/.test(sid) ||
    !/^[A-Za-z0-9_-]{40,64}$/.test(signature) ||
    issuedAt > nowSeconds + 60 ||
    expiresAt <= nowSeconds ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > 86_400
  ) {
    return undefined;
  }
  const payload = parts.slice(0, 4).join(".");
  const secrets = [
    sessionSecret(env),
    env.RELAY_SESSION_HMAC_KEY_PREVIOUS ?? "",
  ].filter((secret) => secret.length >= 32);
  for (const secret of secrets) {
    const expected = await hmac(payload, secret);
    if (timingSafeEqual(signature, expected)) {
      return { sid, issuedAt, expiresAt };
    }
  }
  return undefined;
}

export async function rateKeyForRequest(request: Request): Promise<string> {
  const source = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`relay-rate:${source}`),
  );
  return base64Url(new Uint8Array(digest));
}

export async function enforceRateLimit(
  binding: RateLimitBinding | undefined,
  key: string,
): Promise<void> {
  if (!binding) {
    throw new RelayHttpError(
      503,
      "Relay rate limiting is not configured.",
      "relay_not_configured",
    );
  }
  const outcome = await binding.limit({ key });
  if (!outcome.success) {
    throw new RelayHttpError(
      429,
      "Relay rate limit exceeded. Try again shortly.",
      "relay_rate_limited",
      60,
    );
  }
}

export async function verifyTurnstile(
  request: Request,
  env: Env,
  token: string,
  origin: string,
): Promise<void> {
  if (!token || token.length > 2048) {
    throw new RelayHttpError(
      400,
      "Turnstile token is required.",
      "turnstile_token_required",
    );
  }
  const secret = env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) {
    throw new RelayHttpError(
      503,
      "Relay session service is not configured.",
      "relay_not_configured",
    );
  }
  const body = new URLSearchParams({ secret, response: token });
  const remoteIp = request.headers.get("CF-Connecting-IP");
  if (remoteIp) body.set("remoteip", remoteIp);

  let response: Response;
  try {
    response = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new RelayHttpError(
      503,
      "Turnstile verification is temporarily unavailable.",
      "relay_auth_unavailable",
    );
  }
  if (!response.ok) {
    response.body?.cancel("turnstile verification failed");
    throw new RelayHttpError(
      503,
      "Turnstile verification is temporarily unavailable.",
      "relay_auth_unavailable",
    );
  }
  let result: TurnstileResult;
  try {
    result = await readResponseJsonLimited<TurnstileResult>(
      response,
      16 * 1024,
    );
  } catch {
    throw new RelayHttpError(
      503,
      "Turnstile returned an invalid response.",
      "relay_auth_unavailable",
    );
  }
  const expectedHostname = new URL(origin).hostname
    .toLowerCase()
    .replace(/\.$/, "");
  const actualHostname = result.hostname?.toLowerCase().replace(/\.$/, "");
  if (
    result.success !== true ||
    result.action !== "relay_session" ||
    actualHostname !== expectedHostname
  ) {
    throw new RelayHttpError(
      403,
      "Turnstile verification failed.",
      "turnstile_rejected",
    );
  }
}
