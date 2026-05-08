import { toast } from "sonner";
import { api } from "@/lib/api";
import type { RuntimeKind } from "@/lib/api/types";
import { invalidateJobsQueries } from "./query-client";

const UNDO_WINDOW_MS = 5_000;
// 500ms grace after toast close so the close animation finishes before the
// hard delete fires (and the user can't see it flicker back).
const HARD_DELETE_DELAY_MS = UNDO_WINDOW_MS + 500;

const pendingHardDeletes = new Map<string, number>();

/**
 * Trigger the soft-delete + 5s undo flow for a job.
 *
 * Tauri runtime: moves the job dir into `result_library_dir/.trash/<id>` and stamps
 * `deleted_at` in the history DB; if the user clicks "撤回" within 5s the
 * folder is moved back and the row is unmarked. Otherwise after 5s the row
 * and folder are permanently removed.
 *
 * Non-Tauri runtimes have no recoverable trash — the call falls through to a
 * hard delete and the toast omits the undo button.
 */
export async function softDeleteJobWithUndo(
  jobId: string,
  runtime: RuntimeKind,
): Promise<void> {
  // If a previous undo timer is still pending for this id, drop it; the new
  // delete request takes precedence.
  const existing = pendingHardDeletes.get(jobId);
  if (existing != null) {
    window.clearTimeout(existing);
    pendingHardDeletes.delete(jobId);
  }

  await api.softDeleteJob(jobId);
  invalidateJobsQueries();

  if (runtime !== "tauri") {
    // Backend already hard-deleted (HTTP/Browser fallback). Show a one-shot
    // success toast without the undo button.
    toast.success("任务已删除", { duration: 2_500 });
    return;
  }

  let cancelled = false;
  const timeoutId = window.setTimeout(() => {
    pendingHardDeletes.delete(jobId);
    if (cancelled) return;
    void api.hardDeleteJob(jobId).catch((error: unknown) => {
      // Hard delete failures shouldn't bubble — the job is already hidden
      // from the UI, and a manual cleanup will catch the leftover on
      // app restart via cleanup_orphan_trash_on_start.
      // eslint-disable-next-line no-console
      console.warn("[image-actions] hard delete failed", error);
    });
  }, HARD_DELETE_DELAY_MS);
  pendingHardDeletes.set(jobId, timeoutId);

  toast("任务已删除", {
    duration: UNDO_WINDOW_MS,
    action: {
      label: "撤回",
      onClick: () => {
        cancelled = true;
        const id = pendingHardDeletes.get(jobId);
        if (id != null) window.clearTimeout(id);
        pendingHardDeletes.delete(jobId);
        api
          .restoreDeletedJob(jobId)
          .then(() => {
            invalidateJobsQueries();
            toast.success("已恢复", { duration: 1_500 });
          })
          .catch((error: unknown) => {
            const message =
              error instanceof Error ? error.message : String(error);
            toast.error("恢复失败", { description: message });
          });
      },
    },
  });
}
