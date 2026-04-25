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
import { TopNav } from "@/components/shell/top-nav";
import { WindowChrome } from "@/components/shell/window-chrome";
import { type ScreenId, isScreenId } from "@/components/shell/screens";
import { GenerateScreen } from "@/components/screens/generate";
import { EditScreen } from "@/components/screens/edit";
import { HistoryScreen } from "@/components/screens/history";
import { SettingsScreen } from "@/components/screens/settings";
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
    onScreen: (s) => {
      if (isScreenId(s)) setScreen(s);
    },
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

  return (
    <div className="desktop">
      <WindowChrome>
        <div className="relative flex h-full w-full flex-col">
          <TopNav
            screen={screen}
            setScreen={setScreen}
            config={config}
            running={running}
            onOpenCommand={() => setPaletteOpen(true)}
          />

          <main
            id="main"
            role="main"
            className="flex-1 min-h-0 relative"
            aria-label={screen}
          >
            <div key={screen} className="animate-fade-in h-full">
              <ScreenErrorBoundary onReset={() => setScreenState(screen)}>
                {screen === "generate" && (
                  <GenerateScreen
                    config={config}
                    onOpenEdit={() => setScreen("edit")}
                    onOpenHistory={() => setScreen("history")}
                  />
                )}
                {screen === "edit" && <EditScreen config={config} />}
                {screen === "history" && <HistoryScreen />}
                {screen === "settings" && <SettingsScreen config={config} />}
              </ScreenErrorBoundary>
            </div>
          </main>

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
            theme="dark"
            closeButton
            richColors
          />
        </div>
      </WindowChrome>
    </div>
  );
}
