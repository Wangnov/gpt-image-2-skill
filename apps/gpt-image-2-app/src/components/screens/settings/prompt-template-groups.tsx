import { FileText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { PromptTemplateGroup } from "@/lib/prompt-templates";
import { TemplateSection, TextInput } from "./prompt-template-primitives";

export function PromptTemplateGroups({
  groups,
  selectedGroupId,
  newGroupName,
  setNewGroupName,
  addGroup,
  setSelectedGroupId,
  renameGroup,
  removeGroup,
}: {
  groups: PromptTemplateGroup[];
  selectedGroupId: string | null;
  newGroupName: string;
  setNewGroupName: (value: string) => void;
  addGroup: () => void;
  setSelectedGroupId: (id: string) => void;
  renameGroup: (groupId: string, name: string) => void;
  removeGroup: (groupId: string) => void;
}) {
  return (
    <TemplateSection
      title="分组"
      description="分组可自定义；删除分组会删除其中模板。"
    >
      <div className="flex gap-2">
        <TextInput
          value={newGroupName}
          onChange={setNewGroupName}
          placeholder="新分组名称"
        />
        <Button
          variant="secondary"
          size="sm"
          icon="plus"
          disabled={!newGroupName.trim()}
          onClick={addGroup}
        >
          添加
        </Button>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {groups.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border-faint px-3 py-4 text-center text-[12px] text-muted">
            暂无分组，添加一个分组后即可创建模板。
          </div>
        ) : (
          groups.map((group) => {
            const isSelected = group.id === selectedGroupId;
            return (
              <div
                key={group.id}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-2.5 py-2",
                  isSelected
                    ? "border-[color:var(--accent-30)] bg-[color:var(--accent-06)]"
                    : "border-border-faint bg-[color:var(--w-03)]",
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (!isSelected) setSelectedGroupId(group.id);
                  }}
                  aria-current={isSelected ? "true" : undefined}
                  className={cn(
                    "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors",
                    isSelected
                      ? "bg-[color:var(--accent-14)] text-foreground"
                      : "text-muted hover:bg-[color:var(--w-06)] hover:text-foreground",
                  )}
                >
                  <FileText size={12} />
                  {isSelected ? "当前" : "切换"}
                </button>
                <TextInput
                  value={group.name}
                  onChange={(name) => renameGroup(group.id, name)}
                  ariaLabel="分组名称"
                />
                <button
                  type="button"
                  onClick={() => removeGroup(group.id)}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-[color:var(--status-err-10)] hover:text-[color:var(--status-err)]"
                  title="删除分组"
                  aria-label="删除分组"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </TemplateSection>
  );
}
