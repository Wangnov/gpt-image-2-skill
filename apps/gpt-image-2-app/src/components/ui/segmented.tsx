import { useId, useRef, type KeyboardEvent } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/components/icon";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

export type SegmentedOption<T extends string> =
  | T
  | { value: T; label: string; icon?: IconName };

type Props<T extends string> = {
  value: T;
  onChange: (v: T) => void;
  options: readonly SegmentedOption<T>[];
  size?: "sm" | "md";
  className?: string;
  /**
   * Accessible label describing what the group controls. Rendered as
   * aria-label on the radiogroup.
   */
  ariaLabel?: string;
};

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "md",
  className,
  ariaLabel,
}: Props<T>) {
  const h = size === "sm" ? "h-7" : "h-8";
  const groupId = useId();
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const reducedMotion = useReducedMotion();
  // Unique layoutId per Segmented instance so multiple groups on the
  // same screen (e.g. mode switch + filter pills) don't share their
  // sliding pill with each other.
  const pillLayoutId = `segmented-pill-${groupId}`;

  const move = (from: number, delta: number) => {
    const len = options.length;
    if (len === 0) return;
    const next = (from + delta + len) % len;
    const opt = options[next];
    const nextValue = typeof opt === "string" ? opt : opt.value;
    onChange(nextValue);
    btnRefs.current[next]?.focus();
  };

  const onKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        move(index, +1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        move(index, -1);
        break;
      case "Home":
        event.preventDefault();
        move(-1, +1);
        break;
      case "End":
        event.preventDefault();
        move(0, -1);
        break;
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      id={groupId}
      className={cn(
        "inline-flex shrink-0 p-0.5 rounded-md gap-px",
        "bg-[color:var(--k-30)] border border-border",
        className,
      )}
    >
      {options.map((o, index) => {
        const v = typeof o === "string" ? o : o.value;
        const label = typeof o === "string" ? o : o.label;
        const icon = typeof o === "string" ? undefined : o.icon;
        const selected = v === value;
        return (
          <button
            key={v}
            ref={(el) => {
              btnRefs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(v)}
            onKeyDown={(e) => onKey(e, index)}
            className={cn(
              "relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 rounded text-[12.5px] font-medium transition-colors cursor-pointer",
              h,
              selected
                ? "text-foreground"
                : "text-muted hover:text-foreground hover:bg-[color:var(--w-04)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-55)]",
            )}
          >
            {/* Shared sliding pill — same trick the top-nav uses; the
                highlight slides between segments rather than cutting. */}
            {selected && (
              <motion.span
                layoutId={pillLayoutId}
                aria-hidden="true"
                className="absolute inset-0 z-0 rounded"
                style={{
                  background: "var(--w-10)",
                  boxShadow: "inset 0 1px 0 var(--w-10)",
                }}
                transition={{
                  duration: reducedMotion ? 0 : 0.22,
                  ease: [0.22, 1, 0.36, 1],
                }}
              />
            )}
            {icon && <Icon name={icon} size={13} aria-hidden="true" className="relative z-10" />}
            <span className="relative z-10">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
