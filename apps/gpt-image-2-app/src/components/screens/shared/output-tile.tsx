import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Icon } from "@/components/icon";
import { RevealImage } from "@/components/ui/reveal-image";
import { ImageContextMenu } from "@/components/ui/image-context-menu";
import { ImageHoverToolbar } from "@/components/ui/image-hover-toolbar";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { imageDragProps } from "@/lib/image-actions/drag-out";
import {
  clearFocusedImageIfMatches,
  setFocusedImage,
} from "@/lib/image-actions/focused-image";
import type { ImageAsset } from "@/lib/image-actions/types";
import { PlaceholderImage } from "./placeholder-image";

type OutputMeta = {
  index: number;
  url?: string;
  selected?: boolean;
  seed?: number;
};

export function OutputTile({
  output,
  onSelect,
  onDownload,
  onOpen,
  onSendToEdit,
  downloadLabel = "保存图片",
  asset,
}: {
  output: OutputMeta;
  onSelect?: () => void;
  onDownload?: () => void;
  onOpen?: () => void;
  onSendToEdit?: () => void;
  downloadLabel?: string;
  /**
   * When provided, the tile is wrapped in an `ImageContextMenu` so right-click
   * surfaces the runtime-aware action set. The legacy/classic shells leave
   * this undefined and keep the existing hover-only behavior.
   */
  asset?: ImageAsset;
}) {
  const reducedMotion = useReducedMotion();
  const [hover, setHover] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const letter = String.fromCharCode(97 + output.index);
  const showImage = output.url && !imageFailed;

  useEffect(() => {
    setImageFailed(false);
  }, [output.url]);

  const dragProps = asset ? imageDragProps(asset) : { draggable: false };
  const tile = (
    <motion.div
      onMouseEnter={() => {
        setHover(true);
        if (asset) setFocusedImage(asset);
      }}
      onMouseLeave={() => {
        setHover(false);
        // Clear the global focused-image when the pointer leaves so global
        // shortcuts (Space / ⌘C / ⌘⌫) don't keep targeting a stale tile.
        // `output.selected` opts in to "sticky" focus — selected tiles
        // remain the keyboard target after the pointer wanders off.
        if (asset && !output.selected) {
          clearFocusedImageIfMatches(asset.jobId, asset.outputIndex);
        }
      }}
      onFocusCapture={() => {
        setFocusWithin(true);
        if (asset) setFocusedImage(asset);
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocusWithin(false);
          if (asset && !output.selected) {
            clearFocusedImageIfMatches(asset.jobId, asset.outputIndex);
          }
        }
      }}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      aria-label={`候选 ${letter.toUpperCase()}${output.selected ? "，已选中" : ""}`}
      aria-pressed={Boolean(output.selected)}
      animate={
        reducedMotion
          ? undefined
          : {
              scale: output.selected ? 1.012 : 1,
            }
      }
      whileTap={reducedMotion ? undefined : { scale: 0.985 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && onSelect) {
          e.preventDefault();
          onSelect();
        }
      }}
      className={[
        "relative overflow-hidden aspect-square rounded-lg cursor-pointer",
        "border-[1.5px]",
        // border + shadow follow the same project quint as the scale motion
        // above; previously plain `transition-all` snapped them in 150ms
        // while the tile scaled over 180ms — visible misalignment on select.
        "motion-safe:transition-[border-color,box-shadow] motion-safe:duration-200 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]",
        output.selected
          ? "border-accent shadow-[0_0_0_3px_var(--accent-faint)]"
          : "border-border shadow-sm",
      ].join(" ")}
      style={{ background: "var(--bg-sunken)" }}
    >
      <AnimatePresence>
        {output.selected && !reducedMotion && (
          <motion.span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-10 rounded-[inherit]"
            initial={{ opacity: 0.7, scale: 0.96 }}
            animate={{ opacity: 0, scale: 1.08 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
            style={{
              background:
                "radial-gradient(circle at center, var(--accent-35), transparent 68%)",
            }}
          />
        )}
      </AnimatePresence>
      {showImage ? (
        <RevealImage
          src={output.url}
          alt={`候选 ${letter.toUpperCase()}`}
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover"
          onError={() => setImageFailed(true)}
          {...dragProps}
        />
      ) : (
        <PlaceholderImage
          seed={output.seed ?? output.index * 11 + 7}
          variant={letter}
        />
      )}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          padding: "20px 10px 8px",
          background:
            "linear-gradient(to top, var(--image-overlay), transparent)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          color: "var(--image-overlay-text)",
        }}
      >
        <div className="flex items-center gap-1.5">
          <span className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-[3px] bg-[color:var(--w-20)] font-mono text-[10px] font-bold uppercase">
            {letter}
          </span>
          {output.seed != null && (
            <span className="text-[10.5px] font-mono opacity-85">
              seed {output.seed}
            </span>
          )}
        </div>
        {output.selected && <Icon name="check" size={12} />}
      </div>
      {asset ? (
        <ImageHoverToolbar
          asset={asset}
          visible={hover || focusWithin || Boolean(output.selected)}
        />
      ) : (
        <AnimatePresence>
          {(hover || focusWithin || output.selected) && (
            <motion.div
              className="absolute top-2 right-2 z-20 flex gap-1"
              initial={
                reducedMotion ? false : { opacity: 0, y: -3, scale: 0.98 }
              }
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={
                reducedMotion
                  ? { opacity: 0 }
                  : { opacity: 0, y: -2, scale: 0.98 }
              }
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            >
              {onOpen && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen();
                  }}
                  title="打开图片"
                  aria-label="打开图片"
                  className="touch-target image-overlay flex h-8 w-8 items-center justify-center rounded-[4px] border-none"
                >
                  <Icon name="external" size={13} />
                </button>
              )}
              {onSendToEdit && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSendToEdit();
                  }}
                  title="发送到编辑"
                  aria-label="发送到编辑"
                  className="touch-target image-overlay flex h-8 w-8 items-center justify-center rounded-[4px] border-none"
                >
                  <Icon name="edit" size={13} />
                </button>
              )}
              {onDownload && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDownload();
                  }}
                  title={downloadLabel}
                  aria-label={downloadLabel}
                  className="touch-target image-overlay flex h-8 w-8 items-center justify-center rounded-[4px] border-none"
                >
                  <Icon name="download" size={13} />
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </motion.div>
  );

  if (asset) {
    return <ImageContextMenu asset={asset}>{tile}</ImageContextMenu>;
  }
  return tile;
}
