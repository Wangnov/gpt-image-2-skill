import { afterEach, describe, expect, it, vi } from "vitest";
import { httpApi } from "./http-transport";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("HTTP transport readback recovery", () => {
  it("returns the readback endpoint without prefetching the image body", async () => {
    const fetch = vi.fn();
    globalThis.fetch = fetch as typeof globalThis.fetch;

    const url = await httpApi.ensureJobOutputCached("job 1", 2);

    expect(fetch).not.toHaveBeenCalled();
    expect(url).toBe("/api/jobs/job%201/outputs/2");
    expect(httpApi.fileUrl(url)).toBe(url);
  });

  it("returns null for invalid output references", async () => {
    await expect(httpApi.ensureJobOutputCached("", 0)).resolves.toBeNull();
    await expect(httpApi.ensureJobOutputCached("job-1", -1)).resolves.toBeNull();
  });
});
