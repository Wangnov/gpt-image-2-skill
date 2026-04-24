import { api } from "./api";
import type { JobEvent } from "./types";

export type EventHandler = (ev: JobEvent) => void;

export function subscribeEvents(
  jobId: string,
  onEvent: EventHandler,
  onDone?: () => void,
): () => void {
  return api.subscribeJobEvents(jobId, onEvent, onDone);
}
