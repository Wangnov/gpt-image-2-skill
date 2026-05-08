import { type ReactNode } from "react";
import {
  PromptTemplateMark,
  promptTemplateColorStyle,
} from "@/components/screens/shared/prompt-template-mark";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  PROMPT_TEMPLATE_COLORS,
  PROMPT_TEMPLATE_ICONS,
  type PromptTemplateColor,
  type PromptTemplateIcon,
} from "@/lib/prompt-templates";
import { cn } from "@/lib/cn";

export function TemplateSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section
      className="overflow-hidden rounded-xl border border-border-faint"
      style={{ background: "var(--w-02)" }}
    >
      <header className="border-b border-border-faint px-4 py-3 sm:px-5">
        <div className="t-h3">{title}</div>
        {description && (
          <div className="mt-0.5 text-[12px] text-muted">{description}</div>
        )}
      </header>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel ?? placeholder}
      className="h-9 w-full rounded-md border border-border bg-[color:var(--w-04)] px-3 text-[13px] text-foreground outline-none placeholder:text-faint focus:border-[color:var(--accent-55)] focus:bg-[color:var(--accent-06)]"
    />
  );
}

export function downloadJson(filename: string, content: string) {
  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function TemplateIconPicker({
  icon,
  color,
  onIconChange,
  onColorChange,
}: {
  icon: PromptTemplateIcon;
  color: PromptTemplateColor;
  onIconChange: (icon: PromptTemplateIcon) => void;
  onColorChange: (color: PromptTemplateColor) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[color:var(--w-06)]"
          title="选择模板图标和颜色"
          aria-label="选择模板图标和颜色"
        >
          <PromptTemplateMark icon={icon} color={color} size="sm" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[326px] p-2">
        <div className="grid grid-cols-6 gap-1">
          {PROMPT_TEMPLATE_ICONS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => onIconChange(item.value)}
              title={item.label}
              aria-label={`选择图标：${item.label}`}
              aria-pressed={icon === item.value}
              className={cn(
                "flex h-10 items-center justify-center rounded-lg border transition-[background-color,border-color,transform]",
                icon === item.value
                  ? "scale-[1.03] border-[color:var(--accent-45)] bg-[color:var(--accent-14)]"
                  : "border-transparent hover:border-border-faint hover:bg-[color:var(--w-06)] hover:scale-[1.02]",
              )}
            >
              <PromptTemplateMark
                icon={item.value}
                color={color}
                size="md"
                className="border-transparent"
              />
            </button>
          ))}
        </div>
        <div className="mt-2 border-t border-border-faint pt-2">
          <div className="flex items-center justify-between gap-2">
            {PROMPT_TEMPLATE_COLORS.map((item) => {
              const style = promptTemplateColorStyle(item.value);
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => onColorChange(item.value)}
                  title={item.label}
                  aria-label={`选择颜色：${item.label}`}
                  aria-pressed={color === item.value}
                  className={cn(
                    "inline-flex h-7 w-7 items-center justify-center rounded-full border transition-transform",
                    color === item.value
                      ? "border-[color:var(--accent-65)] bg-[color:var(--w-06)]"
                      : "border-transparent hover:scale-105 hover:border-border-faint",
                  )}
                >
                  <span
                    className="h-4 w-4 rounded-full border"
                    style={{ background: style.fg, borderColor: style.border }}
                  />
                </button>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
