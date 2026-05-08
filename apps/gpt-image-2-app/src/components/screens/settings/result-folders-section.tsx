import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GlassSelect } from "@/components/ui/select";
import { useUpdatePaths } from "@/hooks/use-config";
import { api, type ConfigPaths } from "@/lib/api";
import type { PathConfig } from "@/lib/types";
import { EXPORT_DIR_MODE_OPTIONS } from "./constants";
import { PathRow, Row, Section } from "./layout";
import {
  clonePathConfig,
  preparePathConfigForSave,
} from "./settings-utils";

export function ResultFoldersSection({
  paths,
  configPaths,
}: {
  paths?: PathConfig;
  configPaths?: ConfigPaths;
}) {
  const [draft, setDraft] = useState(() => clonePathConfig(paths));
  const updatePaths = useUpdatePaths();
  const customExport = draft.default_export_dir.mode === "custom";
  const previewExportDir = customExport
    ? (draft.default_export_dir.path ?? "")
    : (configPaths?.default_export_dirs?.[draft.default_export_dir.mode] ??
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
      const saved = await updatePaths.mutateAsync(
        preparePathConfigForSave(draft),
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
      title="保存到本机"
      description={
        canSave
          ? "点「保存图片」时，会复制到哪个文件夹。"
          : "网页版会用浏览器下载位置，无法指定本机文件夹。"
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
        title="默认文件夹"
        description="App 历史保留所有图；这里只决定「保存图片」复制到哪里。"
        control={
          <div className="grid w-full gap-2 sm:w-[520px] sm:grid-cols-[170px_minmax(0,1fr)]">
            <GlassSelect
              value={draft.default_export_dir.mode}
              onValueChange={(mode) => {
                const nextMode =
                  mode as PathConfig["default_export_dir"]["mode"];
                patchExportDir({
                  mode: nextMode,
                  path:
                    nextMode === "custom"
                      ? (draft.default_export_dir.path ??
                        configPaths?.default_export_dir ??
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
              disabled={!canSave || !customExport}
              size="sm"
              aria-label="自定义保存文件夹"
            />
          </div>
        }
      />
      <PathRow
        title="当前保存位置"
        path={configPaths?.default_export_dir}
        isFolder
        dim
      />
      <PathRow
        title="App 历史目录"
        path={configPaths?.result_library_dir ?? configPaths?.jobs_dir}
        isFolder
        dim
      />
    </Section>
  );
}
