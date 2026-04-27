import { useRef, useState, type InputHTMLAttributes } from "react";
import * as RadixPopover from "@radix-ui/react-popover";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * GlassCombobox — input field + popover preset list. Accepts the user's
 * free-typed value while still offering a curated dropdown of presets.
 *
 * variant="default"   tall input-style trigger
 * variant="chip"      compact pill trigger with optional caps label
 *
 * Use this anywhere a value is "an enum, except sometimes the user has a
 * weird custom one" — sizes (with custom WxH), output counts (3, 5, 7…),
 * etc.
 */

export interface ComboboxOption {
  value: string;
  label: string;
  description?: string;
}

type Size = "sm" | "md" | "lg";

interface BaseProps {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly ComboboxOption[];
  placeholder?: string;
  size?: Size;
  ariaLabel?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
  /** Hint inputmode for soft keyboards */
  inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
  /** Show small invalid state on the trigger */
  invalid?: boolean;
  /** Optional minimum trigger width (e.g. "120px") */
  minWidth?: string;
}

interface DefaultVariantProps extends BaseProps {
  variant?: "default";
}

interface ChipVariantProps extends BaseProps {
  variant: "chip";
  /** Small uppercase caps label shown to the left of the value */
  label?: string;
}

export type GlassComboboxProps = DefaultVariantProps | ChipVariantProps;

const triggerHeights: Record<Size, string> = {
  sm: "h-7",
  md: "h-9",
  lg: "h-10",
};

export function GlassCombobox(props: GlassComboboxProps) {
  const {
    value,
    onValueChange,
    options,
    size = "md",
    ariaLabel,
    placeholder,
    className,
    disabled,
    id,
    inputMode,
    invalid,
    minWidth,
  } = props;
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const isChip = props.variant === "chip";
  const chipLabel = isChip ? (props as ChipVariantProps).label : undefined;
  const trimmed = value.trim().toLowerCase();
  const matchedOption = options.find(
    (o) => o.value.toLowerCase() === trimmed,
  );

  const handlePick = (next: string) => {
    onValueChange(next);
    setOpen(false);
    // re-focus the input after the popover closes
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  return (
    <RadixPopover.Root open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          "group relative inline-flex items-center gap-2 rounded-md border bg-[color:var(--w-04)] transition-colors",
          "hover:bg-[color:var(--w-07)]",
          "focus-within:border-[color:var(--accent-55)] focus-within:bg-[color:var(--accent-06)] focus-within:shadow-[0_0_0_3px_var(--accent-18)]",
          open &&
            "border-[color:var(--accent-55)] bg-[color:var(--accent-06)]",
          isChip ? "px-3" : "px-2.5",
          invalid
            ? "border-[color:var(--status-err)]"
            : "border-border",
          disabled && "opacity-55 cursor-not-allowed",
          triggerHeights[size],
          className,
        )}
        style={{ minWidth }}
      >
        {chipLabel && (
          <span className="t-caps shrink-0">{chipLabel}</span>
        )}
        <input
          ref={inputRef}
          id={id}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          inputMode={inputMode}
          aria-label={ariaLabel ?? chipLabel}
          disabled={disabled}
          className={cn(
            "flex-1 min-w-0 bg-transparent border-none outline-none text-foreground placeholder:text-faint",
            isChip ? "text-[12.5px]" : "text-[13px]",
          )}
        />
        <RadixPopover.Trigger asChild>
          <button
            type="button"
            aria-label="展开选项"
            disabled={disabled}
            tabIndex={-1}
            className="shrink-0 inline-flex items-center justify-center text-muted hover:text-foreground transition-colors"
          >
            <ChevronDown
              size={isChip ? 11 : 14}
              className="opacity-70 transition-transform group-data-[state=open]:rotate-180"
            />
          </button>
        </RadixPopover.Trigger>
      </div>

      <RadixPopover.Portal>
        <RadixPopover.Content
          align="start"
          sideOffset={6}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={cn(
            "z-50 max-h-[280px] overflow-auto rounded-xl border outline-none p-1",
            "min-w-[var(--radix-popover-trigger-width)]",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
            "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
            "data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1",
          )}
          style={{
            background: "var(--surface-floating)",
            borderColor: "var(--surface-floating-border)",
            backdropFilter: "blur(28px) saturate(150%)",
            WebkitBackdropFilter: "blur(28px) saturate(150%)",
            boxShadow: "var(--shadow-floating)",
          }}
        >
          {/* Custom-value indicator (when current value isn't in presets) */}
          {value && !matchedOption && (
            <>
              <div
                className="flex items-center gap-2 rounded-md px-2.5 py-2 text-[12.5px]"
                style={{
                  background: "var(--accent-10)",
                  border: "1px dashed var(--accent-35)",
                }}
              >
                <Check
                  size={13}
                  strokeWidth={2.4}
                  className="text-[color:var(--accent)]"
                />
                <span className="text-foreground font-mono">{value}</span>
                <span className="text-[11px] text-faint ml-auto">
                  自定义
                </span>
              </div>
              <div className="my-1 mx-2 border-t border-[color:var(--w-06)]" />
            </>
          )}

          {options.map((opt) => {
            const isSelected = opt.value.toLowerCase() === trimmed;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => handlePick(opt.value)}
                className={cn(
                  "relative flex w-full items-center gap-2 rounded-md px-2.5 py-2 pr-8 text-left text-[13px] text-foreground transition-colors",
                  "hover:bg-[color:var(--accent-14)]",
                  isSelected && "bg-[color:var(--accent-10)]",
                )}
              >
                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                  <span className="truncate">{opt.label}</span>
                  {opt.description && (
                    <span className="text-[11px] text-faint truncate">
                      {opt.description}
                    </span>
                  )}
                </div>
                {isSelected && (
                  <Check
                    size={13}
                    strokeWidth={2.4}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[color:var(--accent)]"
                  />
                )}
              </button>
            );
          })}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
