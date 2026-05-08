import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Loader2 } from "lucide-react";
import { Icon } from "@/components/icon";
import { PlaceholderImage } from "@/components/screens/shared/placeholder-image";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import type { Job } from "@/lib/types";
import { jobPlaceholderSeed } from "./shared";

export function RecentWorkTile({
  job,
  outputIndex,
  path,
  url,
  promptText,
  onOpenJob,
  onSendToEdit,
}: {
  job: Job;
  outputIndex: number;
  path: string | null;
  url: string | null;
  promptText: string;
  onOpenJob?: (jobId: string) => void;
  onSendToEdit?: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const [hover, setHover] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const canSendToEdit = Boolean(onSendToEdit && (path || url));

  useEffect(() => {
    setImageFailed(false);
  }, [url]);

  return (
    <motion.div
      key={job.id}
      role="button"
      tabIndex={0}
      onClick={() => onOpenJob?.(job.id)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocusCapture={() => setFocusWithin(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocusWithin(false);
        }
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onOpenJob?.(job.id);
      }}
      whileTap={reducedMotion ? undefined : { scale: 0.985 }}
      transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
      className="relative h-full w-full cursor-pointer rounded-md overflow-hidden ring-1 ring-[color:var(--w-10)] hover:ring-[color:var(--accent-45)] hover:scale-[1.025] transition-[box-shadow,transform] bg-[color:var(--bg-sunken)] focus-visible:outline-none focus-visible:ring-[color:var(--accent-55)]"
      title={promptText.slice(0, 80)}
      aria-label={`打开作品 ${outputIndex + 1}:${promptText.slice(0, 40)}`}
    >
      {url && !imageFailed ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          draggable={false}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <PlaceholderImage seed={jobPlaceholderSeed(job)} variant="recent" />
      )}
      {canSendToEdit && (hover || focusWithin) && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onSendToEdit?.();
          }}
          className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-[5px] border border-[color:var(--surface-floating-border)] bg-[color:var(--surface-floating)] text-foreground shadow-[var(--shadow-floating)] backdrop-blur transition-colors hover:bg-[color:var(--surface-floating-strong)]"
          title="发送到编辑"
          aria-label="发送到编辑"
        >
          <Icon name="edit" size={13} />
        </button>
      )}
    </motion.div>
  );
}

export function PendingWorkTile({
  seed,
  slotIndex,
}: {
  seed: number;
  slotIndex: number;
}) {
  return (
    <div
      className="relative h-full w-full overflow-hidden rounded-md border border-[color:var(--w-12)] bg-[color:var(--bg-sunken)] shadow-sm"
      aria-label="生成中"
    >
      <PlaceholderImage
        seed={seed}
        variant={`pending-${slotIndex}`}
        style={{ opacity: 0.72 }}
      />
      <div
        className="absolute inset-0 animate-shimmer"
        style={{
          background: "var(--skeleton-gradient-soft)",
          backgroundSize: "200% 100%",
          opacity: 0.55,
          mixBlendMode: "screen",
        }}
      />
      <div className="absolute inset-0 bg-[color:var(--k-18)]" />
      <div className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full border border-[color:var(--w-12)] bg-[color:var(--k-35)] px-2 py-1 text-[10px] font-medium text-[color:var(--image-overlay-text)] backdrop-blur-md">
        <Loader2
          size={11}
          className="animate-spin text-[color:var(--accent)]"
        />
        生成中
      </div>
    </div>
  );
}
