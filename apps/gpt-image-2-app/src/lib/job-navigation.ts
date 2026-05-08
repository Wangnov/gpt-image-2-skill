export const OPEN_JOB_EVENT = "gpt-image-2-open-job";
export const SEND_TO_EDIT_EVENT = "gpt-image-2-send-to-edit";

export type SendToEditPayload = {
  jobId?: string;
  outputIndex?: number;
  path?: string | null;
  url?: string | null;
  name?: string;
  /**
   * Optional prompt to prefill in the edit screen's textarea after the image
   * is added as a reference. Used by the "Edit with Prompt" image action.
   */
  prompt?: string;
};

export function openJobInHistory(jobId: string) {
  window.dispatchEvent(new CustomEvent(OPEN_JOB_EVENT, { detail: { jobId } }));
}

export function sendImageToEdit(payload: SendToEditPayload) {
  window.dispatchEvent(
    new CustomEvent<SendToEditPayload>(SEND_TO_EDIT_EVENT, {
      detail: payload,
    }),
  );
}
