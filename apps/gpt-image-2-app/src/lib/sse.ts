import { api } from "./api";
import type { JobEvent } from "./types";

export type EventHandler = (ev: JobEvent) => void;

const terminal = new Set(["completed", "failed", "cancelled"]);

export function subscribeEvents(
  jobId: string,
  onEvent: EventHandler,
  onDone?: () => void,
): () => void {
  let closed = false;
  let seq = 0;
  const seen = new Set<number>();

  const poll = async () => {
    if (closed) return;
    try {
      const payload = await api.getJob(jobId);
      for (const event of payload.events ?? []) {
        if (seen.has(event.seq)) continue;
        seen.add(event.seq);
        onEvent(event);
      }
      if (terminal.has(payload.job.status)) {
        seq += 1;
        onEvent({
          seq,
          kind: "local",
          type: `job.${payload.job.status}`,
          data: {
            status: payload.job.status,
            output: { path: payload.job.output_path },
          },
        });
        closed = true;
        onDone?.();
      }
    } catch {
      closed = true;
      onDone?.();
    }
  };

  void poll();
  const timer = window.setInterval(poll, 1_200);
  return () => {
    closed = true;
    window.clearInterval(timer);
  };
}
