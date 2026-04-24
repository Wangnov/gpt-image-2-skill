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
};

export function Segmented<T extends string>({ value, onChange, options, size = "md", className }: Props<T>) {
  const h = size === "sm" ? "h-[26px]" : "h-[30px]";
  return (
    <div
      className={cn(
        "inline-flex p-0.5 bg-sunken border border-border rounded-md gap-px",
        className
      )}
    >
      {options.map((o) => {
        const v = typeof o === "string" ? o : o.value;
        const label = typeof o === "string" ? o : o.label;
        const icon = typeof o === "string" ? undefined : o.icon;
        const sel = v === value;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 rounded text-[12.5px] font-medium transition-colors cursor-pointer",
              h,
              sel ? "bg-raised text-foreground shadow-sm" : "bg-transparent text-muted"
            )}
          >
            {icon && <Icon name={icon} size={13} />}
            {label}
          </button>
        );
      })}
    </div>
  );
}
