import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { copyText, openPath, saveImages, saveJobImages } from "@/lib/user-actions";
import type { Job } from "@/lib/types";

export function JobDrawerFooter({
  job,
  planned,
  selectedLabel,
  previewPath,
  outputPaths,
  prompt,
  canCancel,
  canSave,
  copy,
  onCancel,
  onDelete,
}: {
  job: Job;
  planned: number;
  selectedLabel: string;
  previewPath?: string;
  outputPaths: string[];
  prompt: string;
  canCancel: boolean;
  canSave: boolean;
  copy: {
    actionVerb: string;
    saveImageLabel: string;
    saveJobLabel: string;
  };
  onCancel?: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  return (
    <div className="px-[18px] py-3 border-t border-border-faint flex flex-col gap-1.5">
      {canCancel ? (
        <Button
          variant="secondary"
          icon="x"
          className="w-full justify-center"
          onClick={() => onCancel?.(job.id)}
        >
          取消任务
        </Button>
      ) : (
        <Button
          variant="secondary"
          icon="download"
          className="w-full justify-center"
          onClick={() => saveImages([previewPath], "图片")}
          disabled={!canSave}
        >
          {planned > 1
            ? `${copy.actionVerb}候选 ${selectedLabel}`
            : copy.saveImageLabel}
        </Button>
      )}
      <div className="flex gap-1.5">
        {outputPaths.length > 1 && (
          <Button
            variant="ghost"
            size="sm"
            icon="download"
            className="flex-1 justify-center"
            onClick={() => saveJobImages(job.id, "任务图片")}
          >
            {copy.saveJobLabel}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          icon="copy"
          className="flex-1 justify-center"
          onClick={() => copyText(prompt, "提示词")}
        >
          复制提示词
        </Button>
        {job.status === "completed" && previewPath && (
          <Button
            variant="ghost"
            size="iconSm"
            icon="external"
            onClick={() => openPath(previewPath)}
            title={api.canUseLocalFiles ? "在系统查看器中打开" : "打开图片"}
            aria-label={api.canUseLocalFiles ? "在系统查看器中打开" : "打开图片"}
          />
        )}
        {onDelete && (
          <Button
            variant="ghost"
            size="iconSm"
            icon="trash"
            onClick={() => onDelete(job.id)}
            title="删除任务"
            aria-label="删除任务"
          />
        )}
      </div>
    </div>
  );
}
