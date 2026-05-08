import { Pencil, Plus, Trash2 } from "lucide-react";
import { PromptTemplateMark } from "@/components/screens/shared/prompt-template-mark";
import { Empty } from "@/components/ui/empty";
import {
  PROMPT_SCOPE_LABEL,
  type PromptTemplate,
  type PromptTemplateGroup,
} from "@/lib/prompt-templates";
import { TemplateSection } from "./prompt-template-primitives";

export function PromptTemplateList({
  selectedGroup,
  templates,
  editTemplate,
  duplicateTemplate,
  removeTemplate,
}: {
  selectedGroup?: PromptTemplateGroup;
  templates: PromptTemplate[];
  editTemplate: (template: PromptTemplate) => void;
  duplicateTemplate: (template: PromptTemplate) => void;
  removeTemplate: (template: PromptTemplate) => void;
}) {
  return (
    <TemplateSection
      title={selectedGroup ? `模板 · ${selectedGroup.name}` : "模板"}
      description="默认模板和默认分组与普通数据一样，可编辑、复制或删除。"
    >
      {selectedGroup ? (
        templates.length === 0 ? (
          <Empty
            icon="filedot"
            title="这个分组还没有模板"
            subtitle="在上方新建模板并保存到当前分组。"
          />
        ) : (
          <div className="grid gap-2">
            {templates.map((template) => (
              <article
                key={template.id}
                className="rounded-lg border border-border-faint bg-[color:var(--w-03)] p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <PromptTemplateMark
                    icon={template.icon}
                    color={template.color}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-foreground">
                      {template.title}
                    </div>
                    <div className="mt-0.5 text-[10.5px] text-faint">
                      {PROMPT_SCOPE_LABEL[template.scope]}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => editTemplate(template)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-[color:var(--w-06)] hover:text-foreground"
                    title="编辑"
                    aria-label="编辑模板"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => duplicateTemplate(template)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-[color:var(--w-06)] hover:text-foreground"
                    title="复制"
                    aria-label="复制模板"
                  >
                    <Plus size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeTemplate(template)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-[color:var(--status-err-10)] hover:text-[color:var(--status-err)]"
                    title="删除"
                    aria-label="删除模板"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-muted">
                  {template.prompt}
                </p>
              </article>
            ))}
          </div>
        )
      ) : (
        <Empty
          icon="filedot"
          title="还没有分组"
          subtitle="先添加分组，再创建提示词模板。"
        />
      )}
    </TemplateSection>
  );
}
