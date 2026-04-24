import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useCallback,
  useState,
} from "react";
import { Toaster } from "sonner";
import { Button } from "@/components/ui/button";
import { CommandPalette } from "@/components/command-palette";
import { AppToolbar } from "@/components/shell/toolbar";
import { Sidebar, type ScreenId } from "@/components/shell/sidebar";
import { TweaksPanel } from "@/components/tweaks-panel";
import { WindowChrome } from "@/components/shell/window-chrome";
import { GenerateScreen } from "@/components/screens/generate";
import { EditScreen } from "@/components/screens/edit";
import { HistoryScreen } from "@/components/screens/history";
import { ProvidersScreen } from "@/components/screens/providers";
import { useConfig } from "@/hooks/use-config";
import { useJobNotifications } from "@/hooks/use-job-notifications";
import { useJobs } from "@/hooks/use-jobs";
import { useGlobalShortcuts } from "@/hooks/use-shortcuts";
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
        <div className="t-h2 text-foreground">界面出现异常</div>
        <div className="max-w-[420px] text-[13px] text-muted">
          {this.state.error.message ||
            "这个屏幕遇到了未知错误。已经停止渲染,以免影响其他功能。"}
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
          重新加载这个屏幕
        </Button>
      </div>
    );
  }
}

function readInitialScreen(): ScreenId {
  try {
    const s = localStorage.getItem("gpt2.screen");
    if (
      s === "generate" ||
      s === "edit" ||
      s === "history" ||
      s === "providers"
    )
      return s;
  } catch {
    /* ignore */
  }
  return "generate";
}

const TITLES: Record<ScreenId, { title: string; subtitle: string }> = {
  generate: { title: "图像生成", subtitle: "写提示词，生成候选并保存图片" },
  edit: { title: "图像编辑", subtitle: "上传参考图、涂抹遮罩、描述变更" },
  history: { title: "历史与图库", subtitle: "查看、保存和管理生成过的图片" },
  providers: { title: "服务商", subtitle: "管理生成图片时使用的服务" },
};

export default function App() {
  const [screen, setScreenState] = useState<ScreenId>(readInitialScreen);
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const {
    data: config,
    error: configError,
    refetch: refetchConfig,
  } = useConfig();
  const { data: jobs } = useJobs();

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
    onCommand: () => setPaletteOpen(true),
    onScreen: (s) => setScreen(s as ScreenId),
  });
  useJobNotifications(jobs, openJob);

  const active = (job: { status: string }) =>
    job.status === "running" || job.status === "queued";
  const running = {
    generate:
      jobs?.some((job) => active(job) && job.command === "images generate") ??
      false,
    edit:
      jobs?.some((job) => active(job) && job.command === "images edit") ??
      false,
  };
  const meta = TITLES[screen];

  return (
    <div className="desktop">
      <WindowChrome>
        <div className="relative flex h-full w-full">
          <Sidebar
            screen={screen}
            setScreen={setScreen}
            config={config}
            running={running}
          />
          <div className="flex-1 min-w-0 flex flex-col relative overflow-hidden">
            <AppToolbar
              title={meta.title}
              subtitle={meta.subtitle}
              onOpenCommand={() => setPaletteOpen(true)}
              actions={
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    icon="gear"
                    onClick={() => setTweaksOpen((o) => !o)}
                    aria-label="外观与偏好设置"
                    aria-pressed={tweaksOpen}
                    aria-expanded={tweaksOpen}
                    data-tweaks-toggle
                  />
                  <Button
                    variant="solidDark"
                    size="md"
                    icon="sparkle"
                    onClick={() => setScreen("generate")}
                  >
                    新建生成
                  </Button>
                </>
              }
            />
            <main
              id="main"
              role="main"
              aria-label={meta.title}
              className="flex-1 min-h-0 relative"
            >
              <div key={screen} className="animate-fade-in h-full">
                <ScreenErrorBoundary onReset={() => setScreenState(screen)}>
                  {screen === "generate" && (
                    <GenerateScreen
                      config={config}
                      onOpenEdit={() => setScreen("edit")}
                    />
                  )}
                  {screen === "edit" && <EditScreen config={config} />}
                  {screen === "history" && <HistoryScreen />}
                  {screen === "providers" && (
                    <ProvidersScreen config={config} />
                  )}
                </ScreenErrorBoundary>
              </div>
              <TweaksPanel
                visible={tweaksOpen}
                onClose={() => setTweaksOpen(false)}
              />
            </main>
          </div>
          <CommandPalette
            open={paletteOpen}
            onClose={() => setPaletteOpen(false)}
            setScreen={setScreen}
            latestJob={jobs?.[0]}
          />
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
          <Toaster
            position="top-right"
            closeButton
            richColors
            toastOptions={{
              style: {
                background: "var(--bg-raised)",
                border: "1px solid var(--border)",
                color: "var(--text)",
              },
            }}
          />
        </div>
      </WindowChrome>
    </div>
  );
}
