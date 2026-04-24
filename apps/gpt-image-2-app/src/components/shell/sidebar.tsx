import { useState } from "react";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/components/icon";
import type { ServerConfig } from "@/lib/types";
import { defaultProviderLabel, effectiveDefaultProvider } from "@/lib/providers";
import logoUrl from "@/assets/logo.png";

export type ScreenId = "generate" | "edit" | "history" | "providers";

const NAV: { id: ScreenId; label: string; icon: IconName; kbd: string }[] = [
  { id: "generate", label: "生成", icon: "generate", kbd: "1" },
  { id: "edit", label: "编辑", icon: "edit", kbd: "2" },
  { id: "history", label: "历史与队列", icon: "history", kbd: "3" },
  { id: "providers", label: "服务商", icon: "providers", kbd: "4" },
];

function SidebarItem({
  item,
  active,
  onClick,
  runningBadge,
}: {
  item: { id: ScreenId; label: string; icon: IconName; kbd: string };
  active: boolean;
  onClick: () => void;
  runningBadge?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={cn(
        "flex items-center gap-2.5 w-full h-8 px-2.5 rounded-md text-[13px] text-left transition-colors",
        active ? "bg-pressed text-foreground font-semibold" : hover ? "bg-hover text-muted font-medium" : "bg-transparent text-muted font-medium"
      )}
    >
      <Icon name={item.icon} size={16} style={{ color: active ? "var(--accent)" : "var(--text-faint)" }} />
      <span className="flex-1">{item.label}</span>
      {runningBadge && (
        <span
          className="w-1.5 h-1.5 rounded-full bg-status-running animate-pulse-subtle"
        />
      )}
      <span className="kbd" style={{ opacity: active ? 1 : 0.6 }}>⌘{item.kbd}</span>
    </button>
  );
}

export function Sidebar({
  screen,
  setScreen,
  config,
  running,
}: {
  screen: ScreenId;
  setScreen: (s: ScreenId) => void;
  config?: ServerConfig;
  running?: { generate: boolean; edit: boolean };
}) {
  const defaultName = defaultProviderLabel(config);
  const defaultProv = config?.providers[effectiveDefaultProvider(config)];

  return (
    <div
      className="w-[208px] shrink-0 flex flex-col bg-sunken border-r border-border xl:w-[224px]"
    >
      <div className="h-14 px-4 flex items-center border-b border-border-faint">
        <div className="flex items-center gap-2">
          <img
            src={logoUrl}
            alt=""
            className="h-8 w-8 shrink-0 rounded-md object-contain shadow-sm"
            draggable={false}
          />
          <div className="leading-tight">
            <div className="text-[13px] font-semibold">GPT Image 2</div>
            <div className="text-[10.5px] text-faint">v0.2.4</div>
          </div>
        </div>
      </div>

      <div className="px-2 pt-3 flex flex-col gap-0.5">
        <div className="t-caps px-2.5 py-1.5">工作台</div>
        {NAV.map((item) => (
          <SidebarItem
            key={item.id}
            item={item}
            active={screen === item.id}
            onClick={() => setScreen(item.id)}
            runningBadge={
              (running?.generate && (item.id === "generate" || item.id === "history")) ||
              (running?.edit && (item.id === "edit" || item.id === "history"))
            }
          />
        ))}
      </div>

      <div className="flex-1" />

      <div className="border-t border-border p-3">
        <div className="t-caps mb-1.5">默认服务商</div>
        <div className="flex items-center gap-2 px-2 py-1.5 bg-raised border border-border rounded-md">
          <Icon name="cpu" size={14} style={{ color: "var(--accent)" }} />
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-semibold truncate">{defaultName}</div>
            <div className="text-[10.5px] text-faint font-mono">{defaultProv?.model ?? "—"}</div>
          </div>
          <Icon name="check" size={12} style={{ color: "var(--accent)" }} />
        </div>
      </div>
    </div>
  );
}
