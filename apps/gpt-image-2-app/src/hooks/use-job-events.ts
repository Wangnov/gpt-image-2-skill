import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { subscribeEvents } from "@/lib/events";
import type { JobEvent } from "@/lib/types";

/**
 * Follow a Tauri-backed job until it reaches a terminal state.
 */
export function useJobEvents(jobId: string | null) {
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [running, setRunning] = useState(false);
  const qc = useQueryClient();
  const closeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setEvents([]);
    if (!jobId) {
      setRunning(false);
      return;
    }
    setRunning(true);
    const unsubscribe = subscribeEvents(
      jobId,
      (ev) => {
        setEvents((prev) => {
          // Dedup by seq
          if (prev.some((p) => p.seq === ev.seq)) return prev;
          return [...prev, ev];
        });
        if (
          ev.kind === "local" &&
          (ev.type === "job.completed" ||
            ev.type === "job.failed" ||
            ev.type === "job.cancelled" ||
            ev.type === "job.canceled")
        ) {
          setRunning(false);
          qc.invalidateQueries({ queryKey: ["jobs"] });
        }
      },
      () => {
        setRunning(false);
      },
    );
    closeRef.current = unsubscribe;
    return () => {
      unsubscribe();
      closeRef.current = null;
    };
  }, [jobId, qc]);

  return { events, running };
}
