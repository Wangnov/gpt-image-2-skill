import {
  KeyRound,
  Cpu,
  ListChecks,
  Keyboard,
  Info,
  Eye,
  MoreVertical,
  Plus,
  FileCog,
} from "lucide-react";
import { LiquidShell } from "./_shared/liquid-shell";
import { GlassButton, GlassPanel } from "./_shared/glass";

const NAV = [
  { id: "creds", label: "凭证配置", icon: KeyRound, active: true },
  { id: "model", label: "模型设置", icon: Cpu },
  { id: "queue", label: "队列设置", icon: ListChecks },
  { id: "kbd", label: "快捷键", icon: Keyboard },
  { id: "about", label: "关于", icon: Info },
];

type Cred = {
  id: string;
  name: string;
  sub: string;
  badge?: "current" | null;
  cta: "edit" | "use";
  icon: "openai" | "azure" | "custom";
  detail?: { baseUrl?: string; apiKey?: string };
};

const CREDS: Cred[] = [
  {
    id: "openai",
    name: "OpenAI",
    sub: "sk-•••••••••••••••••",
    badge: "current",
    cta: "edit",
    icon: "openai",
  },
  {
    id: "azure",
    name: "Azure OpenAI",
    sub: "sk-•••••••••••••••••",
    badge: null,
    cta: "use",
    icon: "azure",
  },
  {
    id: "custom",
    name: "自定义（OpenAI 兼容）",
    sub: "",
    badge: null,
    cta: "use",
    icon: "custom",
    detail: {
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-•••••••••••••••••",
    },
  },
];

function CredIcon({ kind }: { kind: Cred["icon"] }) {
  if (kind === "openai") {
    return (
      <div className="h-9 w-9 shrink-0 rounded-lg bg-white/[.08] border border-white/[.10] flex items-center justify-center">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" className="text-white opacity-90">
          <path
            d="M22.28 9.82a5.85 5.85 0 0 0-.5-4.81 5.93 5.93 0 0 0-6.4-2.84A5.93 5.93 0 0 0 4.7 4.74 5.85 5.85 0 0 0 .8 7.58a5.92 5.92 0 0 0 .73 6.93 5.85 5.85 0 0 0 .5 4.82 5.93 5.93 0 0 0 6.39 2.84 5.85 5.85 0 0 0 4.41 1.96 5.93 5.93 0 0 0 5.65-4.1 5.85 5.85 0 0 0 3.9-2.84 5.92 5.92 0 0 0-.74-6.93Z"
            stroke="currentColor"
            strokeWidth="1.4"
          />
        </svg>
      </div>
    );
  }
  if (kind === "azure") {
    return (
      <div className="h-9 w-9 shrink-0 rounded-lg bg-gradient-to-br from-sky-500/40 to-cyan-400/30 border border-sky-300/30 flex items-center justify-center">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
          <path d="M7 18l4-13 6 13H7Z" fill="white" fillOpacity=".9" />
          <path d="M11 5l6 13H7l4-13Z" fill="white" fillOpacity=".5" />
        </svg>
      </div>
    );
  }
  return (
    <div className="h-9 w-9 shrink-0 rounded-lg bg-white/[.08] border border-white/[.10] flex items-center justify-center">
      <FileCog size={16} className="text-white opacity-85" />
    </div>
  );
}

export function SettingsMockup() {
  return (
    <LiquidShell preset="amethyst">
      <div className="relative h-full w-full pt-20 pb-6 px-6 grid grid-cols-[200px_minmax(0,1fr)] gap-5">
        {/* left nav */}
        <div className="flex flex-col gap-2">
          <div className="px-2 pt-1 pb-2">
            <div className="text-[20px] font-semibold tracking-tight text-on-glass">
              设置
            </div>
          </div>
          <GlassPanel variant="default" className="flex flex-col p-1.5 gap-0.5">
            {NAV.map((n) => {
              const Icon = n.icon;
              return (
                <button
                  key={n.id}
                  className={
                    n.active
                      ? "flex items-center gap-2.5 h-9 px-3 rounded-md bg-white/[.10] border border-white/[.10] text-[13px] text-on-glass"
                      : "flex items-center gap-2.5 h-9 px-3 rounded-md border border-transparent text-[13px] text-on-glass-mute hover:text-on-glass hover:bg-white/[.05] transition-colors"
                  }
                >
                  <Icon size={14} className="opacity-80" />
                  <span>{n.label}</span>
                </button>
              );
            })}
          </GlassPanel>
        </div>

        {/* right content */}
        <GlassPanel
          variant="default"
          className="overflow-hidden flex flex-col"
        >
          {/* header */}
          <div className="px-6 pt-5 pb-4 border-b border-white/[.06]">
            <div className="text-[16px] font-semibold text-on-glass">
              凭证配置
            </div>
            <div className="text-[12px] text-on-glass-mute mt-0.5">
              配置用于图像生成的供应商和 API Key
            </div>
          </div>

          {/* cards */}
          <div className="flex-1 min-h-0 overflow-auto p-4 space-y-2.5">
            {CREDS.map((c) => (
              <div
                key={c.id}
                className="glass-row flex items-center gap-3 px-3.5 py-3 rounded-xl"
              >
                <CredIcon kind={c.icon} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-on-glass">
                      {c.name}
                    </span>
                    {c.badge === "current" && (
                      <span
                        className="text-[10.5px] font-medium tracking-wide"
                        style={{ color: "#86efac" }}
                      >
                        当前使用
                      </span>
                    )}
                  </div>
                  {c.detail ? (
                    <div className="mt-1 space-y-0.5">
                      {c.detail.baseUrl && (
                        <div className="text-[11.5px] text-on-glass-mute">
                          <span className="text-on-glass-faint">Base URL </span>
                          <span className="font-mono">{c.detail.baseUrl}</span>
                        </div>
                      )}
                      {c.detail.apiKey && (
                        <div className="text-[11.5px] text-on-glass-mute flex items-center gap-2">
                          <span className="text-on-glass-faint">API Key </span>
                          <span className="font-mono">{c.detail.apiKey}</span>
                          <Eye size={12} className="opacity-50" />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="mt-1 text-[11.5px] text-on-glass-mute flex items-center gap-2">
                      <span className="text-on-glass-faint">API Key </span>
                      <span className="font-mono">{c.sub}</span>
                      <Eye size={12} className="opacity-50" />
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  <GlassButton size="sm">
                    {c.cta === "edit" ? "编辑" : "使用"}
                  </GlassButton>
                  <button className="h-8 w-8 inline-flex items-center justify-center rounded-md text-on-glass-mute hover:text-on-glass hover:bg-white/[.06] transition-colors">
                    <MoreVertical size={14} />
                  </button>
                </div>
              </div>
            ))}

            {/* add credential */}
            <button
              type="button"
              className="w-full glass-row flex items-center justify-center gap-2 h-12 rounded-xl text-[13px] text-on-glass-mute hover:text-on-glass border-dashed transition-colors"
              style={{ borderStyle: "dashed", borderColor: "rgba(255,255,255,.14)" }}
            >
              <Plus size={15} />
              添加凭证
            </button>
          </div>
        </GlassPanel>
      </div>
    </LiquidShell>
  );
}
