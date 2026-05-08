import type { JobEvent } from "../../types";
import { eventLog, jobSubscribers, nextSeq, updateSubscribers } from "./state";

export function nowIso() {
  return new Date().toISOString();
}

export function appendEvent(
  jobId: string,
  type: string,
  data: JobEvent["data"],
  kind: JobEvent["kind"] = "local",
) {
  const seq = (nextSeq.get(jobId) ?? 0) + 1;
  nextSeq.set(jobId, seq);
  const event: JobEvent = { seq, kind, type, data };
  const events = eventLog.get(jobId) ?? [];
  events.push(event);
  if (events.length > 200) events.shift();
  eventLog.set(jobId, events);
  jobSubscribers.get(jobId)?.forEach((handler) => handler(event));
  updateSubscribers.forEach((handler) => handler(jobId, event));
  return event;
}
