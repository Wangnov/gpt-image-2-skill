import { t } from "@/lib/i18n";
import { type KeyboardEvent } from "react";
import { motion } from "motion/react";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/cn";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

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
  const reducedMotion = useReducedMotion();
  const roleLabel =
    role === "target"
      ? t("目标图")
      : role === "reference"
        ? t("参考图")
        : t("参考图");
  const ariaLabel = `${roleLabel}：${ref_.name}${ref_.hasMask ? t("，已绘制遮罩") : ""}`;

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
    <motion.div
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-pressed={Boolean(active)}
      onClick={onSelect}
      onKeyDown={handleKey}
      initial={reducedMotion ? false : { opacity: 0, scale: 0.96, y: 3 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      whileTap={reducedMotion ? undefined : { scale: 0.985 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
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
          {t("目标")}
        </div>
      )}
      {role === "reference" && (
        <div className="image-overlay-soft absolute top-1.5 right-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold">
          {t("参考")}
        </div>
      )}
      {ref_.hasMask && (
        <div
          className="absolute top-7 right-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1"
          style={{ background: "var(--accent)", color: "var(--accent-on)" }}
        >
          <Icon name="mask" size={10} aria-hidden="true" />
          {t("遮罩")}
        </div>
      )}
      {onSetTarget && role !== "target" && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSetTarget();
          }}
          aria-label={t("把「{p0}」设为目标图", { p0: ref_.name })}
          className="touch-target image-overlay absolute bottom-1.5 left-1.5 min-h-8 rounded border-none px-2 text-[11px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--accent)]"
        >
          {t("设为目标")}
        </button>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove?.();
        }}
        aria-label={t("删除「{p0}」", { p0: ref_.name })}
        className="touch-target image-overlay absolute bottom-1.5 right-1.5 flex h-8 w-8 items-center justify-center rounded border-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--accent)]"
      >
        <Icon name="x" size={12} aria-hidden="true" />
      </button>
    </motion.div>
  );
}
