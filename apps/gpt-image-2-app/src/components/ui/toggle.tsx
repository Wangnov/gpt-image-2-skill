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
          "relative inline-flex w-[32px] h-[18px] rounded-full p-0.5 transition-all",
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
          className="w-[14px] h-[14px] rounded-full bg-[color:var(--surface-inverted)] shadow-[0_1px_3px_var(--k-40)] transition-transform"
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
