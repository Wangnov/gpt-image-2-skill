import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GlassSelect } from "@/components/ui/select";
import { useUpdatePaths } from "@/hooks/use-config";
import { api, type ConfigPaths } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { PathConfig } from "@/lib/types";
import { copyText } from "@/lib/user-actions";
import { EXPORT_DIR_MODE_OPTIONS } from "./constants";
import { Row, Section } from "./layout";
import {
  clonePathConfig,
  preparePathConfigForSave,
} from "./settings-utils";

type VisibleExportDirMode = (typeof EXPORT_DIR_MODE_OPTIONS)[number]["value"];

function visibleExportDirMode(
  mode: PathConfig["default_export_dir"]["mode"],
): VisibleExportDirMode {
  if (mode === "downloads" || mode === "documents" || mode === "custom") {
    return mode;
  }
  return "pictures";
}

export function ResultFoldersSection({
  paths,
  configPaths,
}: {
  paths?: PathConfig;
  configPaths?: ConfigPaths;
}) {
  const [draft, setDraft] = useState(() => clonePathConfig(paths));
  const updatePaths = useUpdatePaths();
  const selectExportMode = visibleExportDirMode(draft.default_export_dir.mode);
  const customExport = selectExportMode === "custom";
  const previewExportDir = customExport
    ? (draft.default_export_dir.path ?? "")
    : (configPaths?.default_export_dirs?.[selectExportMode] ??
      configPaths?.default_export_dir ??
      "");
  const canSave = Boolean(api.updatePaths) && api.canExportToConfiguredFolder;

  useEffect(() => {
    setDraft(clonePathConfig(paths));
  }, [paths]);

  const patchExportDir = (next: Partial<PathConfig["default_export_dir"]>) => {
    setDraft((current) => ({
      ...current,
      default_export_dir: {
        ...current.default_export_dir,
        ...next,
      },
    }));
  };

  const save = async () => {
    try {
      const nextDraft = {
        ...draft,
        default_export_dir: {
          ...draft.default_export_dir,
          mode: selectExportMode,
          path: customExport ? draft.default_export_dir.path : null,
        },
      };
      const saved = await updatePaths.mutateAsync(
        preparePathConfigForSave(nextDraft),
      );
      setDraft(clonePathConfig(saved.paths));
      toast.success("保存位置已更新");
    } catch (error) {
      toast.error("保存位置更新失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <Section
      title="保存位置"
      description={
        canSave
          ? "生成后的图片会保存在这里。"
          : "当前运行环境会使用浏览器下载位置，无法指定本机文件夹。"
      }
      headerAction={
        <Button
          variant="primary"
          size="sm"
          disabled={!canSave || updatePaths.isPending}
          onClick={() => void save()}
        >
          保存设置
        </Button>
      }
    >
      <Row
        title="默认保存到"
        description="生成完成后，图片会放到这个文件夹。"
        control={
          <div className="grid w-full gap-2 sm:w-[520px] sm:grid-cols-[170px_minmax(0,1fr)]">
            <GlassSelect
              value={selectExportMode}
              onValueChange={(mode) => {
                const nextMode = mode as VisibleExportDirMode;
                patchExportDir({
                  mode: nextMode,
                  path:
                    nextMode === "custom"
                      ? (draft.default_export_dir.path ??
                        previewExportDir ??
                        "")
                      : null,
                });
              }}
              options={EXPORT_DIR_MODE_OPTIONS}
              size="sm"
              ariaLabel="默认保存文件夹"
              disabled={!canSave}
            />
            <Input
              value={previewExportDir}
              onChange={(event) =>
                patchExportDir({ path: event.target.value })
              }
              placeholder={
                customExport
                  ? "/Users/you/Pictures/GPT Image 2"
                  : "按所选模式自动决定"
              }
              readOnly={!canSave || !customExport}
              wrapperClassName={cn(
                (!customExport || !canSave) &&
                  "bg-[color:var(--w-02)] border-border text-muted",
              )}
              className={cn(
                (!customExport || !canSave) && "text-muted cursor-default",
              )}
              suffix={
                <div className="flex items-center gap-1">
                  {customExport && api.canChooseExportFolder && (
                    <Button
                      variant="ghost"
                      size="iconSm"
                      icon="folder"
                      className="h-6 w-6 shrink-0 text-foreground"
                      title="浏览文件夹"
                      aria-label="浏览文件夹"
                      onClick={async () => {
                        const picked = await api.chooseFolder?.(
                          draft.default_export_dir.path ?? previewExportDir,
                        );
                        if (picked) patchExportDir({ path: picked });
                      }}
                    >
                      <span className="sr-only">浏览文件夹</span>
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="iconSm"
                    icon="copy"
                    className="h-6 w-6 shrink-0 text-foreground"
                    title="复制默认保存位置"
                    aria-label="复制默认保存位置"
                    onClick={() => void copyText(previewExportDir, "默认保存位置")}
                  >
                    <span className="sr-only">复制默认保存位置</span>
                  </Button>
                </div>
              }
              size="sm"
              aria-label="自定义保存文件夹"
            />
          </div>
        }
      />
    </Section>
  );
}
