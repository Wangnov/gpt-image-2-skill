import { cn } from "@/lib/cn";

export function Toggle({
  checked,
  onChange,
  label,
  className,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "inline-flex items-center gap-2 cursor-pointer",
        disabled && "cursor-not-allowed opacity-60",
        className,
      )}
    >
      <span
        className={cn(
          "relative inline-flex w-[32px] h-[18px] rounded-full p-0.5",
          "motion-safe:transition-[background-color,box-shadow,background-image] motion-safe:duration-200 motion-safe:ease-out-quint",
          checked
            ? "shadow-[var(--shadow-accent-glow-soft),inset_0_1px_0_var(--w-18)]"
            : "bg-[color:var(--w-10)] shadow-[inset_0_1px_2px_var(--k-40)]",
        )}
        style={
          checked
            ? {
                backgroundImage: "var(--accent-gradient-fill)",
              }
            : undefined
        }
      >
        <span
          className="w-[14px] h-[14px] rounded-full bg-[color:var(--surface-inverted)] shadow-[0_1px_3px_var(--k-40)] motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-spring-soft"
          style={{ transform: checked ? "translateX(14px)" : "translateX(0)" }}
        />
      </span>
      {label && <span className="text-[13px]">{label}</span>}
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
