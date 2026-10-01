import { t, getLocale } from "@/lib/i18n";
import { useMemo, useState } from "react";
import { FileText, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { usePromptTemplates } from "@/hooks/use-prompt-templates";
import { PromptTemplateMark } from "@/components/screens/shared/prompt-template-mark";
import {
  PROMPT_SCOPE_LABEL,
  visiblePromptTemplatesForScope,
  type PromptTemplate,
  type PromptTemplateScope,
} from "@/lib/prompt-templates";
import { cn } from "@/lib/cn";

export function PromptTemplatePicker({
  scope,
  onInsert,
  disabled,
}: {
  scope: PromptTemplateScope;
  onInsert: (prompt: string) => void;
  disabled?: boolean;
}) {
  const { state, touchTemplate } = usePromptTemplates();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const templates = useMemo(() => {
    return visiblePromptTemplatesForScope(state, scope).filter((template) => {
      if (!normalizedQuery) return true;
      return `${template.title}\n${template.prompt}`
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [normalizedQuery, scope, state, getLocale()]);
  const groups = state.groups
    .map((group) => ({
      group,
      templates: templates.filter((template) => template.groupId === group.id),
    }))
    .filter((group) => group.templates.length > 0);

  const applyTemplate = (template: PromptTemplate) => {
    onInsert(template.prompt);
    touchTemplate(template.id);
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          icon="wand"
          disabled={disabled}
          title={t("插入提示词模板")}
        >
          {t("模板")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[320px] p-2">
        <div className="relative mb-2">
          <Search
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("搜索模板")}
            className="h-8 w-full rounded-md border border-border bg-[color:var(--w-04)] pl-8 pr-3 text-[12.5px] text-foreground outline-none placeholder:text-faint focus:border-[color:var(--accent-55)]"
          />
        </div>
        <div className="max-h-[330px] space-y-2 overflow-auto pr-1 scrollbar-thin">
          {groups.length === 0 ? (
            <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-faint bg-[color:var(--w-02)] px-4 text-center">
              <FileText size={18} className="text-faint" />
              <div className="text-[12px] text-muted">
                {t("没有匹配的模板，可在设置里添加。")}
              </div>
            </div>
          ) : (
            groups.map(({ group, templates: groupTemplates }) => (
              <section key={group.id} className="space-y-1.5">
                <div className="flex items-center gap-1.5 px-1">
                  <span className="t-caps">{group.name}</span>
                  <span className="h-px flex-1 bg-border-faint" />
                </div>
                {groupTemplates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => applyTemplate(template)}
                    className={cn(
                      "group w-full rounded-lg border border-border-faint bg-[color:var(--w-03)] px-3 py-2 text-left transition-colors",
                      "hover:border-[color:var(--accent-30)] hover:bg-[color:var(--accent-06)]",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <PromptTemplateMark
                        icon={template.icon}
                        color={template.color}
                        size="sm"
                      />
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-foreground">
                        {template.title}
                      </span>
                      <span className="shrink-0 rounded-full border border-border-faint px-1.5 py-0.5 text-[10px] text-faint">
                        {PROMPT_SCOPE_LABEL[template.scope]}
                      </span>
                    </div>
                    <div className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-muted">
                      {template.prompt || t("（空模板）")}
                    </div>
                  </button>
                ))}
              </section>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
