export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  RELAY_ENABLED?: string;
  RELAY_V2_ENABLED?: string;
  RELAY_V1_MODE?: string;
  RELAY_ALLOWED_ORIGINS?: string;
  RELAY_BLOCKED_HOSTS?: string;
  RELAY_SESSION_TTL_SECONDS?: string;
  RELAY_COOKIE_SECURE?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  RELAY_SESSION_HMAC_KEY?: string;
  RELAY_SESSION_HMAC_KEY_PREVIOUS?: string;
  RELAY_SESSION_RATE?: RateLimitBinding;
  RELAY_SESSION_ISSUE_RATE?: RateLimitBinding;
  RELAY_LEGACY_RATE?: RateLimitBinding;
}

export type RelayOperation = "models" | "generations" | "edits" | "asset";

export class RelayHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "RelayHttpError";
  }
}
