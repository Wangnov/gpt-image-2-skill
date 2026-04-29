import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type ReactNode,
} from "react";
import * as RadixSelect from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  useFieldDescribedBy,
  useFieldId,
  useFieldInvalid,
} from "@/lib/field-context";

/**
 * GlassSelect — Radix-based replacement for the previous native <select>.
 *
 *  variant="default"   tall input-style trigger (used in forms / dialogs)
 *  variant="chip"      compact pill-style trigger with optional caps label
 *                      (used in the Generate page parameter row)
 *
 * Backward-compat: `Select` is re-exported as an alias so legacy imports
 * keep compiling, but the onChange-event API is gone — callers now pass
 * `onValueChange(value: string)`.
 */

export type SelectOption =
  | string
  | { value: string; label: string; description?: string };

type Size = "sm" | "md" | "lg";

interface BaseProps {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  size?: Size;
  ariaLabel?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
}

interface DefaultVariantProps extends BaseProps {
  variant?: "default";
}

interface ChipVariantProps extends BaseProps {
  variant: "chip";
  /** Small uppercase caps label shown to the left of the value */
  label?: string;
}

export type GlassSelectProps = DefaultVariantProps | ChipVariantProps;

const triggerHeights: Record<Size, string> = {
  sm: "h-7",
  md: "h-9",
  lg: "h-10",
};

function normalize(options: readonly SelectOption[]) {
  return options.map((o) =>
    typeof o === "string" ? { value: o, label: o } : o,
  );
}

const SelectContent = forwardRef<
  ElementRef<typeof RadixSelect.Content>,
  ComponentPropsWithoutRef<typeof RadixSelect.Content>
>(({ className, children, position = "popper", sideOffset = 6, ...rest }, ref) => (
  <RadixSelect.Portal>
    <RadixSelect.Content
      ref={ref}
      position={position}
      sideOffset={sideOffset}
      className={cn(
        "z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
        "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
        "data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1",
        className,
      )}
      style={{
        background: "var(--surface-floating-soft)",
        borderColor: "var(--surface-floating-border)",
        backdropFilter: "blur(28px) saturate(150%)",
        WebkitBackdropFilter: "blur(28px) saturate(150%)",
        boxShadow: "var(--shadow-floating)",
      }}
      {...rest}
    >
      <RadixSelect.Viewport className="p-1">{children}</RadixSelect.Viewport>
    </RadixSelect.Content>
  </RadixSelect.Portal>
));
SelectContent.displayName = "SelectContent";

const SelectItem = forwardRef<
  ElementRef<typeof RadixSelect.Item>,
  ComponentPropsWithoutRef<typeof RadixSelect.Item> & {
    description?: ReactNode;
  }
>(({ children, className, description, ...rest }, ref) => (
  <RadixSelect.Item
    ref={ref}
    className={cn(
      "relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-2 pr-8 text-[13px] text-foreground outline-none transition-colors",
      "data-[highlighted]:bg-[color:var(--accent-14)] data-[highlighted]:text-foreground",
      "data-[state=checked]:bg-[color:var(--accent-10)]",
      "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className,
    )}
    {...rest}
  >
    <div className="flex flex-col gap-0.5 min-w-0 flex-1">
      <RadixSelect.ItemText asChild>
        <span className="truncate">{children}</span>
      </RadixSelect.ItemText>
      {description && (
        <span className="text-[11px] text-faint truncate">{description}</span>
      )}
    </div>
    <RadixSelect.ItemIndicator className="absolute right-2 top-1/2 -translate-y-1/2 text-[color:var(--accent)]">
      <Check size={13} strokeWidth={2.4} />
    </RadixSelect.ItemIndicator>
  </RadixSelect.Item>
));
SelectItem.displayName = "SelectItem";

