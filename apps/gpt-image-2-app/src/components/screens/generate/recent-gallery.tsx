import { motion } from "motion/react";
import Masonry, {
  type MasonryItem,
} from "@/components/reactbits/components/Masonry";
import { cn } from "@/lib/cn";
import { sendImageToEdit } from "@/lib/job-navigation";
import { PendingWorkTile, RecentWorkTile } from "./gallery-tile";
import type { GalleryTile } from "./shared";

export function RecentGallery({
  reducedMotion,
  hasSplit,
  recentCount,
  pendingCount,
  onOpenHistory,
  onOpenJob,
  onOpenEdit,
  galleryItems,
}: {
  reducedMotion: boolean;
  hasSplit: boolean;
  recentCount: number;
  pendingCount: number;
  onOpenHistory?: () => void;
  onOpenJob?: (jobId: string) => void;
  onOpenEdit?: () => void;
  galleryItems: MasonryItem<GalleryTile>[];
}) {
  if (recentCount === 0 && pendingCount === 0) return null;

  return (
    <motion.section
      initial={reducedMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: reducedMotion ? 0 : 0.46,
        delay: reducedMotion ? 0 : 0.14,
        ease: [0.22, 1, 0.36, 1],
      }}
      aria-label="最近的作品"
      className={cn(
        "mt-6 w-full max-w-[640px]",
        // Split mode: right column, top-aligned with the form,
        // wider visual since the column is the larger of the two.
        hasSplit &&
          "xl:col-start-2 xl:row-start-2 xl:mt-0 xl:max-w-none xl:self-start",
      )}
    >
      <div className="flex items-center justify-between mb-2 px-1">
        <span className="t-caps">最近的作品</span>
        {onOpenHistory && (
          <button
            type="button"
            onClick={() => onOpenHistory()}
            className="text-[11px] text-muted hover:text-foreground transition-colors"
          >
            查看全部 ›
          </button>
        )}
      </div>
      <Masonry
        items={galleryItems}
        gap={10}
        minColumnWidth={126}
        maxColumns={4}
        animateFrom="bottom"
        className="min-h-[260px]"
        renderItem={({ data }) =>
          data.kind === "pending" ? (
            <PendingWorkTile seed={data.seed} slotIndex={data.slotIndex} />
          ) : (
            <RecentWorkTile
              job={data.job}
              outputIndex={data.outputIndex}
              path={data.path}
              url={data.url}
              promptText={data.promptText}
              onOpenJob={onOpenJob}
              onSendToEdit={() => {
                sendImageToEdit({
                  jobId: data.job.id,
                  outputIndex: data.outputIndex,
                  path: data.path,
                  url: data.url,
                });
                onOpenEdit?.();
              }}
            />
          )
        }
      />
    </motion.section>
  );
}
