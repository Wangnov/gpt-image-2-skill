import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Toaster, toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ClassicShell } from "@/components/legacy/classic-shell";
import { TopNav } from "@/components/shell/top-nav";
import { WindowChrome } from "@/components/shell/window-chrome";
import { type ScreenId, isScreenId } from "@/components/shell/screens";
import { GenerateScreen } from "@/components/screens/generate";
import { EditScreen } from "@/components/screens/edit";
import { HistoryScreen } from "@/components/screens/history";
import { SettingsScreen } from "@/components/screens/settings";
import { useConfig } from "@/hooks/use-config";
import { useConfirm } from "@/hooks/use-confirm";
import { useDisableWebviewContextMenu } from "@/hooks/use-disable-webview-contextmenu";
import { useImageShortcuts } from "@/hooks/use-image-shortcuts";
import { useJobNotifications } from "@/hooks/use-job-notifications";
import { useJobs } from "@/hooks/use-jobs";
import { useGlobalShortcuts } from "@/hooks/use-shortcuts";
import { useTweaks } from "@/hooks/use-tweaks";
import { TextSelectionContextMenu } from "@/components/ui/text-selection-context-menu";
import { QuickLookHost } from "@/components/ui/quick-look";
import { setActionsConfirm } from "@/lib/image-actions/confirm-action";
import { setActionsNavigator } from "@/lib/image-actions/navigation";
import {
  checkForAppUpdate,
  installAppUpdate,
  shouldAutoCheckForUpdates,
} from "@/lib/app-updater";
import { OPEN_JOB_EVENT } from "@/lib/job-navigation";

class ScreenErrorBoundary extends Component<
  { children: ReactNode; onReset: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("[gpt-image-2-app] screen error:", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center"
      >
        <div className="t-h2 text-foreground">这个屏幕崩了</div>
        <div className="max-w-[420px] text-[13px] text-muted">
          {this.state.error.message || "出现了一个未知错误。"}
        </div>
        <Button
          variant="primary"
          size="md"
          icon="reload"
          onClick={() => {
            this.setState({ error: null });
            this.props.onReset();
          }}
        >
          重新加载
        </Button>
      </div>
    );
  }
}

function readInitialScreen(): ScreenId {
  try {
    const raw = localStorage.getItem("gpt2.screen");
    if (isScreenId(raw)) return raw;
    // Older localStorage payloads might still contain "providers" or
    // "mockups" — coerce them to sensible new screens.
    if (raw === "providers") return "settings";
    if (raw === "mockups") return "generate";
  } catch {
    /* ignore */
  }
  return "generate";
}

