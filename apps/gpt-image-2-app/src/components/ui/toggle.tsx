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
            ? "shadow-[0_0_12px_rgba(167,139,250,0.45),inset_0_1px_0_rgba(255,255,255,0.18)]"
            : "bg-[rgba(255,255,255,0.10)] shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]",
        )}
        style={
          checked
            ? {
                backgroundImage:
                  "linear-gradient(135deg, rgba(167,139,250,0.95) 0%, rgba(103,232,249,0.92) 100%)",
              }
            : undefined
        }
      >
        <span
          className="w-[14px] h-[14px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.4)] transition-transform"
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
