import { useState } from "react";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/components/icon";
import type { ServerConfig } from "@/lib/types";
import {
  defaultProviderLabel,
  effectiveDefaultProvider,
} from "@/lib/providers";
import logoUrl from "@/assets/logo.png";

export type ScreenId =
  | "generate"
  | "edit"
  | "history"
  | "providers"
  | "settings"
  | "mockups";

const NAV: { id: ScreenId; label: string; icon: IconName; kbd: string }[] = [
  { id: "generate", label: "生成", icon: "generate", kbd: "1" },
  { id: "edit", label: "编辑", icon: "edit", kbd: "2" },
  { id: "history", label: "任务", icon: "history", kbd: "3" },
  { id: "providers", label: "凭证", icon: "providers", kbd: "4" },
  { id: "settings", label: "设置", icon: "gear", kbd: "5" },
];

const MOCKUP_NAV: { id: ScreenId; label: string; icon: IconName; kbd: string }[] = [
  { id: "mockups", label: "液态预览", icon: "sparkle", kbd: "0" },
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
        "relative flex items-center gap-2.5 w-full h-9 px-2.5 rounded-md text-[13px] text-left transition-all duration-150",
        active
          ? "bg-white/[0.08] text-foreground font-semibold ring-1 ring-white/[0.08]"
          : hover
            ? "bg-white/[0.04] text-foreground font-medium"
            : "bg-transparent text-muted font-medium",
      )}
    >
      {active && (
        <span
          aria-hidden
          className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r-full"
          style={{ background: "var(--accent-gradient)" }}
        />
      )}
      <Icon
        name={item.icon}
        size={16}
        style={{ color: active ? "var(--accent)" : "var(--text-faint)" }}
      />
      <span className="flex-1">{item.label}</span>
      {runningBadge && (
        <span className="w-1.5 h-1.5 rounded-full bg-status-running animate-pulse-subtle shadow-[0_0_8px_rgba(251,191,36,0.6)]" />
      )}
      <span
        className="kbd"
        style={{
          opacity: active ? 1 : 0.6,
          background: active ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)",
        }}
      >
        ⌘{item.kbd}
      </span>
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
      className={cn(
        "relative w-[208px] xl:w-[224px] shrink-0 flex flex-col",
        "border-r border-border-faint",
        "bg-[rgba(10,10,14,0.55)]",
      )}
      style={{
        backdropFilter: "blur(18px) saturate(140%)",
        WebkitBackdropFilter: "blur(18px) saturate(140%)",
      }}
    >
      {/* faint top-edge highlight */}
      <span
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 right-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(255,255,255,0.10), transparent)",
        }}
      />

      <div className="h-14 px-4 flex items-center border-b border-border-faint">
        <div className="flex items-center gap-2">
          <img
            src={logoUrl}
            alt=""
            className="h-8 w-8 shrink-0 rounded-md object-contain shadow-md ring-1 ring-white/10"
            draggable={false}
          />
          <div className="leading-tight">
            <div className="text-[13px] font-semibold tracking-tight">
              GPT Image 2
            </div>
            <div className="text-[10.5px] text-faint">v0.2.5</div>
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
              (running?.generate &&
                (item.id === "generate" || item.id === "history")) ||
              (running?.edit && (item.id === "edit" || item.id === "history"))
            }
          />
        ))}
      </div>

      <div className="px-2 pt-4 flex flex-col gap-0.5">
        <div className="t-caps px-2.5 py-1.5">实验</div>
        {MOCKUP_NAV.map((item) => (
          <SidebarItem
            key={item.id}
            item={item}
            active={screen === item.id}
            onClick={() => setScreen(item.id)}
          />
        ))}
      </div>

      <div className="flex-1" />

      <div className="border-t border-border-faint p-3">
        <div className="t-caps mb-1.5">默认凭证</div>
        <div
          className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-border"
          style={{
            background: "rgba(255,255,255,0.03)",
          }}
        >
          <div
            className="h-6 w-6 shrink-0 rounded-md flex items-center justify-center"
            style={{
              background:
                "linear-gradient(135deg, rgba(167,139,250,0.30), rgba(103,232,249,0.20))",
              border: "1px solid rgba(167,139,250,0.35)",
            }}
          >
            <Icon name="cpu" size={12} style={{ color: "var(--accent)" }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-semibold truncate">
              {defaultName}
            </div>
            <div className="text-[10.5px] text-faint font-mono truncate">
              {defaultProv?.model ?? "—"}
            </div>
          </div>
          <Icon name="check" size={12} style={{ color: "var(--accent)" }} />
        </div>
      </div>
    </div>
  );
}
