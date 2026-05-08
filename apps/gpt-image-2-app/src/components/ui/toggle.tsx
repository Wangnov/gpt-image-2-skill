import { cn } from "@/lib/cn";

export function Toggle({
  checked,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  className?: string;
}) {
  return (
    <label
      className={cn("inline-flex items-center gap-2 cursor-pointer", className)}
    >
      <span
        className={cn(
          "relative inline-flex w-[32px] h-[18px] rounded-full p-0.5",
          "motion-safe:transition-[background-color,box-shadow,background-image] motion-safe:duration-200 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]",
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
          className="w-[14px] h-[14px] rounded-full bg-[color:var(--surface-inverted)] shadow-[0_1px_3px_var(--k-40)] motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-[cubic-bezier(0.34,1.56,0.64,1)]"
          style={{ transform: checked ? "translateX(14px)" : "translateX(0)" }}
        />
      </span>
      {label && <span className="text-[13px]">{label}</span>}
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
