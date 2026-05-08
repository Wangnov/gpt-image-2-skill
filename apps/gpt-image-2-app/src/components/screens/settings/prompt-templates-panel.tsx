import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/hooks/use-confirm";
import { usePromptTemplates } from "@/hooks/use-prompt-templates";
import {
  DEFAULT_PROMPT_TEMPLATE_COLOR,
  DEFAULT_PROMPT_TEMPLATE_ICON,
  exportPromptTemplates,
  importPromptTemplates,
  newPromptTemplate,
  newPromptTemplateGroup,
  type PromptTemplate,
  type PromptTemplateColor,
  type PromptTemplateIcon,
  type PromptTemplateScope,
} from "@/lib/prompt-templates";
import { PromptTemplateForm } from "./prompt-template-form";
import { PromptTemplateGroups } from "./prompt-template-groups";
import { PromptTemplateList } from "./prompt-template-list";
import { downloadJson } from "./prompt-template-primitives";

export function PromptTemplatesPanel() {
  const confirm = useConfirm();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    state,
    update,
    upsertGroup,
    deleteGroup,
    upsertTemplate,
    deleteTemplate,
  } = usePromptTemplates();
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(
    () => state.groups[0]?.id ?? null,
  );
  const [newGroupName, setNewGroupName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [templateTitle, setTemplateTitle] = useState("");
  const [templatePrompt, setTemplatePrompt] = useState("");
  const [templateScope, setTemplateScope] =
    useState<PromptTemplateScope>("common");
  const [templateIcon, setTemplateIcon] = useState<PromptTemplateIcon>(
    DEFAULT_PROMPT_TEMPLATE_ICON,
  );
  const [templateColor, setTemplateColor] = useState<PromptTemplateColor>(
    DEFAULT_PROMPT_TEMPLATE_COLOR,
  );
  const [templateGroupId, setTemplateGroupId] = useState<string>("");

  const selectedGroup = state.groups.find(
    (group) => group.id === selectedGroupId,
  );
  const groupTemplates = selectedGroup
    ? state.templates.filter(
        (template) => template.groupId === selectedGroup.id,
      )
    : [];

  useEffect(() => {
    if (
      selectedGroupId &&
      state.groups.some((group) => group.id === selectedGroupId)
    ) {
      return;
    }
    setSelectedGroupId(state.groups[0]?.id ?? null);
  }, [selectedGroupId, state.groups]);

  useEffect(() => {
    if (
      !templateGroupId ||
      !state.groups.some((group) => group.id === templateGroupId)
    ) {
      setTemplateGroupId(selectedGroupId ?? state.groups[0]?.id ?? "");
    }
  }, [selectedGroupId, state.groups, templateGroupId]);

  const resetForm = () => {
    setEditingId(null);
    setTemplateTitle("");
    setTemplatePrompt("");
    setTemplateScope("common");
    setTemplateIcon(DEFAULT_PROMPT_TEMPLATE_ICON);
    setTemplateColor(DEFAULT_PROMPT_TEMPLATE_COLOR);
    setTemplateGroupId(selectedGroupId ?? state.groups[0]?.id ?? "");
  };

  const addGroup = () => {
    const name = newGroupName.trim();
    if (!name) return;
    const group = newPromptTemplateGroup(name);
    upsertGroup(group);
    setSelectedGroupId(group.id);
    setTemplateGroupId(group.id);
    setNewGroupName("");
  };

  const renameGroup = (groupId: string, name: string) => {
    const group = state.groups.find((item) => item.id === groupId);
    if (!group) return;
    upsertGroup({
      ...group,
      name,
      updatedAt: Date.now(),
    });
  };

  const removeGroup = async (groupId: string) => {
    const group = state.groups.find((item) => item.id === groupId);
    if (!group) return;
    const templateCount = state.templates.filter(
      (template) => template.groupId === groupId,
    ).length;
    const ok = await confirm({
      title: `删除分组「${group.name}」`,
      description:
        templateCount > 0
          ? `会同时删除这个分组里的 ${templateCount} 个模板。`
          : "此操作无法撤销。",
      confirmText: "删除",
      variant: "danger",
    });
    if (!ok) return;
    deleteGroup(groupId);
    if (templateGroupId === groupId) resetForm();
  };

  const editTemplate = (template: PromptTemplate) => {
    setEditingId(template.id);
    setTemplateTitle(template.title);
    setTemplatePrompt(template.prompt);
    setTemplateScope(template.scope);
    setTemplateIcon(template.icon);
    setTemplateColor(template.color);
    setTemplateGroupId(template.groupId);
  };

  const duplicateTemplate = (template: PromptTemplate) => {
    const copy = newPromptTemplate(template.groupId, template.scope);
    upsertTemplate({
      ...copy,
      title: `${template.title} 副本`,
      prompt: template.prompt,
      icon: template.icon,
      color: template.color,
    });
    toast.success("模板已复制");
  };

  const removeTemplate = async (template: PromptTemplate) => {
    const ok = await confirm({
      title: `删除模板「${template.title}」`,
      description: "此操作无法撤销。",
      confirmText: "删除",
      variant: "danger",
    });
    if (!ok) return;
    deleteTemplate(template.id);
    if (editingId === template.id) resetForm();
  };

  const saveTemplate = () => {
    const title = templateTitle.trim();
    const prompt = templatePrompt.trim();
    const groupId = templateGroupId || selectedGroupId || state.groups[0]?.id;
    if (!groupId) {
      toast.error("请先创建一个分组");
      return;
    }
    if (!title) {
      toast.error("请填写模板名称");
      return;
    }
    if (!prompt) {
      toast.error("请填写提示词内容");
      return;
    }
    const existing = editingId
      ? state.templates.find((template) => template.id === editingId)
      : null;
    const base = existing ?? newPromptTemplate(groupId, templateScope);
    upsertTemplate({
      ...base,
      groupId,
      title,
      prompt,
      scope: templateScope,
      icon: templateIcon,
      color: templateColor,
      updatedAt: Date.now(),
    });
    toast.success(existing ? "模板已更新" : "模板已添加");
    resetForm();
  };

  const handleExport = () => {
    downloadJson(
      "gpt-image-2-prompt-templates.json",
      exportPromptTemplates(state),
    );
  };

  const handleImportFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const imported = importPromptTemplates(await file.text());
      const ok = await confirm({
        title: "导入提示词模板",
        description: "导入会替换当前所有分组和模板。",
        confirmText: "导入",
      });
      if (!ok) return;
      update(imported);
      setSelectedGroupId(imported.groups[0]?.id ?? null);
      resetForm();
      toast.success("提示词模板已导入", {
        description: `${imported.groups.length} 个分组，${imported.templates.length} 个模板。`,
      });
    } catch (error) {
      toast.error("导入失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-auto p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[12px] text-muted">
          模板会插入到生成 / 编辑提示词的光标位置；新模板默认作用域为通用。
        </div>
        <div className="flex gap-1.5">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => void handleImportFile(event.target.files?.[0])}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={13} />
            导入 JSON
          </Button>
          <Button variant="ghost" size="sm" onClick={handleExport}>
            <Download size={13} />
            导出 JSON
          </Button>
        </div>
      </div>

      <PromptTemplateGroups
        groups={state.groups}
        selectedGroupId={selectedGroupId}
        newGroupName={newGroupName}
        setNewGroupName={setNewGroupName}
        addGroup={addGroup}
        setSelectedGroupId={setSelectedGroupId}
        renameGroup={renameGroup}
        removeGroup={(groupId) => void removeGroup(groupId)}
      />

      <PromptTemplateForm
        editingId={editingId}
        templateTitle={templateTitle}
        setTemplateTitle={setTemplateTitle}
        templatePrompt={templatePrompt}
        setTemplatePrompt={setTemplatePrompt}
        templateScope={templateScope}
        setTemplateScope={setTemplateScope}
        templateIcon={templateIcon}
        setTemplateIcon={setTemplateIcon}
        templateColor={templateColor}
        setTemplateColor={setTemplateColor}
        templateGroupId={templateGroupId}
        setTemplateGroupId={setTemplateGroupId}
        groups={state.groups}
        resetForm={resetForm}
        saveTemplate={saveTemplate}
      />

      <PromptTemplateList
        selectedGroup={selectedGroup}
        templates={groupTemplates}
        editTemplate={editTemplate}
        duplicateTemplate={duplicateTemplate}
        removeTemplate={(template) => void removeTemplate(template)}
      />
    </div>
  );
}
