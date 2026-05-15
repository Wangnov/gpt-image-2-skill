import { describe, expect, it } from "vitest";
import type { Job } from "@/lib/types";
import {
  derivedRecoverability,
  isClearableTerminalJob,
  jobCanShowRecoveryAction,
  jobErrorMessage,
  jobMetaItems,
  jobOutputErrors,
  jobRecoveryAction,
  jobStatusLabel,
  plannedOutputCount,
  recoveryToastNotice,
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
    expect(isClearableTerminalJob(job({ status: "canceled" }))).toBe(true);
    expect(isClearableTerminalJob(job({ status: "running" }))).toBe(false);
    expect(isClearableTerminalJob(job({ status: "uploading" }))).toBe(false);
  });

  it("treats canceled jobs like cancelled jobs in recovery display", () => {
    const value = job({ status: "canceled", outputs: [], output_path: "" });

    expect(jobStatusLabel(value)).toBe("已取消");
    expect(jobCanShowRecoveryAction(value)).toBe(true);
    expect(jobRecoveryAction(value).action).toBe("resubmit");
  });

  it("shows reupload for completed jobs whose storage upload failed", () => {
    const value = job({
      status: "completed",
      storage_status: "failed",
      outputs: [
        { index: 0, path: "/tmp/a.png", bytes: 1024 },
        { index: 1, path: "/tmp/b.png", bytes: 1024 },
        { index: 2, path: "/tmp/c.png", bytes: 1024 },
      ],
      metadata: {
        prompt: "make it",
        n: 3,
        recoverability: "recoverable.local_response_cached",
      },
    });

    expect(derivedRecoverability(value)).toBe("recoverable.upload_failed");
    expect(jobCanShowRecoveryAction(value)).toBe(true);
    expect(jobRecoveryAction(value).action).toBe("reupload");
  });

  it("keeps fill_missing ahead of reupload for partial output jobs", () => {
    const value = job({
      status: "partial_failed",
      storage_status: "failed",
      metadata: {
        prompt: "make it",
        n: 3,
        recoverability: "recoverable.partial_outputs",
        generation_slots: [
          { index: 0, status: "completed", path: "/tmp/a.png" },
          { index: 1, status: "failed", error: "upstream rejected" },
          { index: 2, status: "missing" },
        ],
      },
    });

    expect(derivedRecoverability(value)).toBe("recoverable.partial_outputs");
    expect(jobCanShowRecoveryAction(value)).toBe(true);
    expect(jobRecoveryAction(value).action).toBe("fill_missing");
  });

  it("does not report partial fill_missing recovery as success", () => {
    const value = job({
      id: "job-fill-missing",
      status: "partial_failed",
      metadata: {
        prompt: "make it",
        n: 3,
        recoverability: "recoverable.partial_outputs",
        generation_slots: [
          { index: 0, status: "completed", path: "/tmp/a.png" },
          { index: 1, status: "failed", error: "upstream rejected" },
          { index: 2, status: "missing" },
        ],
      },
    });
    const recovery = jobRecoveryAction(value);

    expect(
      recoveryToastNotice(
        recovery,
        {
          job_id: "job-fill-missing",
          job: value,
          recovered: false,
        },
        value.id,
      ),
    ).toMatchObject({
      kind: "warning",
      title: "仍有图片未补齐",
    });
    expect(
      recoveryToastNotice(
        recovery,
        {
          job_id: "job-fill-missing",
          job: { ...value, status: "failed", outputs: [] },
          recovered: false,
        },
        value.id,
      ),
    ).toMatchObject({
      kind: "error",
      title: "补齐未完成",
    });
  });
});
