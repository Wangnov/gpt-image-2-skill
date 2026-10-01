import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import {
  copyText,
  openPath,
  saveJobImages,
  saveJobOutputImage,
} from "@/lib/user-actions";
import type { Job } from "@/lib/types";

export function JobDrawerFooter({
  job,
  planned,
  selectedLabel,
  selectedOutput,
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
  selectedOutput: number;
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
          {t("取消任务")}
        </Button>
      ) : (
        <Button
          variant="secondary"
          icon="download"
          className="w-full justify-center"
          onClick={() => saveJobOutputImage(job.id, selectedOutput)}
          disabled={!canSave}
        >
          {planned > 1
            ? t("{p0}候选 {p1}", { p0: copy.actionVerb, p1: selectedLabel })
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
            onClick={() => saveJobImages(job.id, t("任务图片"))}
          >
            {copy.saveJobLabel}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          icon="copy"
          className="flex-1 justify-center"
          onClick={() => copyText(prompt, t("提示词"))}
        >
          {t("复制提示词")}
        </Button>
        {job.status === "completed" && previewPath && (
          <Button
            variant="ghost"
            size="iconSm"
            icon="external"
            onClick={() => openPath(previewPath)}
            title={
              api.canUseLocalFiles ? t("在系统查看器中打开") : t("打开图片")
            }
            aria-label={
              api.canUseLocalFiles ? t("在系统查看器中打开") : t("打开图片")
            }
          />
        )}
        {onDelete && (
          <Button
            variant="ghost"
            size="iconSm"
            icon="trash"
            onClick={() => onDelete(job.id)}
            title={t("删除任务")}
            aria-label={t("删除任务")}
          />
        )}
      </div>
    </div>
  );
}
