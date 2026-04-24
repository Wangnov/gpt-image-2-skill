import { Input } from "@/components/ui/input";
import {
  OUTPUT_COUNT_OPTIONS,
  POPULAR_SIZE_OPTIONS,
  validateImageSize,
  validateOutputCount,
} from "@/lib/image-options";

export function ImageSizeInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const validation = validateImageSize(value);
  return (
    <div className="space-y-2">
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="auto 或 1536x1024"
        monospace
      />
      <div className="flex flex-wrap gap-1">
        {POPULAR_SIZE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={[
              "touch-target min-h-8 rounded border px-2 text-[10.5px] transition-colors",
              value.trim().toLowerCase() === option.value
                ? "border-accent bg-[color:var(--accent-faint)] text-foreground"
                : "border-border bg-sunken text-muted hover:text-foreground",
            ].join(" ")}
          >
            {option.label}
          </button>
        ))}
      </div>
      {!validation.ok && (
        <div className="rounded-md border border-border bg-sunken px-2 py-1 text-[11px] leading-relaxed text-muted">
          {validation.message}
        </div>
      )}
    </div>
  );
}

export function OutputCountInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const validation = validateOutputCount(value);
  return (
    <div className="space-y-2">
      <Input
        type="number"
        min={1}
        max={10}
        step={1}
        value={Number.isFinite(value) ? String(value) : ""}
        onChange={(event) =>
          onChange(event.target.value === "" ? 0 : Number(event.target.value))
        }
        monospace
        suffix={<span className="text-[11px] text-faint">张</span>}
      />
      <div className="flex flex-wrap gap-1">
        {OUTPUT_COUNT_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={[
              "touch-target min-h-8 min-w-8 rounded border px-2 text-[10.5px] font-medium transition-colors",
              value === option
                ? "border-accent bg-[color:var(--accent-faint)] text-foreground"
                : "border-border bg-sunken text-muted hover:text-foreground",
            ].join(" ")}
          >
            {option}
          </button>
        ))}
      </div>
      {!validation.ok && (
        <div className="rounded-md border border-border bg-sunken px-2 py-1 text-[11px] leading-relaxed text-muted">
          {validation.message}
        </div>
      )}
    </div>
  );
}
