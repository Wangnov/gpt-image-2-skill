import type { QueryClient } from "@tanstack/react-query";

/**
 * Module-level holder so executors (which run outside React) can invalidate
 * job-related queries without dragging a `useQueryClient()` argument through
 * every call site. Set once at app boot from `main.tsx`.
 */
let stored: QueryClient | null = null;

export function setActionsQueryClient(qc: QueryClient) {
  stored = qc;
}

export function invalidateJobsQueries() {
  if (!stored) return;
  void stored.invalidateQueries({ queryKey: ["jobs"] });
  void stored.invalidateQueries({ queryKey: ["jobs", "active"] });
  void stored.invalidateQueries({ queryKey: ["jobs", "pages"] });
}
