import { Icon, type IconName } from "@/components/icon";
import { ClassicEditScreen } from "@/components/legacy/classic-edit";
import { ClassicGenerateScreen } from "@/components/legacy/classic-generate";
import { ClassicHistoryScreen } from "@/components/legacy/classic-history";
import { SettingsScreen } from "@/components/screens/settings";
import { Button } from "@/components/ui/button";
import { useTweaks } from "@/hooks/use-tweaks";
import { cn } from "@/lib/cn";
import {
  defaultProviderLabel,
  effectiveDefaultProvider,
} from "@/lib/providers";
import type { ScreenId } from "@/components/shell/screens";
import type { ServerConfig } from "@/lib/types";
import logoUrl from "@/assets/logo.png";

const NAV: { id: ScreenId; label: string; icon: IconName; kbd: string }[] = [
  { id: "generate", label: "生成", icon: "generate", kbd: "1" },
  { id: "edit", label: "编辑", icon: "edit", kbd: "2" },
  { id: "history", label: "任务", icon: "history", kbd: "3" },
  { id: "settings", label: "设置", icon: "gear", kbd: "4" },
];

const TITLES: Record<ScreenId, { title: string; subtitle: string }> = {
  generate: { title: "图像生成", subtitle: "写提示词，生成候选并保存图片" },
  edit: { title: "图像编辑", subtitle: "上传参考图、粘贴图片、局部涂抹并提交编辑" },
  history: { title: "任务", subtitle: "查看正在运行、已完成和失败的生成记录" },
  settings: { title: "设置", subtitle: "凭证、外观、任务与通知偏好" },
};

function SidebarItem({
  item,
  active,
  running,
  onClick,
}: {
  item: (typeof NAV)[number];
  active: boolean;
  running?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] transition-colors",
        active
          ? "bg-[color:var(--w-08)] font-semibold text-foreground ring-1 ring-[color:var(--w-08)]"
          : "text-muted hover:bg-[color:var(--w-04)] hover:text-foreground",
      )}
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute bottom-1.5 left-0 top-1.5 w-[2px] rounded-r-full"
          style={{ background: "var(--accent-gradient)" }}
        />
      )}
      <Icon
        name={item.icon}
        size={16}
        style={{ color: active ? "var(--accent)" : "var(--text-faint)" }}
      />
      <span className="flex-1">{item.label}</span>
      {running ? (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[color:var(--status-running-bg)] px-1 font-mono text-[10px] text-[color:var(--status-running)]">
          {running}
        </span>
      ) : null}
      <span className="kbd opacity-65">⌘{item.kbd}</span>
    </button>
  );
}

function ClassicSidebar({
  screen,
  setScreen,
  config,
  running,
}: {
  screen: ScreenId;
  setScreen: (screen: ScreenId) => void;
  config?: ServerConfig;
  running: { generate: number; edit: number; total: number };
}) {
  const defaultName = defaultProviderLabel(config);
  const defaultProvider = config?.providers[effectiveDefaultProvider(config)];

  return (
    <aside className="classic-sidebar flex w-[224px] shrink-0 flex-col border-r border-border-faint bg-[rgba(10,10,14,0.72)]">
      <div
        data-tauri-drag-region
        className="flex h-[88px] items-end border-b border-border-faint px-4 pb-4 pt-9"
      >
        <div data-tauri-drag-region className="flex min-w-0 items-center gap-2">
          <img
            data-tauri-drag-region
            src={logoUrl}
            alt=""
            className="h-8 w-8 shrink-0 rounded-md object-contain shadow-md ring-1 ring-white/10"
            draggable={false}
          />
          <div data-tauri-drag-region className="min-w-0 leading-tight">
            <div data-tauri-drag-region className="truncate text-[13px] font-semibold tracking-tight">
              GPT Image 2
            </div>
            <div data-tauri-drag-region className="text-[10.5px] text-faint">
              经典工作台
            </div>
          </div>
        </div>
      </div>

      <nav className="flex flex-col gap-0.5 px-2 pt-3" aria-label="经典导航">
        <div className="t-caps px-2.5 py-1.5">工作台</div>
        {NAV.map((item) => (
          <SidebarItem
            key={item.id}
            item={item}
            active={screen === item.id}
            running={
              item.id === "generate"
                ? running.generate
                : item.id === "edit"
                  ? running.edit
                  : item.id === "history"
                    ? running.total
                    : 0
            }
            onClick={() => setScreen(item.id)}
          />
        ))}
      </nav>

      <div className="flex-1" />

      <div className="border-t border-border-faint p-3">
        <div className="t-caps mb-1.5">默认凭证</div>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-[color:var(--w-04)] px-2.5 py-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[color:var(--accent-30)] bg-[color:var(--accent-10)]">
            <Icon name="cpu" size={12} style={{ color: "var(--accent)" }} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-semibold">
              {defaultName}
            </div>
            <div className="truncate font-mono text-[10.5px] text-faint">
              {defaultProvider?.model ?? "—"}
            </div>
          </div>
          <Icon name="check" size={12} style={{ color: "var(--accent)" }} />
        </div>
      </div>
    </aside>
  );
}

function ClassicToolbar({
  screen,
  setScreen,
}: {
  screen: ScreenId;
  setScreen: (screen: ScreenId) => void;
}) {
  const meta = TITLES[screen];
  const { tweaks, setTweaks } = useTweaks();
  const light = tweaks.theme === "light";
  return (
    <header
      data-tauri-drag-region
      className="classic-toolbar relative flex h-14 shrink-0 items-center gap-2.5 border-b border-border-faint bg-[rgba(10,10,14,0.64)] px-4 xl:px-5"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 left-0 right-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(255,255,255,0.07) 12%, rgba(255,255,255,0.07) 88%, transparent)",
        }}
      />
      <div data-tauri-drag-region className="min-w-0 flex-1">
        <div data-tauri-drag-region className="t-h2 truncate text-foreground tracking-tight">
          {meta.title}
        </div>
        <div data-tauri-drag-region className="t-small mt-px hidden truncate lg:block">
          {meta.subtitle}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        icon={light ? "moon" : "sun"}
        onClick={() => setTweaks({ theme: light ? "dark" : "light" })}
        aria-label={light ? "切换到暗色主题" : "切换到亮色主题"}
      />
      <Button
        variant="solidDark"
        size="md"
        icon="sparkle"
        onClick={() => setScreen("generate")}
      >
        新建生成
      </Button>
    </header>
  );
}

export function ClassicShell({
  screen,
  setScreen,
  config,
  running,
}: {
  screen: ScreenId;
  setScreen: (screen: ScreenId) => void;
  config?: ServerConfig;
  running: { generate: number; edit: number; total: number };
}) {
  return (
    <div className="classic-workbench flex h-full w-full overflow-hidden">
      <ClassicSidebar
        screen={screen}
        setScreen={setScreen}
        config={config}
        running={running}
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <ClassicToolbar screen={screen} setScreen={setScreen} />
        <main
          id="main"
          role="main"
          aria-label={TITLES[screen].title}
          className="min-h-0 flex-1 overflow-hidden"
        >
          {screen === "generate" && (
            <ClassicGenerateScreen
              config={config}
              onOpenEdit={() => setScreen("edit")}
              onOpenHistory={() => setScreen("history")}
            />
          )}
          {screen === "edit" && <ClassicEditScreen config={config} />}
          {screen === "history" && (
            <ClassicHistoryScreen
              onSwitchToGenerate={() => setScreen("generate")}
            />
          )}
          {screen === "settings" && <SettingsScreen config={config} />}
        </main>
      </div>
    </div>
  );
}
