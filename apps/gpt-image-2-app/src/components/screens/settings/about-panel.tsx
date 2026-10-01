import { t } from "@/lib/i18n";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import {
  checkForAppUpdate,
  installAppUpdate,
  type AppUpdateInfo,
} from "@/lib/app-updater";
import { api, type ConfigPaths } from "@/lib/api";
import { cn } from "@/lib/cn";
import { isDesktopRuntime, runtimeCopy } from "@/lib/runtime-copy";
import { useTweaks } from "@/hooks/use-tweaks";
import { readUnlockedPresets, unlockPreset } from "@/lib/theme-presets";
import { UNLOCK_EVENT } from "./constants";
import { PathRow, Row, Section } from "./layout";

export function AboutPanel() {
  const { setTweaks } = useTweaks();
  const copy = runtimeCopy();
  const desktopRuntime = isDesktopRuntime();
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [availableUpdate, setAvailableUpdate] = useState<AppUpdateInfo | null>(
    null,
  );
  const [updateProgress, setUpdateProgress] = useState<string | null>(null);
  const { data: paths } = useQuery<ConfigPaths>({
    queryKey: ["config-paths"],
    queryFn: api.configPaths,
    staleTime: 60_000,
  });
  // Tap-counter state for the Easter egg. Counts taps on the
  // "GPT Image 2" title; 7 within 600ms windows unlocks the
  // letter-matrix preset. Stored in refs so re-renders don't
  // reset the counter mid-streak.
  const tapsRef = useRef(0);
  const lastTapRef = useRef(0);

  const handleTitleTap = () => {
    const now = Date.now();
    // 600ms is forgiving enough that intentional 7-taps land easily
    // but still rejects accidental double-clicks separated by
    // pauses. Each tap resets the window.
    tapsRef.current = now - lastTapRef.current > 600 ? 1 : tapsRef.current + 1;
    lastTapRef.current = now;
    if (tapsRef.current < 7) return;
    tapsRef.current = 0;
    const already = readUnlockedPresets().has("letter-matrix");
    if (!already) {
      unlockPreset("letter-matrix");
      window.dispatchEvent(new CustomEvent(UNLOCK_EVENT));
      toast.success("You've found it.", {
        description: t("「字符矩阵」主题已解锁，可在「外观」里随时切换。"),
        duration: 4500,
      });
    }
    setTweaks({ themePreset: "letter-matrix" });
  };

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateProgress(null);
    try {
      const result = await checkForAppUpdate();
      if (result.status === "unavailable") {
        setAvailableUpdate(null);
        toast.info(t("当前运行环境不支持 App 内更新"), {
          description: t("静态 Page 和 Docker Web 仍按部署端更新。"),
        });
        return;
      }
      if (result.status === "up-to-date") {
        setAvailableUpdate(null);
        toast.success(t("已经是最新版本"), {
          description: t("当前版本 {p0}", { p0: result.currentVersion }),
        });
        return;
      }
      setAvailableUpdate(result.update);
      toast.success(t("发现新版本 {p0}", { p0: result.update.version }), {
        description: t("可以直接下载并安装。"),
      });
    } catch (error) {
      toast.error(t("检查更新失败"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleInstallUpdate = async () => {
    setInstallingUpdate(true);
    setUpdateProgress(t("准备下载"));
    try {
      const result = await installAppUpdate((progress) => {
        if (progress.phase === "starting") {
          setUpdateProgress(t("开始下载"));
          return;
        }
        if (progress.phase === "downloading") {
          if (progress.contentLength) {
            const pct = Math.min(
              100,
              Math.round(
                (progress.downloadedBytes / progress.contentLength) * 100,
              ),
            );
            setUpdateProgress(t("下载中 {p0}%", { p0: pct }));
          } else {
            setUpdateProgress(t("下载中"));
          }
          return;
        }
        setUpdateProgress(t("正在安装"));
      });
      if (result.status === "up-to-date") {
        setAvailableUpdate(null);
        toast.success(t("已经是最新版本"));
      }
    } catch (error) {
      toast.error(t("安装更新失败"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setInstallingUpdate(false);
      setUpdateProgress(null);
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-auto p-4 sm:p-5 space-y-4">
      <header className="px-1 pt-0.5 space-y-1">
        <div className="flex items-baseline gap-2">
          <button
            type="button"
            onClick={handleTitleTap}
            className={cn(
              "t-h2 text-foreground tracking-tight",
              "select-none focus-visible:outline-none",
              "transition-transform active:scale-[0.985]",
            )}
            aria-label="GPT Image 2"
          >
            GPT Image 2
          </button>
          <span className="t-mono text-[11px] text-faint">
            v{__APP_VERSION__}
          </span>
        </div>
        <div className="text-[11.5px] text-muted">
          {copy.kind === "tauri"
            ? t("本地图像生成与编辑桌面客户端。")
            : copy.kind === "http"
              ? t("连接后端服务的 Web 创作工作台。")
              : t("浏览器直连的 Web 创作工作台。")}
        </div>
      </header>

      {desktopRuntime ? (
        <>
          <Section
            title={t("应用更新")}
            description={t("桌面 App 使用 Tauri 官方更新器。")}
          >
            <Row
              title={
                availableUpdate
                  ? t("可更新到 {p0}", { p0: availableUpdate.version })
                  : t("检查桌面端更新")
              }
              description={
                availableUpdate?.body ||
                t("有新版本时会下载签名更新包，安装完成后自动重启 App。")
              }
              control={
                availableUpdate ? (
                  <Button
                    variant="primary"
                    size="sm"
                    icon={installingUpdate ? undefined : "download"}
                    disabled={installingUpdate}
                    onClick={() => void handleInstallUpdate()}
                  >
                    {installingUpdate ? (
                      <>
                        <Loader2 size={13} className="animate-spin" />
                        {updateProgress ?? t("安装中")}
                      </>
                    ) : (
                      t("下载并重启")
                    )}
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={checkingUpdate ? undefined : "reload"}
                    disabled={checkingUpdate}
                    onClick={() => void handleCheckUpdate()}
                  >
                    {checkingUpdate ? (
                      <>
                        <Loader2 size={13} className="animate-spin" />
                        {t("检查中")}
                      </>
                    ) : (
                      t("检查更新")
                    )}
                  </Button>
                )
              }
            />
          </Section>

          <Section
            title={t("数据位置")}
            description={t("本地配置、历史和图片保存位置。只读信息。")}
          >
            <PathRow title={t("配置文件")} path={paths?.config_file} />
            <PathRow title={t("历史数据库")} path={paths?.history_file} />
            <PathRow
              title={t("图片保存位置")}
              path={paths?.default_export_dir ?? paths?.result_library_dir}
              isFolder
            />
            <PathRow
              title={t("旧共享目录")}
              path={paths?.legacy_jobs_dir}
              isFolder
            />
            <PathRow title={t("配置目录")} path={paths?.config_dir} isFolder />
          </Section>
        </>
      ) : (
        <>
          <Section
            title={t("版本")}
            description={
              copy.kind === "http"
                ? t("Web 前端和后端服务由部署端更新，页面内不安装桌面更新包。")
                : t("静态 Web 由站点部署更新，页面内不安装桌面更新包。")
            }
          >
            <Row
              title={t("当前前端版本 v{p0}", { p0: __APP_VERSION__ })}
              description={
                copy.kind === "http"
                  ? t("后端服务更新后，刷新页面即可使用新的 Web 前端。")
                  : t("站点发布后，刷新页面即可使用新的静态 Web 前端。")
              }
              control={
                <span className="inline-flex h-8 items-center rounded-full border border-border-faint px-3 text-[11px] font-semibold text-muted">
                  {copy.name}
                </span>
              }
            />
          </Section>

          <Section
            title={copy.kind === "http" ? t("服务端数据") : t("结果下载")}
            description={
              copy.kind === "http"
                ? t("任务历史和结果由后端服务维护，网页只提供预览和下载入口。")
                : t("需要长期保留的图片，请使用下载按钮。")
            }
          >
            <Row
              title={t("结果获取")}
              description={
                copy.kind === "http"
                  ? t("单图可直接下载，多图任务会打包为 ZIP 下载。")
                  : t("单图可直接下载，多图任务会打包为 ZIP 下载。")
              }
              control={
                <span className="inline-flex h-8 items-center rounded-full border border-border-faint px-3 text-[11px] font-semibold text-muted">
                  {copy.saveJobLabel}
                </span>
              }
            />
          </Section>
        </>
      )}

      <div className="flex items-center gap-1.5 px-1 pt-1 text-[11px] text-faint">
        <Icon name="info" size={11} />
        <span>
          {desktopRuntime
            ? t("偏好保存在桌面 App 配置里；并发上限会实时同步到后台队列。")
            : copy.kind === "http"
              ? t("网页不会显示服务器目录；需要结果文件时请使用下载按钮。")
              : t("需要结果文件时请使用下载按钮。")}
        </span>
      </div>
    </div>
  );
}
