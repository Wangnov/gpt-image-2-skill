import { type KeyboardEvent } from "react";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/cn";

export type RefImage = {
  id: string;
  name: string;
  url: string;
  hasMask?: boolean;
};

export function ReferenceImageCard({
  ref_,
  active,
  role,
  onSelect,
  onSetTarget,
  onRemove,
}: {
  ref_: RefImage;
  active?: boolean;
  role?: "target" | "reference";
  onSelect?: () => void;
  onSetTarget?: () => void;
  onRemove?: () => void;
}) {
  const roleLabel =
    role === "target" ? "目标图" : role === "reference" ? "参考图" : "参考图";
  const ariaLabel = `${roleLabel}：${ref_.name}${ref_.hasMask ? "，已绘制遮罩" : ""}`;

  const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect?.();
    } else if (
      (event.key === "Delete" || event.key === "Backspace") &&
      onRemove
    ) {
      event.preventDefault();
      onRemove();
    } else if (event.key === "t" && onSetTarget && role !== "target") {
      event.preventDefault();
      onSetTarget();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-pressed={Boolean(active)}
      onClick={onSelect}
      onKeyDown={handleKey}
      className={cn(
        "relative aspect-square rounded-lg overflow-hidden cursor-pointer transition-all bg-sunken",
        "border-[1.5px]",
        "focus-visible:outline-none focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_var(--accent-faint)]",
        active
          ? "border-accent shadow-[0_0_0_3px_var(--accent-faint)]"
          : "border-border",
      )}
    >
      <img
        src={ref_.url}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        className="w-full h-full object-cover"
      />
      <div
        className="image-overlay absolute top-1.5 left-1.5 max-w-[calc(100%-64px)] truncate rounded px-1.5 py-0.5 t-mono text-[10px]"
        title={ref_.name}
      >
        {ref_.name}
      </div>
      {role === "target" && (
        <div
          className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold"
          style={{ background: "var(--accent)", color: "var(--accent-on)" }}
        >
          目标
        </div>
      )}
      {role === "reference" && (
        <div className="image-overlay-soft absolute top-1.5 right-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold">
          参考
        </div>
      )}
      {ref_.hasMask && (
        <div
          className="absolute top-7 right-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1"
          style={{ background: "var(--accent)", color: "var(--accent-on)" }}
        >
          <Icon name="mask" size={10} aria-hidden="true" />
          遮罩
        </div>
      )}
      {onSetTarget && role !== "target" && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSetTarget();
          }}
          aria-label={`把「${ref_.name}」设为目标图`}
          className="touch-target image-overlay absolute bottom-1.5 left-1.5 min-h-8 rounded border-none px-2 text-[11px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--accent)]"
        >
          设为目标
        </button>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove?.();
        }}
        aria-label={`删除「${ref_.name}」`}
        className="touch-target image-overlay absolute bottom-1.5 right-1.5 flex h-8 w-8 items-center justify-center rounded border-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--accent)]"
      >
        <Icon name="x" size={12} aria-hidden="true" />
      </button>
    </div>
  );
}
