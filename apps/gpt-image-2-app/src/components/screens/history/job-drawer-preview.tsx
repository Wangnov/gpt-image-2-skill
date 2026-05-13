import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icon";
import { PlaceholderImage } from "@/components/screens/shared/placeholder-image";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { jobOutputIndexes } from "@/lib/job-outputs";
import type { Job } from "@/lib/types";
import { SHIMMER_STYLE } from "./job-drawer-utils";
import { JobPreviewImage } from "./job-preview-image";
import { jobOutputErrors, outputLabel } from "./shared";

function cacheBustedUrl(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}rehydrated=${Date.now()}`;
}

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
  const [rehydratedUrl, setRehydratedUrl] = useState("");
  const [rehydrateAttempted, setRehydrateAttempted] = useState<Set<number>>(
    new Set(),
  );
  const displayUrl = rehydratedUrl || previewUrl;
  const terminal = ["completed", "partial_failed", "failed", "cancelled"].includes(
    job.status,
  );
  const outputErrors = useMemo(() => jobOutputErrors(job), [job]);
  const errorsByIndex = useMemo(
    () => new Map(outputErrors.map((error) => [error.index, error])),
    [outputErrors],
  );
  const slots = useMemo(() => {
    const indexes = new Set<number>();
    for (let index = 0; index < planned; index += 1) indexes.add(index);
    for (const index of jobOutputIndexes(job)) indexes.add(index);
    for (const error of outputErrors) indexes.add(error.index);
    return Array.from(indexes).sort((a, b) => a - b);
  }, [job, outputErrors, planned]);
  const selectedError = errorsByIndex.get(selectedOutput);
  const selectedMissing = terminal && !displayUrl && !selectedError;

  useEffect(() => {
    setRehydratedUrl("");
    setImageFailed(false);
  }, [previewUrl, selectedOutput, setImageFailed]);

  useEffect(() => {
    setRehydrateAttempted(new Set());
  }, [job.id]);

  const recoverOutputUrl = async (outputIndex: number) => {
    const cachedPath = await api.ensureJobOutputCached(job.id, outputIndex);
    if (!cachedPath) return null;
    return api.fileUrl(cachedPath) || null;
  };

  const recoverVisibleOutput = () => {
    if (rehydrateAttempted.has(selectedOutput)) {
      setImageFailed(true);
      return;
    }
    setRehydrateAttempted((prev) => new Set(prev).add(selectedOutput));
    void recoverOutputUrl(selectedOutput)
      .then((cachedUrl) => {
        if (!cachedUrl) return setImageFailed(true);
        setRehydratedUrl(cacheBustedUrl(cachedUrl));
        setImageFailed(false);
      })
      .catch(() => setImageFailed(true));
  };

  return (
    <>
      <div className="aspect-square rounded-[10px] overflow-hidden border border-border mb-3 bg-sunken">
        {displayUrl && !imageFailed ? (
          <img
            src={displayUrl}
            alt={`生成图片预览 · 候选 ${selectedLabel}`}
            decoding="async"
            className="w-full h-full object-cover"
            onError={recoverVisibleOutput}
          />
        ) : selectedError ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[color:var(--status-err-08)] px-5 text-center">
            <Icon
              name="warn"
              size={24}
              aria-hidden="true"
              style={{ color: "var(--status-err)" }}
            />
            <div className="text-[12.5px] font-semibold text-status-err">
              候选 {selectedLabel} 失败
            </div>
            <div className="line-clamp-5 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-muted">
              {selectedError.message}
            </div>
          </div>
        ) : selectedMissing ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-sunken px-5 text-center text-faint">
            <Icon name="circle" size={24} aria-hidden="true" />
            <div className="text-[12.5px] font-semibold">
              候选 {selectedLabel} 未生成
            </div>
          </div>
        ) : doneCount >= 1 || job.status === "completed" ? (
          <PlaceholderImage
            seed={seed + selectedOutput}
            label={displayUrl && imageFailed ? "远端不可用" : undefined}
          />
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
          {slots.map((index) => {
            const path = api.jobOutputPath(job, index);
            const url = path ? api.fileUrl(path) : "";
            const slotError = errorsByIndex.get(index);
            const missing = terminal && !url && !slotError;
            const label = outputLabel(index);
            const isSelected = index === selectedOutput;
            const selectable = Boolean(path || slotError || missing);
            return (
              <button
                key={index}
                type="button"
                onClick={() => {
                  if (selectable) setSelectedOutput(index);
                }}
                disabled={!selectable}
                aria-pressed={isSelected}
                aria-label={
                  slotError
                    ? `候选 ${label} · 失败`
                    : missing
                      ? `候选 ${label} · 未生成`
                    : selectable
                      ? `候选 ${label}`
                      : `候选 ${label} · 等待生成`
                }
                title={
                  slotError
                    ? `候选 ${label} · 失败`
                    : missing
                      ? `候选 ${label} · 未生成`
                    : selectable
                      ? `候选 ${label}`
                      : `候选 ${label} · 等待生成`
                }
                className={cn(
                  "relative h-12 w-12 shrink-0 overflow-hidden rounded-md border bg-raised transition-colors focus-visible:outline-none",
                  isSelected
                    ? "border-accent ring-2 ring-[color:var(--accent-faint)]"
                    : slotError
                      ? "cursor-pointer border-[color:var(--status-err-25)] hover:border-[color:var(--status-err)]"
                      : missing
                        ? "cursor-pointer border-border-faint text-faint hover:border-border"
                      : !selectable
                        ? "cursor-default border-border-faint"
                        : "cursor-pointer border-border hover:border-border-strong",
                )}
              >
                {url ? (
                  <JobPreviewImage
                    url={url}
                    seed={seed + index}
                    variant="compact"
                    recover={() => recoverOutputUrl(index)}
                  />
                ) : slotError ? (
                  <div className="flex h-full w-full items-center justify-center bg-[color:var(--status-err-08)] text-status-err">
                    <Icon name="warn" size={15} aria-hidden="true" />
                  </div>
                ) : missing ? (
                  <div className="flex h-full w-full items-center justify-center bg-sunken text-faint">
                    <Icon name="circle" size={14} aria-hidden="true" />
                  </div>
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
