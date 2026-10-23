import type { Env } from "./types";

export const DEFAULT_ALLOWED_ORIGINS = ["https://image.codex-pool.com"];

export const DEFAULT_BLOCKED_HOSTS = [
  "image.codex-pool.com",
  "gpt-image-2-dpm.pages.dev",
];

export function boolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function boundedIntEnv(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function csv(value: string | undefined, fallback: string[]): string[] {
  const items = (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : fallback;
}

export function allowedOrigins(env: Env): string[] {
  const origins = csv(env.RELAY_ALLOWED_ORIGINS, DEFAULT_ALLOWED_ORIGINS)
    .filter((item) => item !== "*")
    .flatMap((item) => {
      try {
        const parsed = new URL(item);
        if (
          !["https:", "http:"].includes(parsed.protocol) ||
          parsed.username ||
          parsed.password ||
          parsed.pathname !== "/" ||
          parsed.search ||
          parsed.hash
        ) {
          return [];
        }
        return [parsed.origin];
      } catch {
        return [];
      }
    });
  return [...new Set(origins)];
}

export function blockedHosts(env: Env): Set<string> {
  return new Set(
    csv(env.RELAY_BLOCKED_HOSTS, DEFAULT_BLOCKED_HOSTS).map((item) =>
      item.toLowerCase().replace(/\.$/, ""),
    ),
  );
}

export function sessionTtlSeconds(env: Env): number {
  return boundedIntEnv(env.RELAY_SESSION_TTL_SECONDS, 86_400, 300, 86_400);
}

export function cookieSecure(env: Env): boolean {
  return boolEnv(env.RELAY_COOKIE_SECURE, true);
}

export function relayEnabled(env: Env): boolean {
  return boolEnv(env.RELAY_ENABLED, true);
}

export function v2Ready(env: Env): boolean {
  return (
    relayEnabled(env) &&
    boolEnv(env.RELAY_V2_ENABLED, true) &&
    Boolean(env.TURNSTILE_SITE_KEY?.trim()) &&
    Boolean(env.TURNSTILE_SECRET_KEY?.trim()) &&
    (env.RELAY_SESSION_HMAC_KEY?.length ?? 0) >= 32 &&
    Boolean(env.RELAY_SESSION_RATE) &&
    Boolean(env.RELAY_SESSION_ISSUE_RATE)
  );
}
