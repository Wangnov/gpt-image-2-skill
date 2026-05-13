import { afterEach, describe, expect, it, vi } from "vitest";
import { httpApi } from "./http-transport";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("HTTP transport readback recovery", () => {
  it("rehydrates job outputs through the output endpoint", async () => {
    const fetch = vi.fn(async () => new Response("png", { status: 200 }));
    globalThis.fetch = fetch as typeof globalThis.fetch;

    const url = await httpApi.ensureJobOutputCached("job 1", 2);

    expect(fetch).toHaveBeenCalledWith("/api/jobs/job%201/outputs/2", {
      cache: "no-store",
    });
    expect(url).toBe("/api/jobs/job%201/outputs/2");
    expect(httpApi.fileUrl(url)).toBe(url);
  });

  it("keeps returning null when readback cannot recover the output", async () => {
    const fetch = vi.fn(async () => new Response("missing", { status: 404 }));
    globalThis.fetch = fetch as typeof globalThis.fetch;

    await expect(httpApi.ensureJobOutputCached("job-1", 0)).resolves.toBeNull();
  });
});
