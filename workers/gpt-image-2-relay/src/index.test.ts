import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "./index";
import {
  API_BASE_HEADER,
  RELAY_VERSION_HEADER,
  validateApiBase,
  validateAssetTarget,
} from "./policy";
import { createSessionCookie } from "./session";
import { RelayHttpError, type RateLimitBinding } from "./types";

const SITE_ORIGIN = "https://image.codex-pool.com";
const RELAY_URL = `${SITE_ORIGIN}/api/relay`;
const V2_URL = `${RELAY_URL}/v2`;

function allowRateLimit(): RateLimitBinding {
  return { limit: vi.fn(async () => ({ success: true })) };
}

function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    RELAY_ENABLED: "true",
    RELAY_V2_ENABLED: "true",
    RELAY_V1_MODE: "restricted",
    RELAY_ALLOWED_ORIGINS: SITE_ORIGIN,
    RELAY_BLOCKED_HOSTS: "image.codex-pool.com",
    RELAY_SESSION_TTL_SECONDS: "86400",
    RELAY_COOKIE_SECURE: "true",
    TURNSTILE_SITE_KEY: "test-site-key",
    TURNSTILE_SECRET_KEY: "test-turnstile-secret",
    RELAY_SESSION_HMAC_KEY: "s".repeat(64),
    RELAY_SESSION_RATE: allowRateLimit(),
    RELAY_SESSION_ISSUE_RATE: allowRateLimit(),
    RELAY_LEGACY_RATE: allowRateLimit(),
    ...overrides,
  };
}

function ctx(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  } as unknown as ExecutionContext;
}

function v2Headers(extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set("Origin", SITE_ORIGIN);
  headers.set("Sec-Fetch-Site", "same-origin");
  headers.set(RELAY_VERSION_HEADER, "2");
  return headers;
}

async function sessionCookie(env: Env): Promise<string> {
  const { header } = await createSessionCookie(env);
  return header.split(";", 1)[0];
}

