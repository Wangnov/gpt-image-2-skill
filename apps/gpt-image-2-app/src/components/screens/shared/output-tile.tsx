import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
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
}: {
  output: OutputMeta;
  onSelect?: () => void;
  onDownload?: () => void;
  onOpen?: () => void;
}) {
  const [hover, setHover] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const letter = String.fromCharCode(97 + output.index);
  const showImage = output.url && !imageFailed;

  useEffect(() => {
    setImageFailed(false);
  }, [output.url]);

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocusCapture={() => setFocusWithin(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocusWithin(false);
        }
      }}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      aria-label={`候选 ${letter.toUpperCase()}${output.selected ? "，已选中" : ""}`}
      aria-pressed={Boolean(output.selected)}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && onSelect) {
          e.preventDefault();
          onSelect();
        }
      }}
      className={[
        "relative overflow-hidden aspect-square rounded-lg cursor-pointer transition-all",
        "border-[1.5px]",
        output.selected
          ? "border-accent shadow-[0_0_0_3px_var(--accent-faint)]"
          : "border-border shadow-sm",
      ].join(" ")}
      style={{ background: "var(--bg-sunken)" }}
    >
      {showImage ? (
        <img
          src={output.url}
          alt={`候选 ${letter.toUpperCase()}`}
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover"
          onError={() => setImageFailed(true)}
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
          <span className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-[3px] bg-white/20 font-mono text-[10px] font-bold uppercase">
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
      {(hover || focusWithin || output.selected) && (
        <div className="absolute top-2 right-2 flex gap-1 animate-fade-in">
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
          {onDownload && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDownload();
              }}
              title="保存图片"
              aria-label="保存图片"
              className="touch-target image-overlay flex h-8 w-8 items-center justify-center rounded-[4px] border-none"
            >
              <Icon name="download" size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
