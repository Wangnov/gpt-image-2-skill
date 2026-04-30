import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserApi, __resetBrowserApiForTests } from "./browser-transport";
import type { ProviderConfig } from "../types";

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
        if (String(input) === "https://mock.example/v1/images/generations") {
          throw new TypeError("Failed to fetch");
        }
        if (String(input) === "/api/relay") {
          const headers = new Headers(init?.headers);
          expect(headers.get("X-GPT-Image-2-Upstream")).toBe(
            "https://mock.example/v1/images/generations",
          );
          expect(headers.get("X-GPT-Image-2-Method")).toBe("POST");
          expect(headers.get("Authorization")).toBe("Bearer sk-test");
          return okJson({ data: [{ b64_json: tinyPng }] });
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
      "https://mock.example/v1/images/generations",
      "/api/relay",
    ]);
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
