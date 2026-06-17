import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import type { Job } from "@/lib/types";
import { jobHasRegionEdit } from "./shared";
import { useJobReferenceUrls } from "./job-reference-strip";

const SHIMMER = {
  background:
    "linear-gradient(110deg, var(--bg-sunken) 0%, var(--bg-hover) 40%, var(--bg-sunken) 80%)",
  backgroundSize: "200% 100%",
} as const;

/**
 * Before/after wipe slider: the output is the base layer, the reference image is
 * clipped on top and revealed left-to-right by a draggable handle. The range
 * input is a full-bleed transparent control so it stays keyboard-accessible.
 *
 * Both layers share one object-contain box, so the wipe lines up exactly when
 * input and output share an aspect ratio (the common edit case). When ratios
 * differ the contained images letterbox differently and the comparison is
 * approximate — acceptable for a quick visual diff.
 */
function BeforeAfterSlider({
  before,
  after,
}: {
  before: string;
  after: string;
}) {
  const [pos, setPos] = useState(50);
  return (
    <div
      className="relative w-full select-none overflow-hidden rounded-lg bg-[color:var(--k-18)] ring-1 ring-[color:var(--w-08)]"
      style={{ height: 280 }}
    >
      <img
        src={after}
        alt="生成结果"
        draggable={false}
        className="absolute inset-0 h-full w-full object-contain"
      />
      <img
        src={before}
        alt="输入参考图"
        draggable={false}
        className="absolute inset-0 h-full w-full object-contain"
        style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 bottom-0 w-px bg-[color:var(--accent)]"
        style={{ left: `${pos}%` }}
      >
        <span className="absolute left-1/2 top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[color:var(--accent)] text-[color:var(--bg)]">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8 7l-4 5 4 5M16 7l4 5-4 5" />
          </svg>
        </span>
      </div>
      <span
        className="pointer-events-none absolute left-2 top-2 rounded px-1.5 py-0.5 text-[10px] font-mono text-foreground"
        style={{ background: "var(--k-55)" }}
      >
        输入
      </span>
      <span
        className="pointer-events-none absolute right-2 top-2 rounded px-1.5 py-0.5 text-[10px] font-mono text-foreground"
        style={{ background: "var(--k-55)" }}
      >
        输出
      </span>
      <input
        type="range"
        min={0}
        max={100}
        value={pos}
        onChange={(event) => setPos(Number(event.currentTarget.value))}
        aria-label="对比输入与输出"
        className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
      />
    </div>
  );
}

/**
 * Detail-drawer section for an `images edit` job: shows the input reference
 * images and, when an output exists, a before/after wipe against the selected
 * reference. Renders nothing for text-to-image jobs.
 */
export function JobReferenceCompare({
  job,
  outputUrl,
}: {
  job: Job;
  outputUrl?: string | null;
}) {
  const { urls, loading, count } = useJobReferenceUrls(job);
  const [selected, setSelected] = useState(0);
  useEffect(() => setSelected(0), [job.id]);
  if (job.command !== "images edit" || count === 0) return null;
  const region = jobHasRegionEdit(job);
  const activeRef = urls[Math.min(selected, Math.max(0, urls.length - 1))];

  return (
    <section className="surface-panel space-y-3 p-4">
      <div className="flex items-center gap-1.5">
        <span className="t-caps">输入参考图</span>
        <span className="font-mono text-[11px] text-faint">{count}</span>
        {region && (
          <span className="rounded bg-[color:var(--accent-10)] px-1 py-px text-[10px] text-[color:var(--accent)]">
            局部编辑
          </span>
        )}
      </div>

      <div className="flex gap-2 overflow-x-auto scrollbar-none">
        {loading && urls.length === 0
          ? Array.from({ length: count }).map((_, i) => (
              <div
                key={i}
                aria-hidden
                className="h-14 w-14 shrink-0 rounded-md animate-shimmer"
                style={SHIMMER}
              />
            ))
          : urls.map((url, i) => (
              <button
                key={url}
                type="button"
                onClick={() => setSelected(i)}
                className={cn(
                  "relative h-14 w-14 shrink-0 overflow-hidden rounded-md ring-1 transition-all",
                  i === selected
                    ? "scale-[1.04] ring-[color:var(--accent-55)]"
                    : "opacity-70 ring-[color:var(--w-10)] hover:opacity-100",
                )}
                aria-label={`参考图 ${i + 1}`}
                aria-pressed={i === selected}
                title={`参考图 ${i + 1}`}
              >
                <img
                  src={url}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
      </div>

      {activeRef && outputUrl ? (
        <>
          <BeforeAfterSlider before={activeRef} after={outputUrl} />
          <p className="text-[10.5px] text-faint">
            拖动滑块对比输入参考图与生成结果。
          </p>
        </>
      ) : activeRef ? (
        <div className="overflow-hidden rounded-lg ring-1 ring-[color:var(--w-08)]">
          <img
            src={activeRef}
            alt="输入参考图"
            className="block max-h-[280px] w-full bg-[color:var(--k-18)] object-contain"
          />
        </div>
      ) : null}
    </section>
  );
}