describe("gpt-image-2 relay worker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reports v2 disabled until every secret and rate binding exists", async () => {
    const response = await worker.fetch(
      new Request(`${V2_URL}/config`),
      testEnv({ TURNSTILE_SECRET_KEY: undefined }),
      ctx(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      version: 2,
      enabled: false,
      auth_mode: "turnstile",
      turnstile_site_key: "test-site-key",
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("exchanges a valid Turnstile token for a signed HttpOnly session", async () => {
    const env = testEnv();
    const verifyFetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe(
          "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        );
        const body = init?.body as URLSearchParams;
        expect(body.get("response")).toBe("valid-token");
        expect(body.get("remoteip")).toBe("203.0.113.8");
        return new Response(
          JSON.stringify({
            success: true,
            hostname: "image.codex-pool.com",
            action: "relay_session",
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    );
    vi.stubGlobal("fetch", verifyFetch);

    const response = await worker.fetch(
      new Request(`${V2_URL}/session`, {
        method: "POST",
        headers: v2Headers({
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.8",
        }),
        body: JSON.stringify({ token: "valid-token" }),
      }),
      env,
      ctx(),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ active: true });
    const setCookie = response.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("__Host-gpt2_relay=v2.");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).not.toContain("Domain=");
    expect(env.RELAY_SESSION_ISSUE_RATE?.limit).toHaveBeenCalledOnce();

    const status = await worker.fetch(
      new Request(`${V2_URL}/session`, {
        headers: {
          "Sec-Fetch-Site": "same-origin",
          Cookie: setCookie.split(";", 1)[0],
        },
      }),
      env,
      ctx(),
    );
    expect(await status.json()).toMatchObject({ active: true });
  });

  it("rejects a Turnstile token bound to another hostname", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: true,
              hostname: "attacker.example.com",
              action: "relay_session",
            }),
          ),
      ),
    );
    const response = await worker.fetch(
      new Request(`${V2_URL}/session`, {
        method: "POST",
        headers: v2Headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ token: "wrong-host-token" }),
      }),
      testEnv(),
      ctx(),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "turnstile_rejected" },
    });
  });

  it("fails closed when Turnstile verification is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network unavailable");
      }),
    );
    const response = await worker.fetch(
      new Request(`${V2_URL}/session`, {
        method: "POST",
        headers: v2Headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ token: "unverifiable-token" }),
      }),
      testEnv(),
      ctx(),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "relay_auth_unavailable" },
    });
  });

  it("proxies only the fixed models path with a valid session", async () => {
    const env = testEnv();
    const cookie = await sessionCookie(env);
    const upstreamFetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("https://api.example.com/v1/models");
        const headers = new Headers(init?.headers);
        expect(headers.get("Authorization")).toBe("Bearer sk-test");
        expect(headers.get("Accept-Encoding")).toBe("identity");
        expect(headers.get("Cookie")).toBeNull();
        expect(headers.get(API_BASE_HEADER)).toBeNull();
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Set-Cookie": "upstream-secret=1",
            Location: "https://attacker.example.com/",
            "X-Request-Id": "req_123",
          },
        });
      },
    );
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await worker.fetch(
      new Request(`${V2_URL}/models`, {
        method: "POST",
        headers: v2Headers({
          Cookie: cookie,
          Authorization: "Bearer sk-test",
          [API_BASE_HEADER]: "https://api.example.com/v1",
        }),
      }),
      env,
      ctx(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [] });
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(response.headers.get("Location")).toBeNull();
    expect(response.headers.get("X-Request-Id")).toBe("req_123");
    expect(response.headers.get("X-GPT-Image-2-Relay-Policy")).toBe("v2");
    expect(env.RELAY_SESSION_RATE?.limit).toHaveBeenCalledOnce();
  });

  it("requires exact origin, fetch metadata, protocol version, and session", async () => {
    const env = testEnv({
      RELAY_ALLOWED_ORIGINS: `${SITE_ORIGIN},https://gpt-image-2-dpm.pages.dev`,
    });
    const baseHeaders = {
      Authorization: "Bearer sk-test",
      [API_BASE_HEADER]: "https://api.example.com/v1",
    };
    const cases: Array<[HeadersInit, string]> = [
      [baseHeaders, "origin_denied"],
      [
        { ...baseHeaders, Origin: "https://attacker.example.com" },
        "origin_denied",
      ],
      [
        {
          ...baseHeaders,
          Origin: "https://gpt-image-2-dpm.pages.dev",
          "Sec-Fetch-Site": "same-origin",
          [RELAY_VERSION_HEADER]: "2",
        },
        "origin_denied",
      ],
      [{ ...baseHeaders, Origin: SITE_ORIGIN }, "cross_site_denied"],
      [
        {
          ...baseHeaders,
          Origin: SITE_ORIGIN,
          "Sec-Fetch-Site": "same-origin",
        },
        "protocol_version_required",
      ],
      [v2Headers(baseHeaders), "session_required"],
    ];

    for (const [headers, code] of cases) {
      const response = await worker.fetch(
        new Request(`${V2_URL}/models`, { method: "POST", headers }),
        env,
        ctx(),
      );
      expect(response.status).toBe(code === "session_required" ? 401 : 403);
      expect(await response.json()).toMatchObject({ error: { code } });
    }
  });

  it("rejects tampered and expired session cookies", async () => {
    const env = testEnv();
    const tampered = `${await sessionCookie(env)}x`;
    const expired = (
      await createSessionCookie(env, Math.floor(Date.now() / 1000) - 90_000)
    ).header.split(";", 1)[0];
    for (const cookie of [tampered, expired]) {
      const response = await worker.fetch(
        new Request(`${V2_URL}/models`, {
          method: "POST",
          headers: v2Headers({
            Cookie: cookie,
            Authorization: "Bearer sk-test",
            [API_BASE_HEADER]: "https://api.example.com/v1",
          }),
        }),
        env,
        ctx(),
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        error: { code: "session_required" },
      });
    }
  });

  it("blocks SSRF URL forms while preserving arbitrary public domains", () => {
    const env = testEnv();
    const requestUrl = new URL(`${V2_URL}/models`);
    for (const target of [
      "http://api.example.com/v1",
      "https://127.0.0.1/v1",
      "https://2130706433/v1",
      "https://0x7f000001/v1",
      "https://0177.0.0.1/v1",
      "https://127.1/v1",
      "https://[::1]/v1",
      "https://localhost/v1",
      "https://metadata.google.internal/v1",
      "https://image.codex-pool.com/v1",
      "https://user:password@api.example.com/v1",
      "https://api.example.com:8443/v1",
      "https://api.example.com/%2e%2e/v1",
      "https://api.example.com/v1?target=x",
      "https://api.example.com/v1#fragment",
    ]) {
      expect(() => validateApiBase(target, requestUrl, env)).toThrow(
        RelayHttpError,
      );
    }

    expect(
      validateApiBase(
        "https://user-chosen-relay.example.com/openai/v1",
        requestUrl,
        env,
      ).href,
    ).toBe("https://user-chosen-relay.example.com/openai/v1");
    expect(
      validateAssetTarget(
        "https://cdn.example.com/file?X-Amz-Credential=a%2Fb",
        requestUrl,
        env,
      ).search,
    ).toContain("X-Amz-Credential");
  });

  it("enforces generation request size before contacting the upstream", async () => {
    const env = testEnv();
    const cookie = await sessionCookie(env);
    const upstreamFetch = vi.fn();
    vi.stubGlobal("fetch", upstreamFetch);
    const response = await worker.fetch(
      new Request(`${V2_URL}/generations`, {
        method: "POST",
        headers: v2Headers({
          Cookie: cookie,
          Authorization: "Bearer sk-test",
          [API_BASE_HEADER]: "https://api.example.com/v1",
          "Content-Type": "application/json",
          "Content-Length": String(1024 * 1024 + 1),
        }),
        body: "{}",
      }),
      env,
      ctx(),
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: { code: "request_too_large" },
    });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("enforces the generation limit on a chunked body with no Content-Length", async () => {
    const env = testEnv();
    const cookie = await sessionCookie(env);
    const chunk = new Uint8Array(600 * 1024);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      },
    });
    const upstreamFetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const reader = (init?.body as ReadableStream<Uint8Array>).getReader();
        while (!(await reader.read()).done) {
          // Consume the transformed stream so its byte counter is exercised.
        }
        return new Response("unreachable");
      },
    );
    vi.stubGlobal("fetch", upstreamFetch);
    const request = new Request(`${V2_URL}/generations`, {
      method: "POST",
      headers: v2Headers({
        Cookie: cookie,
        Authorization: "Bearer sk-test",
        [API_BASE_HEADER]: "https://api.example.com/v1",
        "Content-Type": "application/json",
      }),
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const response = await worker.fetch(request, env, ctx());

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: { code: "request_too_large" },
    });
    expect(upstreamFetch).toHaveBeenCalledOnce();
  });

  it("rejects an oversized upstream response before streaming it", async () => {
    const env = testEnv();
    const cookie = await sessionCookie(env);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("x", {
            headers: {
              "Content-Type": "application/json",
              "Content-Length": String(2 * 1024 * 1024 + 1),
            },
          }),
      ),
    );
    const response = await worker.fetch(
      new Request(`${V2_URL}/models`, {
        method: "POST",
        headers: v2Headers({
          Cookie: cookie,
          Authorization: "Bearer sk-test",
          [API_BASE_HEADER]: "https://api.example.com/v1",
        }),
      }),
      env,
      ctx(),
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: { code: "response_too_large" },
    });
  });

  it("rejects encoded upstream bodies before applying the byte limit", async () => {
    const env = testEnv();
    const cookie = await sessionCookie(env);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("compressed", {
            headers: {
              "Content-Type": "application/json",
              "Content-Encoding": "gzip",
            },
          }),
      ),
    );
    const response = await worker.fetch(
      new Request(`${V2_URL}/models`, {
        method: "POST",
        headers: v2Headers({
          Cookie: cookie,
          Authorization: "Bearer sk-test",
          [API_BASE_HEADER]: "https://api.example.com/v1",
        }),
      }),
      env,
      ctx(),
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: { code: "upstream_encoding_denied" },
    });
  });

  it("rejects non-JSON successful API responses", async () => {
    const env = testEnv();
    const cookie = await sessionCookie(env);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<html>unexpected</html>", {
            headers: { "Content-Type": "text/html" },
          }),
      ),
    );
    const response = await worker.fetch(
      new Request(`${V2_URL}/models`, {
        method: "POST",
        headers: v2Headers({
          Cookie: cookie,
          Authorization: "Bearer sk-test",
          [API_BASE_HEADER]: "https://api.example.com/v1",
        }),
      }),
      env,
      ctx(),
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: { code: "upstream_content_type_denied" },
    });
  });

  it("downloads an asset without forwarding credentials or cookies", async () => {
    const env = testEnv();
    const cookie = await sessionCookie(env);
    const upstreamFetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        expect(headers.get("Authorization")).toBeNull();
        expect(headers.get("Cookie")).toBeNull();
        expect(headers.get("Referer")).toBeNull();
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: {
            "Content-Type": "image/png",
            "Set-Cookie": "cdn-secret=1",
          },
        });
      },
    );
    vi.stubGlobal("fetch", upstreamFetch);
    const response = await worker.fetch(
      new Request(`${V2_URL}/asset`, {
        method: "POST",
        headers: v2Headers({
          Cookie: cookie,
          Authorization: "Bearer must-not-be-forwarded",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          url: "https://cdn.example.com/signed.png?token=sensitive",
        }),
      }),
      env,
      ctx(),
    );

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });

  it("revalidates asset redirects and blocks a redirect to an IP literal", async () => {
    const env = testEnv();
    const cookie = await sessionCookie(env);
    const upstreamFetch = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: "https://127.0.0.1/private" },
        }),
    );
    vi.stubGlobal("fetch", upstreamFetch);
    const response = await worker.fetch(
      new Request(`${V2_URL}/asset`, {
        method: "POST",
        headers: v2Headers({
          Cookie: cookie,
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ url: "https://cdn.example.com/image.png" }),
      }),
      env,
      ctx(),
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: { code: "asset_redirect_denied" },
    });
    expect(upstreamFetch).toHaveBeenCalledOnce();
  });

  it("rejects bodies on the legacy asset compatibility path", async () => {
    const upstreamFetch = vi.fn();
    vi.stubGlobal("fetch", upstreamFetch);
    const response = await worker.fetch(
      new Request(RELAY_URL, {
        method: "POST",
        headers: {
          Origin: SITE_ORIGIN,
          "X-GPT-Image-2-Upstream": "https://cdn.example.com/image.png",
          "X-GPT-Image-2-Method": "GET",
          "Content-Type": "text/plain",
        },
        body: "unexpected",
      }),
      testEnv(),
      ctx(),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "body_not_allowed" },
    });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("keeps legacy clients working during v2 secret setup but rejects arbitrary paths and missing origins", async () => {
    const env = testEnv({ RELAY_SESSION_HMAC_KEY: undefined });
    const upstreamFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [] }), {
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", upstreamFetch);

    const valid = await worker.fetch(
      new Request(RELAY_URL, {
        method: "POST",
        headers: {
          Origin: SITE_ORIGIN,
          Authorization: "Bearer sk-test",
          "X-GPT-Image-2-Upstream": "https://api.example.com/v1/models",
          "X-GPT-Image-2-Method": "GET",
        },
      }),
      env,
      ctx(),
    );
    expect(valid.status).toBe(200);
    expect(valid.headers.get("X-GPT-Image-2-Relay-Policy")).toBe(
      "restricted-v1",
    );
    expect(valid.headers.get("Deprecation")).toBe("true");

    const arbitrary = await worker.fetch(
      new Request(RELAY_URL, {
        method: "POST",
        headers: {
          Origin: SITE_ORIGIN,
          Authorization: "Bearer sk-test",
          "X-GPT-Image-2-Upstream": "https://api.example.com/admin/delete",
          "X-GPT-Image-2-Method": "DELETE",
        },
      }),
      env,
      ctx(),
    );
    expect(arbitrary.status).toBe(403);
    expect(await arbitrary.json()).toMatchObject({
      error: { code: "operation_not_allowed" },
    });

    const missingOrigin = await worker.fetch(
      new Request(RELAY_URL, {
        method: "POST",
        headers: {
          Authorization: "Bearer sk-test",
          "X-GPT-Image-2-Upstream": "https://api.example.com/v1/models",
          "X-GPT-Image-2-Method": "GET",
        },
      }),
      env,
      ctx(),
    );
    expect(missingOrigin.status).toBe(403);
  });

  it("returns 429 when the session rate limiter rejects a request", async () => {
    const env = testEnv({
      RELAY_SESSION_RATE: {
        limit: vi.fn(async () => ({ success: false })),
      },
    });
    const response = await worker.fetch(
      new Request(`${V2_URL}/models`, {
        method: "POST",
        headers: v2Headers({
          Cookie: await sessionCookie(env),
          Authorization: "Bearer sk-test",
          [API_BASE_HEADER]: "https://api.example.com/v1",
        }),
      }),
      env,
      ctx(),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(await response.json()).toMatchObject({
      error: { code: "relay_rate_limited", retry_after_seconds: 60 },
    });
  });

  it("handles the restricted legacy CORS preflight", async () => {
    const response = await worker.fetch(
      new Request(RELAY_URL, {
        method: "OPTIONS",
        headers: { Origin: SITE_ORIGIN },
      }),
      testEnv(),
      ctx(),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      SITE_ORIGIN,
    );
  });
});
