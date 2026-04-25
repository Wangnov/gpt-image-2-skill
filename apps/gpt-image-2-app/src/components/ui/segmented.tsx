import { useId, useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/components/icon";

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
        "bg-[rgba(0,0,0,0.30)] border border-border",
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
              "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 rounded text-[12.5px] font-medium transition-all cursor-pointer",
              h,
              selected
                ? "bg-[rgba(255,255,255,0.10)] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.10)]"
                : "bg-transparent text-muted hover:text-foreground hover:bg-[rgba(255,255,255,0.04)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(167,139,250,0.55)]",
            )}
          >
            {icon && <Icon name={icon} size={13} aria-hidden="true" />}
            {label}
          </button>
        );
      })}
    </div>
  );
}
