import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { Job } from "@/lib/types";
import { jobHasRegionEdit, jobReferenceCount } from "./shared";

/**
 * Resolve displayable URLs for an edit job's input reference images. Handles the
 * async nature of the browser runtime (IndexedDB → object URLs) uniformly with
 * http/tauri (which resolve synchronously), and revokes any object URLs it
 * created on unmount. Returns `[]` for text-to-image jobs.
 */
export function useJobReferenceUrls(job: Job) {
  const [urls, setUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const count = jobReferenceCount(job);
  const isEdit = job.command === "images edit";

  useEffect(() => {
    if (!isEdit || count === 0) {
      setUrls([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    let acquired: string[] = [];
    const revoke = (list: string[]) =>
      list.forEach((url) => {
        if (url.startsWith("blob:")) URL.revokeObjectURL(url);
      });
    setLoading(true);
    api
      .jobReferenceUrls(job)
      .then((next) => {
        if (cancelled) {
          revoke(next);
          return;
        }
        acquired = next;
        setUrls(next);
      })
      .catch(() => {
        if (!cancelled) setUrls([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      revoke(acquired);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id, isEdit, count]);

  return { urls, loading, count };
}

/**
 * Horizontal strip of input reference thumbnails for an `images edit` job, shown
 * above the output grid in an expanded row so the input→output relationship is
 * visible. Mirrors the editor's reference-strip visual language. Renders nothing
 * for text-to-image jobs.
 */
export function JobReferenceStrip({
  job,
  onOpen,
}: {
  job: Job;
  onOpen?: (index: number) => void;
}) {
  const { urls, loading, count } = useJobReferenceUrls(job);
  if (job.command !== "images edit" || count === 0) return null;
  const region = jobHasRegionEdit(job);

  return (
    <div className="mb-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-faint">
        <span className="t-caps">输入参考图</span>
        <span className="font-mono">{count}</span>
        {region && (
          <span className="rounded px-1 py-px text-[10px] text-[color:var(--accent)] bg-[color:var(--accent-10)]">
            局部编辑
          </span>
        )}
      </div>
      <div className="flex gap-2 overflow-x-auto scrollbar-none pb-0.5">
        {loading && urls.length === 0
          ? Array.from({ length: count }).map((_, i) => (
              <div
                key={i}
                aria-hidden
                className="h-16 w-16 shrink-0 rounded-md animate-shimmer"
                style={{
                  background:
                    "linear-gradient(110deg, var(--bg-sunken) 0%, var(--bg-hover) 40%, var(--bg-sunken) 80%)",
                  backgroundSize: "200% 100%",
                }}
              />
            ))
          : urls.map((url, i) => (
              <button
                key={url}
                type="button"
                onClick={
                  onOpen
                    ? (e) => {
                        e.stopPropagation();
                        onOpen(i);
                      }
                    : undefined
                }
                className={cn(
                  "relative h-16 w-16 shrink-0 overflow-hidden rounded-md ring-1 ring-[color:var(--w-10)]",
                  onOpen
                    ? "transition-transform hover:scale-[1.03] hover:ring-[color:var(--accent-45)]"
                    : "cursor-default",
                )}
                title={`参考图 ${i + 1}`}
                aria-label={`参考图 ${i + 1}`}
              >
                <img
                  src={url}
                  alt={`参考图 ${i + 1}`}
                  className="h-full w-full object-cover bg-[color:var(--k-18)]"
                  loading="lazy"
                />
              </button>
            ))}
      </div>
    </div>
  );
}