export default function App() {
  const [screen, setScreenState] = useState<ScreenId>(readInitialScreen);
  const {
    data: config,
    error: configError,
    refetch: refetchConfig,
  } = useConfig();
  const { data: jobs } = useJobs();
  const { tweaks } = useTweaks();
  const confirm = useConfirm();

  const setScreen = useCallback((s: ScreenId) => {
    setScreenState(s);
    try {
      localStorage.setItem("gpt2.screen", s);
    } catch {
      /* ignore */
    }
  }, []);

  const openJob = useCallback(
    (jobId: string) => {
      setScreen("history");
      window.setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent(OPEN_JOB_EVENT, { detail: { jobId } }),
        );
      }, 0);
    },
    [setScreen],
  );

  useGlobalShortcuts({
    onScreen: (s) => {
      if (isScreenId(s)) setScreen(s);
    },
  });
  useJobNotifications(jobs, openJob);
  useDisableWebviewContextMenu();
  useImageShortcuts();

  // Hand the screen setter to image-action executors so "Use as Reference"
  // / "Edit with Prompt" / "Reveal Job in History" can navigate after their
  // backend bookkeeping completes.
  useEffect(() => {
    setActionsNavigator(setScreen);
  }, [setScreen]);

  // And the confirm dialog so destructive executors (Delete) can prompt
  // before tearing down a multi-output job.
  useEffect(() => {
    setActionsConfirm(confirm);
    return () => setActionsConfirm(null);
  }, [confirm]);

  useEffect(() => {
    if (!shouldAutoCheckForUpdates()) return;
    let cancelled = false;
    void checkForAppUpdate()
      .then((result) => {
        if (cancelled || result.status !== "available") return;
        toast(`发现新版本 ${result.update.version}`, {
          description: "可以现在安装，更新完成后 App 会自动重启。",
          duration: 12_000,
          action: {
            label: "更新",
            onClick: () => {
              const id = toast.loading("正在下载更新", {
                description: "保持 App 打开，下载完成后会安装并重启。",
              });
              void installAppUpdate((progress) => {
                if (
                  progress.phase === "downloading" &&
                  progress.contentLength
                ) {
                  const pct = Math.min(
                    100,
                    Math.round(
                      (progress.downloadedBytes / progress.contentLength) * 100,
                    ),
                  );
                  toast.loading("正在下载更新", {
                    id,
                    description: `${pct}%`,
                  });
                } else if (progress.phase === "installing") {
                  toast.loading("正在安装更新", {
                    id,
                    description: "马上重启。",
                  });
                }
              }).catch((error) => {
                toast.error("更新失败", {
                  id,
                  description:
                    error instanceof Error ? error.message : String(error),
                });
              });
            },
          },
        });
      })
      .catch((error) => {
        // Auto-check is intentionally quiet; the About panel exposes
        // explicit errors when the user asks for an update check.
        console.debug("[gpt-image-2-app] updater auto-check failed", error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const active = (job: { status: string }) =>
    job.status === "running" || job.status === "queued";
  const generateCount =
    jobs?.filter((job) => active(job) && job.command === "images generate")
      .length ?? 0;
  const editCount =
    jobs?.filter((job) => active(job) && job.command === "images edit")
      .length ?? 0;
  const running = {
    generate: generateCount,
    edit: editCount,
    total: generateCount + editCount,
  };
  const legacyInterface = tweaks.interfaceMode === "legacy";

  return (
    <div className="desktop">
      <WindowChrome>
        <div className="relative h-full w-full">
          {legacyInterface ? (
            <ScreenErrorBoundary onReset={() => setScreenState(screen)}>
              <ClassicShell
                screen={screen}
                setScreen={setScreen}
                config={config}
                running={running}
              />
            </ScreenErrorBoundary>
          ) : (
            <div className="relative flex h-full w-full flex-col">
              <TopNav screen={screen} setScreen={setScreen} running={running} />

              <main
                id="main"
                role="main"
                className="flex-1 min-h-0 relative"
                aria-label={screen}
              >
                <section
                  className="absolute inset-0 h-full"
                  hidden={screen !== "generate"}
                  aria-hidden={screen !== "generate"}
                >
                  <ScreenErrorBoundary onReset={() => setScreenState(screen)}>
                    <GenerateScreen
                      config={config}
                      onOpenEdit={() => setScreen("edit")}
                      onOpenHistory={() => setScreen("history")}
                      onOpenJob={openJob}
                      onOpenSettings={() => setScreen("settings")}
                    />
                  </ScreenErrorBoundary>
                </section>
                <section
                  className="absolute inset-0 h-full"
                  hidden={screen !== "edit"}
                  aria-hidden={screen !== "edit"}
                >
                  <ScreenErrorBoundary onReset={() => setScreenState(screen)}>
                    <EditScreen config={config} active={screen === "edit"} />
                  </ScreenErrorBoundary>
                </section>
                <section
                  className="absolute inset-0 h-full"
                  hidden={screen !== "history"}
                  aria-hidden={screen !== "history"}
                >
                  <ScreenErrorBoundary onReset={() => setScreenState(screen)}>
                    <HistoryScreen
                      onSwitchToGenerate={() => setScreen("generate")}
                      onSwitchToEdit={() => setScreen("edit")}
                    />
                  </ScreenErrorBoundary>
                </section>
                <section
                  className="absolute inset-0 h-full"
                  hidden={screen !== "settings"}
                  aria-hidden={screen !== "settings"}
                >
                  <ScreenErrorBoundary onReset={() => setScreenState(screen)}>
                    <SettingsScreen config={config} />
                  </ScreenErrorBoundary>
                </section>
              </main>
            </div>
          )}

          {!config && (
            <div
              role={configError ? "alert" : "status"}
              aria-live="polite"
              className="absolute inset-0 z-20 flex items-center justify-center bg-background/80 text-[13px] text-faint"
            >
              <div className="surface-panel flex max-w-[360px] flex-col items-center gap-3 p-4 text-center">
                {configError ? (
                  <>
                    <div className="t-h3 text-foreground">配置加载失败</div>
                    <div className="t-small">
                      {configError instanceof Error
                        ? configError.message
                        : String(configError)}
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon="reload"
                      onClick={() => refetchConfig()}
                    >
                      重试
                    </Button>
                  </>
                ) : (
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="inline-block h-3 w-3 rounded-full bg-accent animate-pulse-subtle"
                    />
                    加载配置中…
                  </div>
                )}
              </div>
            </div>
          )}
          <TextSelectionContextMenu />
          <QuickLookHost />
        </div>
      </WindowChrome>
      {/*
        Sonner doesn't internally portal its toaster to <body>, so when it
        renders inside a stacking context (`div.desktop` / `div.relative`)
        its `z-index` gets clamped to that context's stacking position —
        and Radix Drawer / Quick Look (which DO portal to <body>) end up
        on top regardless of how high we crank the value. Mounting the
        Toaster via a Portal to <body> puts it in the root stacking
        context where the z-index 9999 in index.css actually wins.
      */}
      {typeof document !== "undefined" &&
        createPortal(
          <Toaster
            position="top-right"
            theme={legacyInterface ? tweaks.theme : "dark"}
            closeButton
            richColors
          />,
          document.body,
        )}
    </div>
  );
}
