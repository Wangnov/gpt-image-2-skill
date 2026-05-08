import { Icon } from "@/components/icon";
import { PlaceholderImage } from "@/components/screens/shared/placeholder-image";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { Job } from "@/lib/types";
import { SHIMMER_STYLE } from "./job-drawer-utils";

export function JobDrawerPreview({
  job,
  seed,
  planned,
  doneCount,
  selectedOutput,
  selectedLabel,
  previewUrl,
  imageFailed,
  setImageFailed,
  setSelectedOutput,
}: {
  job: Job;
  seed: number;
  planned: number;
  doneCount: number;
  selectedOutput: number;
  selectedLabel: string;
  previewUrl: string;
  imageFailed: boolean;
  setImageFailed: (failed: boolean) => void;
  setSelectedOutput: (index: number) => void;
}) {
  return (
    <>
      <div className="aspect-square rounded-[10px] overflow-hidden border border-border mb-3 bg-sunken">
        {previewUrl && !imageFailed ? (
          <img
            src={previewUrl}
            alt={`生成图片预览 · 候选 ${selectedLabel}`}
            decoding="async"
            className="w-full h-full object-cover"
            onError={() => setImageFailed(true)}
          />
        ) : doneCount >= 1 || job.status === "completed" ? (
          <PlaceholderImage seed={seed + selectedOutput} />
        ) : job.status === "failed" || job.status === "cancelled" ? (
          <div className="flex h-full w-full items-center justify-center text-faint">
            <Icon name="warn" size={24} aria-hidden="true" />
          </div>
        ) : (
          <div
            aria-hidden="true"
            className="h-full w-full animate-shimmer"
            style={SHIMMER_STYLE}
          />
        )}
      </div>

      {planned > 1 && (
        <div className="mb-3.5 flex flex-wrap gap-1.5">
          {Array.from({ length: planned }).map((_, index) => {
            const path = api.jobOutputPath(job, index);
            const url = path ? api.fileUrl(path) : "";
            const label = String.fromCharCode(65 + index);
            const isSelected = index === selectedOutput;
            const disabled = !path;
            return (
              <button
                key={index}
                type="button"
                onClick={() => {
                  if (!disabled) setSelectedOutput(index);
                }}
                disabled={disabled}
                aria-pressed={isSelected}
                aria-label={
                  disabled ? `候选 ${label} · 等待生成` : `候选 ${label}`
                }
                title={disabled ? `候选 ${label} · 等待生成` : `候选 ${label}`}
                className={cn(
                  "relative h-12 w-12 shrink-0 overflow-hidden rounded-md border bg-raised transition-colors focus-visible:outline-none",
                  isSelected
                    ? "border-accent ring-2 ring-[color:var(--accent-faint)]"
                    : disabled
                      ? "cursor-default border-border-faint"
                      : "cursor-pointer border-border hover:border-border-strong",
                )}
              >
                {url ? (
                  <img
                    src={url}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div
                    aria-hidden="true"
                    className="h-full w-full animate-shimmer"
                    style={SHIMMER_STYLE}
                  />
                )}
                <span className="pointer-events-none absolute bottom-0 left-0 right-0 bg-[color:var(--n-900)]/70 px-1 py-0.5 text-center text-[9.5px] font-semibold text-foreground">
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
