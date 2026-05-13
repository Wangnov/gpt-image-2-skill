import { describe, expect, it } from "vitest";
import { completedEvent, terminalEventType } from "./job-feedback";
import type { TauriJobResponse } from "./api";

describe("terminalEventType", () => {
  it("maps terminal statuses to job events", () => {
    expect(terminalEventType("completed")).toBe("job.completed");
    expect(terminalEventType("partial_failed")).toBe("job.partial_failed");
    expect(terminalEventType("failed")).toBe("job.failed");
    expect(terminalEventType("cancelled")).toBe("job.cancelled");
    expect(terminalEventType("canceled")).toBe("job.cancelled");
  });

  it("uses failed status when completedEvent needs to synthesize an event", () => {
    const event = completedEvent({
      job_id: "job-failed",
      job: {
        id: "job-failed",
        command: "images generate",
        provider: "mock",
        status: "failed",
        created_at: "1",
        updated_at: "1",
        metadata: {},
        outputs: [],
        error: { message: "candidate A failed" },
      },
      payload: {
        output: {
          path: null,
          files: [],
        },
      },
    } satisfies TauriJobResponse);

    expect(event.type).toBe("job.failed");
    expect(event.data.status).toBe("failed");
  });
});
