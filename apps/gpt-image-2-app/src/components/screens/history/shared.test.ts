import { describe, expect, it } from "vitest";
import type { Job } from "@/lib/types";
import {
  isClearableTerminalJob,
  jobErrorMessage,
  jobMetaItems,
  jobOutputErrors,
  jobStatusLabel,
  plannedOutputCount,
} from "./shared";

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-test",
    command: "images generate",
    provider: "mock",
    status: "completed",
    created_at: "1",
    updated_at: "1",
    metadata: {
      prompt: "make it",
      size: "1536x864",
      quality: "high",
      n: 3,
    },
    outputs: [
      { index: 0, path: "/tmp/a.png", bytes: 1024 },
      { index: 2, path: "/tmp/c.png", bytes: 2048 },
    ],
    output_path: "/tmp/a.png",
    error: null,
    ...overrides,
  };
}

describe("history job display helpers", () => {
  it("summarizes provider, quality, ratio, and partial counts", () => {
    const value = job({
      status: "partial_failed",
      error: {
        message: "1 candidate failed",
        items: [{ index: 1, message: "upstream rejected candidate B" }],
      },
    });

    expect(plannedOutputCount(value)).toBe(3);
    expect(jobStatusLabel(value)).toBe("部分成功 2/3");
    expect(jobMetaItems(value)).toEqual(["mock", "high", "16:9", "2/3 张"]);
    expect(jobErrorMessage(value)).toBe("1 candidate failed");
    expect(jobOutputErrors(value)).toEqual([
      { index: 1, message: "upstream rejected candidate B", code: undefined },
    ]);
  });

  it("treats all terminal statuses as clearable", () => {
    expect(isClearableTerminalJob(job({ status: "completed" }))).toBe(true);
    expect(isClearableTerminalJob(job({ status: "partial_failed" }))).toBe(
      true,
    );
    expect(isClearableTerminalJob(job({ status: "failed" }))).toBe(true);
    expect(isClearableTerminalJob(job({ status: "cancelled" }))).toBe(true);
    expect(isClearableTerminalJob(job({ status: "running" }))).toBe(false);
    expect(isClearableTerminalJob(job({ status: "uploading" }))).toBe(false);
  });
});