function DefaultTrigger({
  size,
  placeholder,
  className,
  ariaLabel,
  invalid,
  disabled,
  id,
  describedBy,
}: {
  size: Size;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  invalid?: boolean;
  disabled?: boolean;
  id?: string;
  describedBy?: string;
}) {
  return (
    <RadixSelect.Trigger
      id={id}
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      disabled={disabled}
      className={cn(
        "group inline-flex w-full items-center justify-between gap-2 rounded-md border border-border bg-[color:var(--w-04)] pl-2.5 pr-2 text-[13px] text-foreground outline-none transition-colors",
        "hover:bg-[color:var(--w-07)]",
        "focus-visible:border-[color:var(--accent-55)] focus-visible:bg-[color:var(--accent-06)] focus-visible:shadow-[0_0_0_3px_var(--accent-18)]",
        "data-[state=open]:border-[color:var(--accent-55)] data-[state=open]:bg-[color:var(--accent-06)]",
        "disabled:cursor-not-allowed disabled:opacity-55",
        invalid && "border-[color:var(--status-err)]",
        triggerHeights[size],
        className,
      )}
    >
      <RadixSelect.Value placeholder={placeholder ?? "请选择"} />
      <RadixSelect.Icon asChild>
        <ChevronDown
          size={14}
          className="opacity-60 transition-transform group-data-[state=open]:rotate-180"
        />
      </RadixSelect.Icon>
    </RadixSelect.Trigger>
  );
}

function ChipTrigger({
  size,
  label,
  className,
  ariaLabel,
  disabled,
  id,
}: {
  size: Size;
  label?: string;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <RadixSelect.Trigger
      id={id}
      aria-label={ariaLabel ?? label}
      disabled={disabled}
      className={cn(
        "group inline-flex items-center gap-2 rounded-md border border-border bg-[color:var(--w-04)] px-3 text-[12.5px] text-foreground outline-none transition-colors",
        "hover:bg-[color:var(--w-07)]",
        "focus-visible:border-[color:var(--accent-55)] focus-visible:bg-[color:var(--accent-06)] focus-visible:shadow-[0_0_0_3px_var(--accent-18)]",
        "data-[state=open]:border-[color:var(--accent-55)] data-[state=open]:bg-[color:var(--accent-06)]",
        "disabled:cursor-not-allowed disabled:opacity-55",
        triggerHeights[size],
        className,
      )}
    >
      {label && <span className="t-caps shrink-0 whitespace-nowrap">{label}</span>}
      <RadixSelect.Value className="min-w-0 truncate whitespace-nowrap" />
      <RadixSelect.Icon asChild>
        <ChevronDown
          size={11}
          className="opacity-60 transition-transform group-data-[state=open]:rotate-180"
        />
      </RadixSelect.Icon>
    </RadixSelect.Trigger>
  );
}

export function GlassSelect(props: GlassSelectProps) {
  const {
    value,
    onValueChange,
    options,
    size = "md",
    ariaLabel,
    placeholder,
    className,
    disabled,
    id: idProp,
  } = props;
  const id = useFieldId(idProp);
  const describedBy = useFieldDescribedBy();
  const invalid = useFieldInvalid();
  const items = normalize(options);

  return (
    <RadixSelect.Root
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
    >
      {props.variant === "chip" ? (
        <ChipTrigger
          size={size}
          label={props.label}
          ariaLabel={ariaLabel}
          disabled={disabled}
          id={id}
          className={className}
        />
      ) : (
        <DefaultTrigger
          size={size}
          placeholder={placeholder}
          ariaLabel={ariaLabel}
          invalid={invalid}
          disabled={disabled}
          id={id}
          describedBy={describedBy}
          className={className}
        />
      )}

      <SelectContent>
        {items.map((opt) => (
          <SelectItem
            key={opt.value}
            value={opt.value}
            description={opt.description}
          >
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </RadixSelect.Root>
  );
}

/** Backward-compat alias for legacy callsites. */
export const Select = GlassSelect;
