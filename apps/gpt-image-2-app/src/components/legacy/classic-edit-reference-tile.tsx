import { Icon } from "@/components/icon";
import { cn } from "@/lib/cn";
import type { RefWithFile } from "@/components/screens/edit/shared";

export function ClassicEditReferenceTile({
  ref_,
  active,
  role,
  hasMask,
  onSelect,
  onSetTarget,
  onRemove,
}: {
  ref_: RefWithFile;
  active: boolean;
  role?: "target" | "reference";
  hasMask?: boolean;
  onSelect: () => void;
  onSetTarget?: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
        if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          onRemove();
        }
      }}
      className={cn(
        "group relative aspect-square cursor-pointer overflow-hidden rounded-lg border-[1.5px] bg-sunken focus-visible:outline-none",
        active
          ? "border-accent shadow-[0_0_0_3px_var(--accent-faint)]"
          : "border-border hover:border-border-strong",
      )}
    >
      <img
        src={ref_.url}
        alt=""
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover"
        draggable={false}
      />
      <div
        className="image-overlay absolute left-1.5 top-1.5 max-w-[calc(100%-56px)] truncate rounded px-1.5 py-0.5 font-mono text-[10px]"
        title={ref_.name}
      >
        {ref_.name}
      </div>
      {role && (
        <span
          className={cn(
            "absolute right-1.5 top-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold",
            role === "target" ? "" : "image-overlay-soft",
          )}
          style={
            role === "target"
              ? { background: "var(--accent)", color: "var(--accent-on)" }
              : undefined
          }
        >
          {role === "target" ? "目标" : "参考"}
        </span>
      )}
      {hasMask && (
        <span
          className="absolute right-1.5 top-7 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold"
          style={{ background: "var(--accent)", color: "var(--accent-on)" }}
        >
          <Icon name="mask" size={10} />
          遮罩
        </span>
      )}
      {onSetTarget && role !== "target" && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onSetTarget();
          }}
          className="image-overlay absolute bottom-1.5 left-1.5 rounded px-2 py-1 text-[11px] font-semibold opacity-0 transition-opacity group-hover:opacity-100"
        >
          设为目标
        </button>
      )}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
        className="image-overlay absolute bottom-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100"
        aria-label={`删除 ${ref_.name}`}
      >
        <Icon name="x" size={12} />
      </button>
    </div>
  );
}
