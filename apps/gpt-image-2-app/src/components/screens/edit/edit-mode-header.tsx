import { Segmented } from "@/components/ui/segmented";
import type { EditMode } from "./shared";

export function EditModeHeader({
  editMode,
  onChange,
}: {
  editMode: EditMode;
  onChange: (mode: EditMode) => void;
}) {
  return (
    <header className="shrink-0 px-4 pt-3 pb-2 flex items-center gap-2 flex-wrap">
      <Segmented
        value={editMode}
        onChange={onChange}
        ariaLabel="编辑模式"
        size="sm"
        options={[
          { value: "reference", label: "多图参考", icon: "image" },
          { value: "region", label: "局部编辑", icon: "mask" },
        ]}
      />

      <div className="flex-1" />
    </header>
  );
}
