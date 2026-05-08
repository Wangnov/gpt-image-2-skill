import { useMemo } from "react";
import type { MasonryItem } from "@/components/reactbits/components/Masonry";
import { useJobs } from "@/hooks/use-jobs";
import { isActiveJobStatus } from "@/lib/api/types";
import {
  jobOutputIndexes,
  jobOutputPath,
  jobOutputUrl,
} from "@/lib/job-outputs";
import {
  heightRatioFromSize,
  jobPlaceholderSeed,
  type GalleryTile,
} from "./shared";

const GALLERY_MAX = 12;

export function useGenerateGallery() {
  const { data: jobs = [] } = useJobs();
  const queueCount = jobs.filter((job) =>
    isActiveJobStatus(job.status),
  ).length;

  const pendingPlaceholders = useMemo(() => {
    return jobs
      .filter((job) => isActiveJobStatus(job.status))
      .flatMap((job) => {
        const meta = (job.metadata ?? {}) as Record<string, unknown>;
        const n = typeof meta.n === "number" && meta.n > 0 ? meta.n : 1;
        return Array.from({ length: n }, (_, index) => ({
          jobId: job.id,
          slotIndex: index,
          seed: jobPlaceholderSeed(job) + index * 13,
          heightRatio: heightRatioFromSize(meta.size),
        }));
      });
  }, [jobs]);

  const recentCompleted = useMemo(() => {
    return jobs
      .filter(
        (job) =>
          job.status === "completed" &&
          ((job.outputs?.length ?? 0) > 0 || Boolean(job.output_path)),
      )
      .slice(0, Math.max(0, GALLERY_MAX - pendingPlaceholders.length));
  }, [jobs, pendingPlaceholders.length]);

  const galleryItems = useMemo<MasonryItem<GalleryTile>[]>(() => {
    const pendingItems: MasonryItem<GalleryTile>[] = pendingPlaceholders.map(
      (placeholder) => ({
        id: `pending-${placeholder.jobId}-${placeholder.slotIndex}`,
        heightRatio: placeholder.heightRatio,
        data: {
          kind: "pending",
          jobId: placeholder.jobId,
          slotIndex: placeholder.slotIndex,
          seed: placeholder.seed,
        },
      }),
    );
    const completedItems: MasonryItem<GalleryTile>[] = recentCompleted.map(
      (job) => {
        const outputIndex = jobOutputIndexes(job)[0] ?? 0;
        let url: string | null = null;
        let path: string | null = null;
        try {
          url = jobOutputUrl(job, outputIndex);
          path = jobOutputPath(job, outputIndex);
        } catch {
          url = null;
          path = null;
        }
        const meta = (job.metadata ?? {}) as Record<string, unknown>;
        const promptText = (meta.prompt as string | undefined) ?? "";
        return {
          id: `completed-${job.id}`,
          heightRatio: heightRatioFromSize(meta.size),
          data: {
            kind: "completed",
            job,
            outputIndex,
            path,
            url,
            promptText,
          },
        };
      },
    );

    return [...pendingItems, ...completedItems];
  }, [pendingPlaceholders, recentCompleted]);

  const pendingCount = pendingPlaceholders.length;
  const recentCount = recentCompleted.length;

  return {
    galleryItems,
    hasSplit: recentCount > 0 || pendingCount > 0,
    pendingCount,
    queueCount,
    recentCount,
  };
}
