import { Braces, CornerDownRight, Crop, Images, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Job } from "@/lib/types";
import { jobHasRegionEdit, jobKind } from "./shared";

/**
 * Icon-only affordance that tells text-to-image (`文生图`) apart from
 * image-to-image (`图生图`, optionally a local `局部编辑`) and raw requests.
 * Carries the human-readable kind in `title` + `aria-label` since the icon
 * itself is the only visible cue.
 */
export function JobKindIcon({
  job,
  size = 13,
  className,
}: {
  job: Job;
  size?: number;
  className?: string;
}) {
  const kind = jobKind(job);

  if (kind === "edit") {
    const region = jobHasRegionEdit(job);
    const label = region ? "图生图 · 局部编辑" : "图生图";
    const Icon = region ? Crop : Images;
    return (
      <span
        title={label}
        aria-label={label}
        className={cn(
          "inline-flex shrink-0 text-[color:var(--accent)]",
          className,
        )}
      >
        <Icon size={size} aria-hidden />
      </span>
    );
  }

  if (kind === "request") {
    return (
      <span
        title="原始请求"
        aria-label="原始请求"
        className={cn("inline-flex shrink-0 text-faint", className)}
      >
        <Braces size={size} aria-hidden />
      </span>
    );
  }

  return (
    <span
      title="文生图"
      aria-label="文生图"
      className={cn("inline-flex shrink-0 text-muted", className)}
    >
      <Sparkles size={size} aria-hidden />
    </span>
  );
}

/**
 * `⤷N` corner badge marking how many input reference images fed an edit job.
 * Renders nothing when there are none, so callers can drop it in
 * unconditionally. Positioned bottom-right of a `relative` thumbnail by
 * default; pass `className` to relocate.
 */
export function JobReferenceBadge({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "absolute right-1 bottom-1 inline-flex items-center gap-0.5 rounded-md px-1 py-px text-[9.5px] font-mono font-semibold leading-none text-foreground",
        className,
      )}
      style={{
        background: "var(--k-65)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        border: "1px solid var(--w-12)",
      }}
      aria-label={`${count} 张输入参考图`}
      title={`${count} 张参考图`}
    >
      <CornerDownRight size={9} aria-hidden />
      {count}
    </span>
  );
}
