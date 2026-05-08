import { Button } from "@/components/ui/button";
import { GlassSelect } from "@/components/ui/select";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_PROMPT_TEMPLATE_COLOR,
  DEFAULT_PROMPT_TEMPLATE_ICON,
  PROMPT_SCOPE_LABEL,
  type PromptTemplateColor,
  type PromptTemplateGroup,
  type PromptTemplateIcon,
  type PromptTemplateScope,
} from "@/lib/prompt-templates";
import {
  TemplateIconPicker,
  TemplateSection,
} from "./prompt-template-primitives";

const SCOPE_OPTIONS = (
  Object.entries(PROMPT_SCOPE_LABEL) as [PromptTemplateScope, string][]
).map(([value, label]) => ({ value, label }));

export function PromptTemplateForm({
  editingId,
  templateTitle,
  setTemplateTitle,
  templatePrompt,
  setTemplatePrompt,
  templateScope,
  setTemplateScope,
  templateIcon,
  setTemplateIcon,
  templateColor,
  setTemplateColor,
  templateGroupId,
  setTemplateGroupId,
  groups,
  resetForm,
  saveTemplate,
}: {
  editingId: string | null;
  templateTitle: string;
  setTemplateTitle: (value: string) => void;
  templatePrompt: string;
  setTemplatePrompt: (value: string) => void;
  templateScope: PromptTemplateScope;
  setTemplateScope: (value: PromptTemplateScope) => void;
  templateIcon: PromptTemplateIcon;
  setTemplateIcon: (value: PromptTemplateIcon) => void;
  templateColor: PromptTemplateColor;
  setTemplateColor: (value: PromptTemplateColor) => void;
  templateGroupId: string;
  setTemplateGroupId: (value: string) => void;
  groups: PromptTemplateGroup[];
  resetForm: () => void;
  saveTemplate: () => void;
}) {
  return (
    <TemplateSection
      title={editingId ? "编辑模板" : "新建模板"}
      description="作用域控制模板出现在哪些创作页面；通用模板会出现在所有页面。"
    >
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
        <div className="flex h-9 w-full items-center gap-1.5 rounded-md border border-border bg-[color:var(--w-04)] px-1.5 transition-colors focus-within:border-[color:var(--accent-55)] focus-within:bg-[color:var(--accent-06)]">
          <TemplateIconPicker
            icon={templateIcon || DEFAULT_PROMPT_TEMPLATE_ICON}
            color={templateColor || DEFAULT_PROMPT_TEMPLATE_COLOR}
            onIconChange={setTemplateIcon}
            onColorChange={setTemplateColor}
          />
          <input
            value={templateTitle}
            onChange={(event) => setTemplateTitle(event.target.value)}
            placeholder="模板名称"
            aria-label="模板名称"
            className="min-w-0 flex-1 border-none bg-transparent px-1 text-[13px] text-foreground outline-none placeholder:text-faint"
          />
        </div>
        <GlassSelect
          value={templateGroupId}
          onValueChange={setTemplateGroupId}
          options={groups.map((group) => ({
            value: group.id,
            label: group.name,
          }))}
          disabled={groups.length === 0}
          placeholder="选择分组"
        />
      </div>
      <div className="mt-3">
        <Segmented
          value={templateScope}
          onChange={(scope) => setTemplateScope(scope as PromptTemplateScope)}
          size="sm"
          ariaLabel="模板作用域"
          options={SCOPE_OPTIONS}
        />
      </div>
      <div className="mt-3">
        <Textarea
          value={templatePrompt}
          onChange={(event) => setTemplatePrompt(event.target.value)}
          minHeight={112}
          placeholder="写入要复用的提示词..."
        />
      </div>
      <div className="mt-3 flex justify-end gap-2">
        {editingId && (
          <Button variant="ghost" size="sm" onClick={resetForm}>
            取消
          </Button>
        )}
        <Button
          variant="primary"
          size="sm"
          icon={editingId ? "check" : "plus"}
          onClick={saveTemplate}
        >
          {editingId ? "保存模板" : "添加模板"}
        </Button>
      </div>
    </TemplateSection>
  );
}
