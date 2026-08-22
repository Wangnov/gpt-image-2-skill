import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserApi, __resetBrowserApiForTests } from "./browser-transport";
import type { ProviderConfig, StorageConfig } from "../types";
import { configuredRelayBase } from "./browser/relay-client";

type CapturedRequest = {
  url: string;
  init?: RequestInit;
};

const tinyPng = Buffer.from("fake-image").toString("base64");

function okJson(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function providerConfig(
  overrides: Partial<ProviderConfig> = {},
): ProviderConfig {
  return {
    type: "openai-compatible",
    api_base: "https://mock.example/v1",
    model: "gpt-image-2",
    supports_n: true,
    edit_region_mode: "native-mask",
    credentials: {
      api_key: { source: "file", value: "sk-test" },
    },
    ...overrides,
  };
}

async function addProvider(overrides: Partial<ProviderConfig> = {}) {
  await browserApi.upsertProvider("mock", {
    ...providerConfig(overrides),
    set_default: true,
  });
}

async function waitForJob(jobId: string) {
  for (let i = 0; i < 80; i += 1) {
    const payload = await browserApi.getJob(jobId);
    if (
      payload.job.status === "completed" ||
      payload.job.status === "partial_failed" ||
      payload.job.status === "failed" ||
      payload.job.status === "cancelled"
    ) {
      return payload.job;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${jobId}`);
}

function installBrowserGlobals(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    open: vi.fn(),
    setTimeout,
    clearTimeout,
    ...overrides,
  });
  vi.stubGlobal("navigator", {
    storage: {
      estimate: vi.fn().mockResolvedValue({ usage: 1, quota: 100 }),
    },
  });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => `blob:mock-${Math.random()}`),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
}

describe("browserApi", () => {
  beforeEach(async () => {
    installBrowserGlobals();
    await __resetBrowserApiForTests();
  });

  afterEach(async () => {
    await __resetBrowserApiForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("stores API keys locally while returning sanitized browser config", async () => {
    await addProvider();

    const config = await browserApi.getConfig();
    expect(config.default_provider).toBe("mock");
    expect(config.providers.mock.credentials.api_key).toEqual({
      source: "file",
      present: true,
    });
    expect(config.providers.codex.disabled).toBe(true);
    expect(config.providers.codex.disabled_reason).toContain("桌面 App");

    const secret = await browserApi.revealProviderCredential("mock", "api_key");
    expect(secret.value).toBe("sk-test");
  });

  it("keeps browser notification preferences while disabling server channels and scrubbing inline secrets", async () => {
    const config = await browserApi.updateNotifications({
      enabled: true,
      on_completed: true,
      on_failed: true,
      on_cancelled: true,
      toast: { enabled: true },
      system: { enabled: true, mode: "auto" },
      email: {
        enabled: true,
        smtp_host: "smtp.example.com",
        smtp_port: 587,
        tls: "start-tls",
        username: "robot",
        password: { source: "file", value: "smtp-secret" },
        from: "robot@example.com",
        to: ["owner@example.com"],
        timeout_seconds: 10,
      },
      webhooks: [
        {
          id: "ops",
          name: "Ops",
          enabled: true,
          url: "https://hooks.example.com/task",
          method: "POST",
          headers: {
            Authorization: { source: "file", value: "Bearer secret" },
          },
          timeout_seconds: 10,
        },
      ],
    });

    expect(config.notifications.enabled).toBe(true);
    expect(config.notifications.system.enabled).toBe(true);
    expect(config.notifications.email.enabled).toBe(false);
    expect(config.notifications.webhooks[0].enabled).toBe(false);
    // The browser cannot deliver SMTP / webhook calls and must not persist
    // their plaintext secrets to IndexedDB. The source stays so the editor
    // still renders a file input, but `present: false` proves the value was
    // scrubbed before storage.
    expect(config.notifications.email.password).toEqual({
      source: "file",
      present: false,
    });
    expect(config.notifications.webhooks[0].headers.Authorization).toEqual({
      source: "file",
      present: false,
    });

    const test = await browserApi.testNotifications("completed");
    expect(test.ok).toBe(true);
    expect(test.reason).toBe("local_only");
    expect(test.deliveries[0].channel).toBe("browser");
  });

  it("keeps static Web remote storage as draft-only and never stores plaintext target secrets", async () => {
    const storage: StorageConfig = {
      targets: {
        "local-default": {
          type: "local",
          directory: "",
          public_base_url: null,
        },
        archive: {
          type: "s3",
          bucket: "images",
          region: "us-east-1",
          endpoint: "https://s3.example.com",
          prefix: "generated",
          access_key_id: { source: "file", value: "ak-test" },
          secret_access_key: { source: "file", value: "sk-test" },
          session_token: { source: "file", value: "session-test" },
          public_base_url: "https://cdn.example.com",
        },
        baidu: {
          type: "baidu_netdisk",
          auth_mode: "oauth",
          app_key: "baidu-app-key",
          secret_key: { source: "file", value: "baidu-secret" },
          access_token: { source: "file", value: "baidu-access" },
          refresh_token: { source: "file", value: "baidu-refresh" },
          app_name: "gpt-image-2",
          remote_dir: "generated",
          public_base_url: "https://pan.example.com",
        },
        pan123: {
          type: "pan123_open",
          auth_mode: "client",
          client_id: "pan-client",
          client_secret: { source: "file", value: "pan-secret" },
          access_token: { source: "file", value: "pan-access" },
          parent_id: 123,
          use_direct_link: true,
        },
      },
      pipeline: {
        mode: "mirror",
        origin: null,
        archives: ["archive", "baidu", "pan123"],
        cleanup: { mode: "never" },
      },
      default_targets: ["archive"],
      fallback_targets: ["archive", "local-default", "baidu", "pan123"],
      fallback_policy: "on_failure",
      upload_concurrency: 4,
      target_concurrency: 2,
      policy: {
        managed: false,
        allow_user_overrides: false,
        allowed_modes: [],
        locked_origin: null,
        locked_archives: [],
        message: null,
      },
    };

    expect(browserApi.updateStorage).toBeDefined();
    expect(browserApi.testStorageTarget).toBeDefined();

    const saved = await browserApi.updateStorage!(storage);

    expect(saved.storage.default_targets).toEqual([]);
    expect(saved.storage.fallback_targets).toEqual([]);
    expect(saved.storage.pipeline).toEqual({
      mode: "local_only",
      origin: null,
      archives: [],
      cleanup: { mode: "never" },
    });
    expect(saved.storage.targets.archive).toMatchObject({
      type: "s3",
      bucket: "images",
      access_key_id: { source: "file", present: false },
      secret_access_key: { source: "file", present: false },
      session_token: { source: "file", present: false },
    });
    expect(saved.storage.targets.baidu).toMatchObject({
      type: "baidu_netdisk",
      auth_mode: "oauth",
      app_key: "baidu-app-key",
      secret_key: { source: "file", present: false },
      access_token: { source: "file", present: false },
      refresh_token: { source: "file", present: false },
      app_name: "gpt-image-2",
      remote_dir: "generated",
    });
    expect(saved.storage.targets.pan123).toMatchObject({
      type: "pan123_open",
      auth_mode: "client",
      client_id: "pan-client",
      client_secret: { source: "file", present: false },
      access_token: { source: "file", present: false },
      parent_id: 123,
      use_direct_link: true,
    });

    const reloaded = await browserApi.getConfig();
    expect(reloaded.storage.default_targets).toEqual([]);
    expect(reloaded.storage.fallback_targets).toEqual([]);
    expect(reloaded.storage.pipeline?.mode).toBe("local_only");
    expect(reloaded.storage.pipeline?.archives).toEqual([]);
    expect(reloaded.storage.pipeline?.origin).toBeNull();
    expect(JSON.stringify(reloaded.storage)).not.toContain("ak-test");
    expect(JSON.stringify(reloaded.storage)).not.toContain("sk-test");
    expect(JSON.stringify(reloaded.storage)).not.toContain("session-test");
    expect(JSON.stringify(reloaded.storage)).not.toContain("baidu-secret");
    expect(JSON.stringify(reloaded.storage)).not.toContain("baidu-access");
    expect(JSON.stringify(reloaded.storage)).not.toContain("baidu-refresh");
    expect(JSON.stringify(reloaded.storage)).not.toContain("pan-secret");
    expect(JSON.stringify(reloaded.storage)).not.toContain("pan-access");
    expect(reloaded.storage.targets.baidu).toMatchObject({
      type: "baidu_netdisk",
      auth_mode: "oauth",
      app_key: "baidu-app-key",
      app_name: "gpt-image-2",
    });
    expect(reloaded.storage.targets.pan123).toMatchObject({
      type: "pan123_open",
      auth_mode: "client",
      client_id: "pan-client",
      parent_id: 123,
      use_direct_link: true,
    });

    const test = await browserApi.testStorageTarget!(
      "archive",
      storage.targets.archive,
    );
    expect(test.ok).toBe(false);
    expect(test.unsupported).toBe(true);
  });

  it("uses native n for providers that support multiple outputs", async () => {
    const requests: CapturedRequest[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ url: String(input), init });
        return okJson({
          data: [{ b64_json: tinyPng }, { b64_json: tinyPng }],
        });
      }),
    );
    await addProvider({ supports_n: true });

    const result = await browserApi.createGenerate({
      prompt: "native n",
      provider: "mock",
      format: "png",
      n: 2,
    });
    const job = await waitForJob(result.job_id);

    expect(job.status).toBe("completed");
    expect(job.outputs).toHaveLength(2);
    expect(browserApi.outputUrl(job.id, 0)).toMatch(/^blob:mock-/);
    const bodies = requests.map((request) =>
      JSON.parse(String(request.init?.body)),
    );
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ prompt: "native n", n: 2 });
  });

  it("retries generate jobs from the stored request with a new job id", async () => {
    const requests: CapturedRequest[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ url: String(input), init });
        return okJson({ data: [{ b64_json: tinyPng }] });
      }),
    );
    await addProvider({ supports_n: true });

    const first = await browserApi.createGenerate({
      prompt: "retry me",
      provider: "mock",
      format: "png",
      quality: "high",
      n: 1,
    });
    await waitForJob(first.job_id);
    const second = await browserApi.retryJob(first.job_id);
    const retried = await waitForJob(second.job_id);

    expect(second.job_id).not.toBe(first.job_id);
    expect(retried.status).toBe("completed");
    const bodies = requests.map((request) =>
      JSON.parse(String(request.init?.body)),
    );
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toMatchObject({ prompt: "retry me", quality: "high" });
  });

  it("paginates browser history without hydrating every stored job", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okJson({ data: [{ b64_json: tinyPng }] })),
    );
    await addProvider({ supports_n: true });

    const created = await Promise.all(
      ["first page", "second page", "third page"].map((prompt) =>
        browserApi.createGenerate({
          prompt,
          provider: "mock",
          format: "png",
          n: 1,
        }),
      ),
    );
    await Promise.all(created.map((job) => waitForJob(job.job_id)));

    const firstPage = await browserApi.listJobsPage({ limit: 2 });
    expect(firstPage.jobs).toHaveLength(2);
    expect(firstPage.has_more).toBe(true);
    expect(firstPage.total).toBe(3);

    const secondPage = await browserApi.listJobsPage({
      limit: 2,
      cursor: firstPage.next_cursor ?? undefined,
    });
    expect(secondPage.jobs).toHaveLength(1);
    expect(secondPage.has_more).toBe(false);

    const searched = await browserApi.listJobsPage({
      limit: 10,
      query: "second",
    });
    expect(searched.jobs.map((job) => job.metadata.prompt)).toEqual([
      "second page",
    ]);
    expect(searched.total).toBe(1);
  });

  it("falls back to concurrent single-output requests when n is unsupported", async () => {
    const requests: CapturedRequest[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ url: String(input), init });
        return okJson({ data: [{ b64_json: tinyPng }] });
      }),
    );
    await addProvider({ supports_n: false });

    const result = await browserApi.createGenerate({
      prompt: "fallback n",
      provider: "mock",
      format: "png",
      n: 3,
    });
    const job = await waitForJob(result.job_id);

    expect(job.status).toBe("completed");
    expect(job.outputs.map((output) => output.index)).toEqual([0, 1, 2]);
    const bodies = requests.map((request) =>
      JSON.parse(String(request.init?.body)),
    );
    expect(bodies).toHaveLength(3);
    expect(bodies.every((body) => !("n" in body))).toBe(true);
  });

  it("keeps successful browser outputs when one fallback request fails", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        if (calls === 2) {
          return new Response(
            JSON.stringify({
              error: { message: "upstream rejected candidate B" },
            }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        return okJson({ data: [{ b64_json: tinyPng }] });
      }),
    );
    await addProvider({ supports_n: false });

    const result = await browserApi.createGenerate({
      prompt: "partial fallback",
      provider: "mock",
      format: "png",
      n: 3,
    });
    const job = await waitForJob(result.job_id);

    expect(job.status).toBe("partial_failed");
    expect(job.outputs.map((output) => output.index)).toEqual([0, 2]);
    expect(job.error?.message).toContain("upstream rejected candidate B");
    expect(job.error?.items).toEqual([
      { index: 1, message: "400 upstream rejected candidate B" },
    ]);
  });

  it("sends edit references, selection hints, and masks as multipart data", async () => {
    const requests: CapturedRequest[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ url: String(input), init });
        return okJson({ data: [{ b64_json: tinyPng }] });
      }),
    );
    await addProvider({ supports_n: true, edit_region_mode: "native-mask" });
    const form = new FormData();
    form.append(
      "meta",
      JSON.stringify({
        prompt: "edit this",
        provider: "mock",
        format: "png",
        n: 1,
      }),
    );
    form.append("ref_00", new File(["ref"], "ref.png", { type: "image/png" }));
    form.append(
      "selection_hint",
      new File(["hint"], "selection.png", { type: "image/png" }),
    );
    form.append("mask", new File(["mask"], "mask.png", { type: "image/png" }));

    const result = await browserApi.createEdit(form);
    const job = await waitForJob(result.job_id);

    expect(job.status).toBe("completed");
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://mock.example/v1/images/edits");
    const body = requests[0].init?.body as FormData;
    expect(body.get("prompt")).toBe("edit this");
    expect(body.getAll("image[]")).toHaveLength(2);
    expect(body.get("mask")).toBeInstanceOf(File);
  });

  it("retries edit jobs with stored reference, hint, and mask files", async () => {
    const requests: CapturedRequest[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ url: String(input), init });
        return okJson({ data: [{ b64_json: tinyPng }] });
      }),
    );
    await addProvider({ supports_n: true, edit_region_mode: "native-mask" });
    const form = new FormData();
    form.append(
      "meta",
      JSON.stringify({
        prompt: "retry edit",
        provider: "mock",
        format: "png",
        n: 1,
      }),
    );
    form.append("ref_00", new File(["ref"], "ref.png", { type: "image/png" }));
    form.append(
      "selection_hint",
      new File(["hint"], "selection.png", { type: "image/png" }),
    );
    form.append("mask", new File(["mask"], "mask.png", { type: "image/png" }));

    const first = await browserApi.createEdit(form);
    await waitForJob(first.job_id);
    const second = await browserApi.retryJob(first.job_id);
    const retried = await waitForJob(second.job_id);

    expect(second.job_id).not.toBe(first.job_id);
    expect(retried.status).toBe("completed");
    expect(requests).toHaveLength(2);
    const body = requests[1].init?.body as FormData;
    expect(body.get("prompt")).toBe("retry edit");
    expect(body.getAll("image[]")).toHaveLength(2);
    expect(body.get("mask")).toBeInstanceOf(File);
  });

  it("records browser-direct network failures with CORS guidance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await addProvider();

    const result = await browserApi.createGenerate({
      prompt: "cors failure",
      provider: "mock",
      format: "png",
      n: 1,
    });
    const job = await waitForJob(result.job_id);

    expect(job.status).toBe("failed");
    expect((job.error as { message?: string }).message).toContain(
      "该服务商不允许浏览器直连",
    );
  });

  it("falls back to the same-origin relay when browser direct fetch is blocked", async () => {
    installBrowserGlobals({ __GPT_IMAGE_2_RELAY_BASE__: "/api/relay" });
    await __resetBrowserApiForTests();
    const requests: CapturedRequest[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ url: String(input), init });
        if (String(input) === "https://mock.example/v1/models") {
          throw new TypeError("Failed to fetch");
        }
        if (String(input) === "/api/relay/v2/session") {
          return okJson({ active: true });
        }
        if (String(input) === "/api/relay/v2/models") {
          const headers = new Headers(init?.headers);
          expect(headers.get("X-GPT-Image-2-Api-Base")).toBe(
            "https://mock.example/v1",
          );
          expect(headers.get("X-GPT-Image-2-Relay-Version")).toBe("2");
          expect(headers.get("Authorization")).toBe("Bearer sk-test");
          return new Response(JSON.stringify({ data: [] }), {
            headers: {
              "Content-Type": "application/json",
              "X-GPT-Image-2-Relay": "1",
            },
          });
        }
        if (String(input) === "/api/relay/v2/generations") {
          const headers = new Headers(init?.headers);
          expect(headers.get("X-GPT-Image-2-Api-Base")).toBe(
            "https://mock.example/v1",
          );
          expect(headers.get("X-GPT-Image-2-Relay-Version")).toBe("2");
          expect(headers.get("X-GPT-Image-2-Upstream")).toBeNull();
          expect(headers.get("Authorization")).toBe("Bearer sk-test");
          return new Response(
            JSON.stringify({ data: [{ b64_json: tinyPng }] }),
            {
              headers: {
                "Content-Type": "application/json",
                "X-GPT-Image-2-Relay": "1",
              },
            },
          );
        }
        throw new Error(`unexpected fetch: ${String(input)}`);
      }),
    );
    await addProvider();

    const result = await browserApi.createGenerate({
      prompt: "relay fallback",
      provider: "mock",
      format: "png",
      n: 1,
    });
    const job = await waitForJob(result.job_id);

    expect(job.status).toBe("completed");
    expect(requests.map((request) => request.url)).toEqual([
      "https://mock.example/v1/models",
      "/api/relay/v2/session",
      "/api/relay/v2/models",
      "/api/relay/v2/generations",
    ]);
  });

  it("establishes an inactive relay session through Turnstile", async () => {
    const host = {
      dataset: {},
      style: {},
      setAttribute: vi.fn(),
      remove: vi.fn(),
    } as unknown as HTMLElement;
    const turnstile: TurnstileApi = {
      render: vi.fn((_container, options) => {
        options.callback("verified-turnstile-token");
        return "widget-1";
      }),
      remove: vi.fn(),
    };
    vi.stubGlobal("document", {
      body: { appendChild: vi.fn() },
      head: { appendChild: vi.fn() },
      createElement: vi.fn(() => host),
      getElementById: vi.fn(() => null),
      querySelectorAll: vi.fn(() => []),
    });
    installBrowserGlobals({
      __GPT_IMAGE_2_RELAY_BASE__: "/api/relay",
      turnstile,
    });
    await __resetBrowserApiForTests();
    const requests: CapturedRequest[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ url: String(input), init });
        if (String(input) === "https://mock.example/v1/models") {
          throw new TypeError("Failed to fetch");
        }
        if (
          String(input) === "/api/relay/v2/session" &&
          init?.method === "GET"
        ) {
          return okJson({ active: false });
        }
        if (String(input) === "/api/relay/v2/config") {
          return okJson({
            version: 2,
            enabled: true,
            auth_mode: "turnstile",
            turnstile_site_key: "site-key",
          });
        }
        if (
          String(input) === "/api/relay/v2/session" &&
          init?.method === "POST"
        ) {
          expect(JSON.parse(String(init.body))).toEqual({
            token: "verified-turnstile-token",
          });
          expect(
            new Headers(init.headers).get("X-GPT-Image-2-Relay-Version"),
          ).toBe("2");
          return okJson({ active: true });
        }
        if (String(input) === "/api/relay/v2/models") {
          return new Response(JSON.stringify({ data: [] }), {
            headers: {
              "Content-Type": "application/json",
              "X-GPT-Image-2-Relay": "1",
            },
          });
        }
        throw new Error(`unexpected fetch: ${String(input)}`);
      }),
    );
    await addProvider();

    const result = await browserApi.testProvider("mock");

    expect(result.ok).toBe(true);
    expect(turnstile.render).toHaveBeenCalledOnce();
    expect(requests.map((request) => request.url)).toEqual([
      "https://mock.example/v1/models",
      "/api/relay/v2/session",
      "/api/relay/v2/config",
      "/api/relay/v2/session",
      "/api/relay/v2/models",
    ]);
  });

  it("sends signed asset URLs in the relay body and never in a header", async () => {
    installBrowserGlobals({ __GPT_IMAGE_2_RELAY_BASE__: "/api/relay" });
    await __resetBrowserApiForTests();
    const signedUrl = "https://cdn.example.com/image.png?signature=secret";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "https://mock.example/v1/models") {
          return okJson({ data: [] });
        }
        if (url === "https://mock.example/v1/images/generations") {
          return okJson({ data: [{ url: signedUrl }] });
        }
        if (url === signedUrl) throw new TypeError("Failed to fetch");
        if (url === "/api/relay/v2/session") return okJson({ active: true });
        if (url === "/api/relay/v2/asset") {
          const headers = new Headers(init?.headers);
          expect(headers.get("X-GPT-Image-2-Upstream")).toBeNull();
          expect([...headers.values()].join(" ")).not.toContain(signedUrl);
          expect(JSON.parse(String(init?.body))).toEqual({ url: signedUrl });
          return new Response(new Uint8Array([1, 2, 3]), {
            headers: {
              "Content-Type": "image/png",
              "X-GPT-Image-2-Relay": "1",
            },
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    await addProvider();

    const result = await browserApi.createGenerate({
      prompt: "signed asset",
      provider: "mock",
      format: "png",
      n: 1,
    });
    const job = await waitForJob(result.job_id);

    expect(job.status).toBe("completed");
  });

  it("rejects a runtime relay URL that is not same-origin", () => {
    installBrowserGlobals({
      __GPT_IMAGE_2_RELAY_BASE__: "https://attacker.example.com/api/relay",
      location: {
        origin: "https://image.codex-pool.com",
        hostname: "image.codex-pool.com",
      },
    });

    expect(configuredRelayBase()).toBeUndefined();

    installBrowserGlobals({
      location: {
        origin: "https://gpt-image-2-dpm.pages.dev",
        hostname: "gpt-image-2-dpm.pages.dev",
      },
    });
    expect(configuredRelayBase()).toBeUndefined();
  });

  it("does not replay a generation POST after an ambiguous network failure", async () => {
    installBrowserGlobals({ __GPT_IMAGE_2_RELAY_BASE__: "/api/relay" });
    await __resetBrowserApiForTests();
    const requests: CapturedRequest[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ url: String(input), init });
        if (String(input) === "https://mock.example/v1/models") {
          return okJson({ data: [] });
        }
        if (String(input) === "https://mock.example/v1/images/generations") {
          throw new TypeError("Failed to fetch after send");
        }
        throw new Error(`unsafe automatic replay: ${String(input)}`);
      }),
    );
    await addProvider();

    const result = await browserApi.createGenerate({
      prompt: "ambiguous response",
      provider: "mock",
      format: "png",
      n: 1,
    });
    const job = await waitForJob(result.job_id);

    expect(job.status).toBe("failed");
    expect(job.error?.message).toContain("不会自动切换中转站重试");
    expect(requests.map((request) => request.url)).toEqual([
      "https://mock.example/v1/models",
      "https://mock.example/v1/images/generations",
    ]);
  });

  it("explains Cloudflare 1016 origin DNS failures from the relay", async () => {
    installBrowserGlobals({ __GPT_IMAGE_2_RELAY_BASE__: "/api/relay" });
    await __resetBrowserApiForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "https://api.duckcoding.com/v1/models") {
          throw new TypeError("Failed to fetch");
        }
        if (String(input) === "/api/relay/v2/session") {
          return okJson({ active: true });
        }
        if (String(input) === "/api/relay/v2/models") {
          return new Response("error code: 1016", {
            status: 530,
            headers: { "X-GPT-Image-2-Relay": "1" },
          });
        }
        throw new Error(`unexpected fetch: ${String(input)}`);
      }),
    );
    await addProvider({ api_base: "https://api.duckcoding.com/v1" });

    const result = await browserApi.testProvider("mock");

    expect(result.ok).toBe(false);
    expect(result.message).toContain("上游服务域名无法解析");
    expect(result.message).toContain("api.duckcoding.com");
  });

  it("emits a quota warning event when browser storage is nearly full", async () => {
    vi.stubGlobal("navigator", {
      storage: {
        estimate: vi.fn().mockResolvedValue({ usage: 90, quota: 100 }),
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okJson({ data: [{ b64_json: tinyPng }] })),
    );
    await addProvider();

    const seen: string[] = [];
    const result = await browserApi.createGenerate({
      prompt: "quota",
      provider: "mock",
      format: "png",
      n: 1,
    });
    const unsubscribe = browserApi.subscribeJobEvents(
      result.job_id,
      (event) => {
        seen.push(event.type);
      },
    );
    const job = await waitForJob(result.job_id);
    unsubscribe();

    expect(job.status).toBe("completed");
    expect(seen).toContain("storage.quota_warning");
  });
});
