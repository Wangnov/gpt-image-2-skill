import { describe, expect, it } from "vitest";
import type { Job } from "../../types";
import { jobDownloadEntries, jobOutputDownloadName } from "./downloads";

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    command: "images generate",
    provider: "mock",
    status: "completed",
    created_at: "2026-05-13T00:00:00Z",
    updated_at: "2026-05-13T00:00:00Z",
    metadata: {},
    outputs: [],
    error: null,
    ...overrides,
  };
}

describe("HTTP downloads", () => {
  it("preserves real output indexes for sparse ZIP exports", () => {
    const entries = jobDownloadEntries(
      job({
        outputs: [
          { index: 3, path: "/tmp/c.webp", bytes: 1 },
          { index: 1, path: "/tmp/a.jpg", bytes: 1 },
        ],
      }),
    );

    expect(entries).toEqual([
      { path: "/tmp/a.jpg", outputIndex: 1 },
      { path: "/tmp/c.webp", outputIndex: 3 },
    ]);
  });

  it("uses the actual output extension for single-output downloads", () => {
    const downloadName = jobOutputDownloadName(
      job({
        outputs: [{ index: 2, path: "/tmp/result final.jpeg", bytes: 1 }],
      }),
      2,
    );

    expect(downloadName).toBe("result-final.jpeg");
  });
});
