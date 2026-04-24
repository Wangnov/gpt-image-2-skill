export const OPEN_JOB_EVENT = "gpt-image-2-open-job";

export function openJobInHistory(jobId: string) {
  window.dispatchEvent(new CustomEvent(OPEN_JOB_EVENT, { detail: { jobId } }));
}
