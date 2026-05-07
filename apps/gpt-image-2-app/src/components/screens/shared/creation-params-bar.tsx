import { type ReactNode, useMemo } from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { SlidersHorizontal, X } from "lucide-react";
import { GlassCombobox, type ComboboxOption } from "@/components/ui/combobox";
import { GlassSelect, type SelectOption } from "@/components/ui/select";
import { cn } from "@/lib/cn";

type CreationParamsBarProps = {
  size: string;
  onSizeChange: (value: string) => void;
  sizeOptions: readonly ComboboxOption[];
  sizeInvalid?: boolean;
  quality: string;
  onQualityChange: (value: string) => void;
  qualityOptions: readonly SelectOption[];
  format: string;
  onFormatChange: (value: string) => void;
  formatOptions: readonly SelectOption[];
  count: string;
  onCountChange: (value: string) => void;
  countOptions: readonly ComboboxOption[];
  countDisabled?: boolean;
  countInvalid?: boolean;
  action: ReactNode;
  className?: string;
  stackActionOnDesktop?: boolean;
};

function optionLabel(options: readonly SelectOption[], value: string) {
  const option = options.find((item) =>
    typeof item === "string" ? item === value : item.value === value,
  );
  if (!option) return value;
  return typeof option === "string" ? option : option.label;
}

function compactSizeLabel(value: string) {
  const normalized = value.trim().toLowerCase().replaceAll("×", "x");
  if (normalized === "auto") return "自动";
  const match = normalized.match(/^(\d{3,5})x(\d{3,5})$/);
  if (!match) return value;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width === height) return `${width}²`;
  return `${width}×${height}`;
}

function ParamsFields({
  size,
  onSizeChange,
  sizeOptions,
  sizeInvalid,
  quality,
  onQualityChange,
  qualityOptions,
  format,
  onFormatChange,
  formatOptions,
  count,
  onCountChange,
  countOptions,
  countDisabled,
  countInvalid,
  variant,
}: Omit<CreationParamsBarProps, "action" | "className"> & {
  variant: "chip" | "sheet";
}) {
  if (variant === "sheet") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <div className="t-caps px-0.5">尺寸</div>
          <GlassCombobox
            value={size}
            onValueChange={onSizeChange}
            options={sizeOptions}
            placeholder="WxH"
            invalid={sizeInvalid}
            className="w-full"
          />
        </div>
        <div className="space-y-1.5">
          <div className="t-caps px-0.5">质量</div>
          <GlassSelect
            value={quality}
            onValueChange={onQualityChange}
            options={qualityOptions}
          />
        </div>
        <div className="space-y-1.5">
          <div className="t-caps px-0.5">格式</div>
          <GlassSelect
            value={format}
            onValueChange={onFormatChange}
            options={formatOptions}
          />
        </div>
        <div className="space-y-1.5">
          <div className="t-caps px-0.5">数量</div>
          <GlassCombobox
            value={count}
            onValueChange={onCountChange}
            options={countOptions}
            disabled={countDisabled}
            inputMode="numeric"
            placeholder="1-10"
            invalid={countInvalid}
            className="w-full"
          />
        </div>
      </div>
    );
  }

  return (
    <>
      <GlassCombobox
        variant="chip"
        label="尺寸"
        value={size}
        options={sizeOptions}
        onValueChange={onSizeChange}
        placeholder="WxH"
        className="w-full min-w-0"
        invalid={sizeInvalid}
      />
      <GlassSelect
        variant="chip"
        label="质量"
        value={quality}
        options={qualityOptions}
        onValueChange={onQualityChange}
        className="w-full min-w-0 justify-between"
      />
      <GlassSelect
        variant="chip"
        label="格式"
        value={format}
        options={formatOptions}
        onValueChange={onFormatChange}
        className="w-full min-w-0 justify-between"
      />
      <GlassCombobox
        variant="chip"
        label="数量"
        value={count}
        options={countOptions}
        onValueChange={onCountChange}
        disabled={countDisabled}
        inputMode="numeric"
        placeholder="1-10"
        className="w-full min-w-0"
        invalid={countInvalid}
      />
    </>
  );
}

function MobileParamsSheet(props: Omit<CreationParamsBarProps, "action">) {
  const summary = useMemo(
    () => [
      compactSizeLabel(props.size),
      optionLabel(props.qualityOptions, props.quality),
      optionLabel(props.formatOptions, props.format),
      `${props.count || "1"}张`,
    ],
    [
      props.count,
      props.format,
      props.formatOptions,
      props.quality,
      props.qualityOptions,
      props.size,
    ],
  );

  return (
    <RadixDialog.Root>
      <RadixDialog.Trigger asChild>
        <button
          type="button"
          className="flex h-10 w-full items-center gap-2 rounded-md border border-border bg-[color:var(--w-04)] px-3 text-left text-[12.5px] text-foreground transition-colors hover:bg-[color:var(--w-07)]"
        >
          <SlidersHorizontal size={13} className="shrink-0 text-muted" />
          <span className="t-caps shrink-0">参数</span>
          <span className="min-w-0 flex-1 truncate text-[13px]">
            {summary.join(" · ")}
          </span>
        </button>
      </RadixDialog.Trigger>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-sm sm:hidden" />
        <RadixDialog.Content
          className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border border-border-faint p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-popover outline-none sm:hidden"
          style={{
            background: "var(--surface-floating)",
            backdropFilter: "blur(28px) saturate(150%)",
            WebkitBackdropFilter: "blur(28px) saturate(150%)",
          }}
        >
          <div className="mb-3 flex items-center gap-2">
            <RadixDialog.Title className="text-[13px] font-semibold text-foreground">
              生成参数
            </RadixDialog.Title>
            <div className="min-w-0 flex-1 truncate text-[11px] text-faint">
              {summary.join(" · ")}
            </div>
            <RadixDialog.Close asChild>
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-[color:var(--w-06)] hover:text-foreground"
                aria-label="关闭参数"
              >
                <X size={14} />
              </button>
            </RadixDialog.Close>
          </div>
          <ParamsFields {...props} variant="sheet" />
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export function CreationParamsBar({
  action,
  className,
  stackActionOnDesktop = false,
  ...params
}: CreationParamsBarProps) {
  return (
    <div
      className={cn(
        "mt-2 flex items-center gap-2",
        stackActionOnDesktop && "xl:flex-col xl:items-stretch",
        className,
      )}
    >
      <div className="min-w-0 flex-1 sm:hidden">
        <MobileParamsSheet {...params} />
      </div>
      <div
        className={cn(
          "hidden min-w-0 flex-1 grid-cols-4 gap-2 sm:grid",
          stackActionOnDesktop && "xl:w-full xl:flex-none",
        )}
      >
        <ParamsFields {...params} variant="chip" />
      </div>
      <div
        className={cn(
          "w-[112px] shrink-0 sm:w-[168px]",
          stackActionOnDesktop && "xl:w-full xl:flex-none",
        )}
      >
        {action}
      </div>
    </div>
  );
}
