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
    <label className={cn("inline-flex items-center gap-2 cursor-pointer", className)}>
      <span
        className={cn(
          "inline-flex w-[30px] h-[18px] rounded-full p-0.5 transition-colors",
          checked ? "bg-accent" : "bg-border-strong"
        )}
      >
        <span
          className="w-[14px] h-[14px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-transform"
          style={{ transform: checked ? "translateX(12px)" : "translateX(0)" }}
        />
      </span>
      {label && <span className="text-[13px]">{label}</span>}
      <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
