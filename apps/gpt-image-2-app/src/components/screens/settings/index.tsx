import { type ReactNode, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  KeyRound,
  Sparkles,
  ListChecks,
  Info,
  Plus,
  Pencil,
  Play,
  Trash2,
  Check,
  Loader2,
  X,
  Eye,
  FileText,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Segmented } from "@/components/ui/segmented";
import { Toggle } from "@/components/ui/toggle";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/hooks/use-confirm";
import { Empty } from "@/components/ui/empty";
import { Tooltip } from "@/components/ui/tooltip";
import { Icon } from "@/components/icon";
import { useTweaks } from "@/hooks/use-tweaks";
import { useQueueStatus } from "@/hooks/use-jobs";
import {
  useDeleteProvider,
  useSetDefaultProvider,
  useTestProvider,
} from "@/hooks/use-config";
import {
  checkForAppUpdate,
  installAppUpdate,
  type AppUpdateInfo,
} from "@/lib/app-updater";
import { api, type ConfigPaths } from "@/lib/api";
import { clearCreativeDrafts } from "@/lib/drafts";
import { copyText, openPath, revealPath } from "@/lib/user-actions";
import { isDesktopRuntime, runtimeCopy } from "@/lib/runtime-copy";
import { effectiveDefaultProvider } from "@/lib/providers";
import { AddProviderDialog } from "@/components/screens/providers/add-provider-dialog";
import { PromptTemplatesPanel } from "@/components/screens/settings/prompt-templates-panel";
import { ProviderLogo } from "@/components/provider-logo";
import type { ProviderConfig, ServerConfig } from "@/lib/types";
import {
  HIDDEN_PRESETS,
  THEME_PRESETS,
  readUnlockedPresets,
  unlockPreset,
  type ThemePreset,
  type ThemePresetId,
} from "@/lib/theme-presets";
import ScrambleText from "@/components/reactbits/text/ScrambleText";
import ElasticSlider from "@/components/reactbits/components/ElasticSlider";
import { cn } from "@/lib/cn";
import { credentialSecretDisplay } from "@/lib/credential-display";

// Visible preset order in the Appearance gallery. Hidden presets join
// at the tail once unlocked (see HIDDEN_PRESETS).
const PRESET_ORDER: ThemePresetId[] = [
  "logo-grainient",
  "liquid-violet",
  "plasma-sunset",
  "beams-cyan",
  "mesh-mono",
];

const FONT_LABEL: Record<ThemePreset["suggestedFont"], string> = {
  system: "系统",
  mono: "等宽",
  serif: "衬线",
};

const DENSITY_LABEL: Record<ThemePreset["suggestedDensity"], string> = {
  compact: "紧凑",
  comfortable: "舒适",
};

/** Custom event emitted when AboutPanel unlocks a hidden preset, so
 *  AppearancePanel can re-read the localStorage-backed unlock set
 *  without prop-drilling or context. */
const UNLOCK_EVENT = "gpt2:unlocks";

type SettingsTab = "creds" | "appearance" | "runtime" | "prompts" | "about";

const NAV: { id: SettingsTab; label: string; icon: LucideIcon }[] = [
  { id: "creds", label: "凭证", icon: KeyRound },
  { id: "appearance", label: "外观", icon: Sparkles },
  { id: "runtime", label: "任务", icon: ListChecks },
  { id: "prompts", label: "模板", icon: FileText },
  { id: "about", label: "关于", icon: Info },
];

const PARALLEL_OPTIONS = [1, 2, 3, 4, 6, 8].map((n) => ({
  value: String(n),
  label: String(n),
}));

const TAB_TITLES: Record<SettingsTab, { title: string; subtitle: string }> = {
  creds: {
    title: "凭证配置",
    subtitle: "管理用于图像生成的供应商和 API Key",
  },
  appearance: {
    title: "外观",
    subtitle: "液态背景、字体与界面密度",
  },
  runtime: {
    title: "任务",
    subtitle: "并发上限和任务结束提示",
  },
  prompts: {
    title: "提示词模板",
    subtitle: "管理可复用的生成和编辑提示词",
  },
  about: {
    title: "关于 / 更新",
    subtitle: "版本、更新和数据位置",
  },
};

/* ── Layout primitives (panel-internal) ─────────────────── */

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section
      className="rounded-xl overflow-hidden border border-border-faint"
      style={{ background: "var(--w-02)" }}
    >
      {(title || description) && (
        <header className="border-b border-border-faint px-4 py-3 sm:px-5">
          <div className="t-h3">{title}</div>
          {description && (
            <div className="mt-0.5 text-[12px] text-muted">{description}</div>
          )}
        </header>
      )}
      <div className="divide-y divide-border-faint">{children}</div>
    </section>
  );
}

function Row({
  title,
  description,
  control,
}: {
  title: string;
  description?: ReactNode;
  control: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-foreground">{title}</div>
        {description && (
          <div className="mt-0.5 text-[11.5px] text-muted">{description}</div>
        )}
      </div>
      <div className="w-full min-w-0 sm:w-auto sm:shrink-0">{control}</div>
    </div>
  );
}

function PathRow({
  title,
  path,
  isFolder,
}: {
  title: string;
  path?: string;
  isFolder?: boolean;
}) {
  // Bumping this trigger replays the ScrambleText reveal — used as a
  // visual receipt that "the value you just copied is the value you
  // see right now", catching cases where the user might have stale
  // path text in their clipboard.
  const [copyTrigger, setCopyTrigger] = useState(0);
  return (
    <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-foreground">{title}</div>
        <div
          className="mt-0.5 truncate font-mono text-[11px] text-faint"
          title={path ?? undefined}
        >
          <ScrambleText
            text={path ?? "—"}
            trigger={copyTrigger}
            duration={520}
          />
        </div>
      </div>
      <div className="flex shrink-0 gap-0.5 self-end sm:self-auto">
        <Button
          variant="ghost"
          size="iconSm"
          icon="folder"
          disabled={!path || !api.canUseLocalFiles}
          onClick={() => {
            if (!path) return;
            if (isFolder) void openPath(path);
            else void revealPath(path);
          }}
          title={isFolder ? "打开目录" : "在访达中显示"}
          aria-label={isFolder ? "打开目录" : "在访达中显示"}
        />
        <Button
          variant="ghost"
          size="iconSm"
          icon="copy"
          disabled={!path}
          onClick={() => {
            if (!path) return;
            void copyText(path, "路径");
            setCopyTrigger((n) => n + 1);
          }}
          title="复制路径"
          aria-label="复制路径"
        />
      </div>
    </div>
  );
}

/* ── Left nav ─────────────────────────────────────────── */

function SettingsNav({
  tab,
  setTab,
}: {
  tab: SettingsTab;
  setTab: (t: SettingsTab) => void;
}) {
  return (
    <aside className="flex min-w-0 shrink-0 flex-col gap-2">
      <div className="px-2 pt-1 pb-1 sm:pb-2">
        <div className="t-title text-foreground">设置</div>
      </div>
      <div className="surface-panel flex gap-1.5 overflow-x-auto p-1.5 scrollbar-none [mask-image:linear-gradient(to_right,black_calc(100%-32px),transparent_100%)] md:flex-col md:gap-0.5 md:overflow-visible md:[mask-image:none]">
        {NAV.map((n) => {
          const I = n.icon;
          const active = n.id === tab;
          return (
            <button
              key={n.id}
              type="button"
              onClick={() => setTab(n.id)}
              className={cn(
                "flex h-9 shrink-0 items-center gap-2.5 rounded-md px-3 text-left text-[13px] transition-colors md:w-full",
                active
                  ? "bg-[color:var(--w-10)] text-foreground border border-[color:var(--w-10)]"
                  : "border border-transparent text-muted hover:text-foreground hover:bg-[color:var(--w-05)]",
              )}
            >
              <I size={14} className="opacity-80" />
              <span className="flex-1">{n.label}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

/* ── Panel header (inside the right surface) ──────────── */

function PanelHeader({ tab }: { tab: SettingsTab }) {
  const copy = runtimeCopy();
  const meta =
    tab === "about"
      ? {
          title: TAB_TITLES.about.title,
          subtitle:
            copy.kind === "tauri"
              ? "桌面端更新、本地配置和数据路径"
              : copy.kind === "http"
                ? "Web 版本、部署更新和服务端数据"
                : "静态 Web 版本和浏览器数据",
        }
      : TAB_TITLES[tab];
  return (
    <header className="border-b border-border-faint px-4 pb-3 pt-4 sm:px-6 sm:pb-4 sm:pt-5">
      <div className="t-h2">{meta.title}</div>
      <div className="mt-0.5 text-[12px] text-muted">{meta.subtitle}</div>
    </header>
  );
}

/* ── Sub-panels ───────────────────────────────────────── */

/* ── CredIcon: visual marker per provider type ─────────────── */
function CredIcon({ kind }: { kind: ProviderConfig["type"] }) {
  return <ProviderLogo kind={kind} size="md" />;
}

type CredCardProps = {
  name: string;
  prov: ProviderConfig;
  isDefault: boolean;
  testStatus?: "idle" | "running" | "ok" | "err";
  onEdit: () => void;
  onUse: () => void;
  onTest: () => void;
  onDelete: () => void;
};

function CredCard({
  name,
  prov,
  isDefault,
  testStatus,
  onEdit,
  onUse,
  onTest,
  onDelete,
}: CredCardProps) {
  const confirm = useConfirm();
  // Surface a key value if any credential exposes a literal value.
  const apiKeyCredential = Object.values(prov.credentials ?? {}).find(
    (c) =>
      c?.source === "file" || c?.source === "env" || c?.source === "keychain",
  );
  const apiKeyDisplay = credentialSecretDisplay(apiKeyCredential);

  return (
    <div
      className={cn(
        "flex flex-wrap items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors",
        isDefault
          ? "border-[color:var(--accent-30)] bg-[color:var(--accent-04)]"
          : "border-border bg-[color:var(--w-04)] hover:bg-[color:var(--w-05)]",
      )}
    >
      <CredIcon kind={prov.type} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-semibold text-foreground">
            {name}
          </span>
          {isDefault && (
            <span
              className="text-[10.5px] font-medium tracking-wide"
              style={{ color: "var(--status-ok-soft)" }}
            >
              当前使用
            </span>
          )}
          <span className="t-caps">
            {prov.type === "openai-compatible"
              ? "OpenAI 兼容"
              : prov.type === "codex"
                ? "Codex"
                : "OpenAI"}
          </span>
        </div>
        <div className="mt-1 space-y-0.5">
          {prov.api_base && (
            <div className="text-[11.5px] text-muted">
              <span className="text-faint">Base URL </span>
              <span className="break-all font-mono">{prov.api_base}</span>
            </div>
          )}
          {apiKeyDisplay && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-muted">
              <span className="text-faint">API Key </span>
              <span className="font-mono">{apiKeyDisplay}</span>
              <Eye size={12} className="opacity-50" aria-hidden />
            </div>
          )}
          {prov.model && (
            <div className="text-[11px] text-faint font-mono">{prov.model}</div>
          )}
        </div>
      </div>

      <div className="flex w-full shrink-0 items-center justify-end gap-1 sm:w-auto">
        <Tooltip
          text={
            testStatus === "ok"
              ? "连接正常 · 重新测试"
              : testStatus === "err"
                ? "连接失败 · 重新测试"
                : "测试连接"
          }
        >
          <button
            type="button"
            onClick={onTest}
            disabled={testStatus === "running"}
            className="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted hover:text-foreground hover:bg-[color:var(--w-06)] transition-colors disabled:opacity-50"
            aria-label={`测试 ${name} 的连接`}
          >
            {testStatus === "running" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : testStatus === "ok" ? (
              <Check size={14} className="text-[color:var(--status-ok)]" />
            ) : testStatus === "err" ? (
              <X size={14} className="text-[color:var(--status-err)]" />
            ) : (
              <Play size={13} />
            )}
          </button>
        </Tooltip>
        <Tooltip text="编辑凭证">
          <button
            type="button"
            onClick={onEdit}
            className="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted hover:text-foreground hover:bg-[color:var(--w-06)] transition-colors"
            aria-label={`编辑 ${name}`}
          >
            <Pencil size={13} />
          </button>
        </Tooltip>
        {!isDefault && (
          <Tooltip text="设为默认凭证">
            <Button size="sm" onClick={onUse}>
              使用
            </Button>
          </Tooltip>
        )}
        <Tooltip text="删除凭证">
          <button
            type="button"
            onClick={async () => {
              const ok = await confirm({
                title: `删除凭证「${name}」`,
                description: "此操作无法撤销。",
                confirmText: "删除",
                variant: "danger",
              });
              if (ok) onDelete();
            }}
            className="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted hover:text-[color:var(--status-err)] hover:bg-[color:var(--status-err-10)] transition-colors"
            aria-label={`删除 ${name}`}
          >
            <Trash2 size={13} />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

function CredsPanel({ config }: { config?: ServerConfig }) {
  const providers = config?.providers ?? {};
  const names = Object.keys(providers);
  const effectiveDefault = effectiveDefaultProvider(config);
  const setDefault = useSetDefaultProvider();
  const deleteProv = useDeleteProvider();
  const test = useTestProvider();
  const [showAdd, setShowAdd] = useState(false);
  const [editingName, setEditingName] = useState<string | undefined>();
  const [testMap, setTestMap] = useState<
    Record<string, { status: "idle" | "running" | "ok" | "err" }>
  >({});

  const runTest = async (name: string) => {
    setTestMap((m) => ({ ...m, [name]: { status: "running" } }));
    try {
      const r = await test.mutateAsync(name);
      setTestMap((m) => ({
        ...m,
        [name]: { status: r.ok ? "ok" : "err" },
      }));
      if (r.ok)
        toast.success("连接正常", { description: `${name} 可以使用。` });
      else toast.error("连接失败", { description: r.message });
    } catch (e) {
      setTestMap((m) => ({ ...m, [name]: { status: "err" } }));
      toast.error("连接失败", { description: (e as Error).message });
    }
  };

  const makeDefault = async (name: string) => {
    try {
      await setDefault.mutateAsync(name);
      toast.success("默认凭证已更新", {
        description: `之后会优先使用 ${name}。`,
      });
    } catch (error) {
      toast.error("设置失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const removeProvider = async (name: string) => {
    try {
      await deleteProv.mutateAsync(name);
      toast.success("凭证已删除", { description: name });
    } catch (error) {
      toast.error("删除失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-auto p-4 sm:p-5">
      {names.length === 0 ? (
        <Empty
          icon="providers"
          title="还没有配置凭证"
          subtitle="支持 OpenAI / Azure / 自定义供应商。"
          action={
            <Button
              variant="primary"
              size="md"
              icon="plus"
              onClick={() => setShowAdd(true)}
            >
              添加凭证
            </Button>
          }
        />
      ) : (
        <div className="space-y-2.5">
          {names.map((name) => (
            <CredCard
              key={name}
              name={name}
              prov={providers[name]}
              isDefault={name === effectiveDefault}
              testStatus={testMap[name]?.status}
              onEdit={() => setEditingName(name)}
              onUse={() => makeDefault(name)}
              onTest={() => runTest(name)}
              onDelete={() => removeProvider(name)}
            />
          ))}
        </div>
      )}

      {names.length > 0 && (
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="mt-3 w-full flex items-center justify-center gap-2 h-12 rounded-xl text-[13px] text-muted hover:text-foreground transition-colors"
          style={{
            background: "var(--w-02)",
            border: "1px dashed var(--w-16)",
          }}
        >
          <Plus size={15} />
          添加凭证
        </button>
      )}

      <AddProviderDialog
        open={showAdd}
        onOpenChange={setShowAdd}
        existingNames={names}
      />
      <AddProviderDialog
        open={Boolean(editingName)}
        onOpenChange={(open) => {
          if (!open) setEditingName(undefined);
        }}
        existingNames={names}
        mode="edit"
        providerName={editingName}
        provider={editingName ? providers[editingName] : undefined}
      />
    </div>
  );
}

function ThemePreviewCard({
  preset,
  isActive,
  onSelect,
}: {
  preset: ThemePreset;
  isActive: boolean;
  onSelect: () => void;
}) {
  // Mini gradient preview is built from the preset's RGB triplets so
  // the card itself uses the colors it would apply when selected.
  // Three color dots mirror the accent / accent-2 / accent-3 swatches
  // that drive the alpha ramps in index.css.
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isActive}
      title={preset.description}
      className={cn(
        "group relative h-[88px] rounded-lg overflow-hidden text-left transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]",
        isActive
          ? "ring-2 ring-[color:var(--accent)] shadow-[0_0_24px_-6px_rgba(var(--accent-rgb),0.55)]"
          : "ring-1 ring-[color:var(--w-10)] hover:ring-[color:var(--w-20)] hover:scale-[1.015]",
      )}
    >
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background: `linear-gradient(135deg, rgba(${preset.accentRgb}, 0.42) 0%, rgba(${preset.accent2Rgb}, 0.36) 60%, rgba(${preset.accent3Rgb}, 0.30) 100%)`,
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0 opacity-30 mix-blend-overlay"
        style={{
          background:
            "radial-gradient(80% 60% at 50% 0%, rgba(255,255,255,0.18) 0%, transparent 70%)",
        }}
      />
      <div className="relative flex h-full flex-col justify-between p-2">
        <div className="flex items-center gap-1">
          {[preset.accentRgb, preset.accent2Rgb, preset.accent3Rgb].map(
            (rgb, i) => (
              <span
                key={i}
                className="h-2.5 w-2.5 rounded-full"
                style={{
                  background: `rgb(${rgb})`,
                  boxShadow: `0 0 6px rgba(${rgb}, 0.6)`,
                }}
              />
            ),
          )}
          <span className="ml-auto t-mono text-[9.5px] text-foreground/85">
            Aa
          </span>
        </div>
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-foreground truncate">
            {preset.displayName}
          </div>
          <div className="mt-0.5 text-[10px] text-foreground/60 truncate">
            {preset.description}
          </div>
        </div>
      </div>
      {isActive && (
        <span
          className="absolute top-1.5 right-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full"
          style={{ background: "var(--accent)" }}
          aria-label="当前主题"
        >
          <Check size={10} className="text-[color:var(--accent-on)]" />
        </span>
      )}
    </button>
  );
}

function AppearancePanel() {
  const { tweaks, setTweaks } = useTweaks();
  const [unlocked, setUnlocked] = useState<Set<ThemePresetId>>(() =>
    readUnlockedPresets(),
  );

  // Stay in sync with localStorage when AboutPanel unlocks a hidden
  // preset. Custom event keeps both panels coordinated without
  // lifting state into TweaksContext.
  useEffect(() => {
    const refresh = () => setUnlocked(readUnlockedPresets());
    window.addEventListener(UNLOCK_EVENT, refresh);
    return () => window.removeEventListener(UNLOCK_EVENT, refresh);
  }, []);

  const visibleIds: ThemePresetId[] = [
    ...PRESET_ORDER,
    ...HIDDEN_PRESETS.filter((id) => unlocked.has(id)),
  ];
  const activePreset = THEME_PRESETS[tweaks.themePreset];
  const modernInterface = tweaks.interfaceMode === "modern";

  const opacityHint =
    activePreset.surfaceStyle === "paper"
      ? "纸感主题下用作描边强度。值越高边线越清晰。"
      : activePreset.surfaceStyle === "neon"
        ? "霓虹主题下用作发光强度。值越高边光越明显。"
        : "玻璃面板的不透明度。值越低背景越能透出，值越高内容越易读。";

  return (
    <div className="flex-1 min-h-0 overflow-auto p-4 sm:p-5 space-y-4">
      <Section title="主题">
        <Row
          title="界面版本"
          description={
            tweaks.interfaceMode === "legacy"
              ? "经典三栏会复用旧工作台外观，并禁用常驻动态背景以降低资源占用。"
              : "现代界面使用主题背景、玻璃胶囊和作品墙；适合视觉调试。"
          }
          control={
            <Segmented
              value={tweaks.interfaceMode}
              onChange={(interfaceMode) => setTweaks({ interfaceMode })}
              size="sm"
              ariaLabel="界面版本"
              options={[
                { value: "modern", label: "现代" },
                { value: "legacy", label: "经典" },
              ]}
            />
          }
        />
        {modernInterface ? (
          <>
            <div className="space-y-2.5 px-4 py-3.5 sm:px-5">
              <div>
                <div className="text-[13px] font-semibold text-foreground">
                  主题预设
                </div>
                <div className="mt-0.5 text-[11.5px] text-muted">
                  一键切换背景动效、配色、面板风格；字体和密度也会跟着调到主题推荐值。想禁用所有动效，切到「网格灰」或在
                  macOS 辅助功能里开启「减弱动态效果」。
                </div>
              </div>
              <div
                className={cn(
                  "grid gap-2",
                  visibleIds.length <= 4
                    ? "grid-cols-2 lg:grid-cols-4"
                    : "grid-cols-2 lg:grid-cols-5",
                )}
              >
                {visibleIds.map((id) => (
                  <ThemePreviewCard
                    key={id}
                    preset={THEME_PRESETS[id]}
                    isActive={tweaks.themePreset === id}
                    onSelect={() => setTweaks({ themePreset: id })}
                  />
                ))}
              </div>
            </div>
            <Row
              title="面板透明度"
              description={opacityHint}
              control={
                <div className="w-[252px]">
                  <ElasticSlider
                    value={tweaks.glassOpacity}
                    min={5}
                    max={95}
                    step={1}
                    onChange={(glassOpacity) => setTweaks({ glassOpacity })}
                    valueSuffix="%"
                    ariaLabel="面板透明度"
                  />
                </div>
              }
            />
          </>
        ) : (
          <Row
            title="亮暗主题"
            description="只影响经典工作台；现代界面的主题仍由主题预设控制。"
            control={
              <Segmented
                value={tweaks.theme}
                onChange={(theme) => setTweaks({ theme })}
                size="sm"
                ariaLabel="经典亮暗主题"
                options={[
                  { value: "dark", label: "暗色" },
                  { value: "light", label: "亮色" },
                ]}
              />
            }
          />
        )}
      </Section>

      <Section
        title="排版"
        description="主题切换会把字体和密度调到推荐值；下面的设置会覆盖推荐。"
      >
        <Row
          title="字体"
          description={`主题推荐：${FONT_LABEL[activePreset.suggestedFont]}。`}
          control={
            <Segmented
              value={tweaks.font}
              onChange={(v) => setTweaks({ font: v })}
              size="sm"
              ariaLabel="字体"
              options={[
                { value: "system", label: "系统" },
                { value: "mono", label: "等宽" },
                { value: "serif", label: "衬线" },
              ]}
            />
          }
        />
        <Row
          title="界面密度"
          description={`主题推荐：${DENSITY_LABEL[activePreset.suggestedDensity]}。`}
          control={
            <Segmented
              value={tweaks.density}
              onChange={(v) => setTweaks({ density: v })}
              size="sm"
              ariaLabel="界面密度"
              options={[
                { value: "compact", label: "紧凑" },
                { value: "comfortable", label: "舒适" },
              ]}
            />
          }
        />
      </Section>
    </div>
  );
}

function RuntimePanel() {
  const { tweaks, setTweaks } = useTweaks();
  const copy = runtimeCopy();
  const { data: queue } = useQueueStatus();
  const running = queue?.running ?? 0;
  const queued = queue?.queued ?? 0;
  const queueSummary =
    running + queued === 0
      ? "目前没有任务在队列里"
      : `当前 ${running} 个在跑，${queued} 个排队`;
  const setDraftPersistence = async (enabled: boolean) => {
    setTweaks({ persistCreativeDrafts: enabled });
    if (enabled) return;
    try {
      await clearCreativeDrafts();
      toast.success("创作草稿已清除");
    } catch (error) {
      toast.error("清除草稿失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-auto p-4 sm:p-5 space-y-4">
      <Section
        title="队列"
        description="控制可以同时在跑的任务数量，避免一次性吃掉网络或 CPU。"
      >
        <Row
          title="并发上限"
          description={`同时最多跑几个任务。${queueSummary}。`}
          control={
            <Segmented
              value={String(tweaks.maxParallel)}
              onChange={(v) => setTweaks({ maxParallel: Number(v) })}
              size="sm"
              ariaLabel="并发上限"
              options={PARALLEL_OPTIONS}
            />
          }
        />
      </Section>

      <Section
        title="草稿"
        description="保留现代生成和编辑页的创作参数、参考图与遮罩。"
      >
        <Row
          title="保留创作草稿"
          description={
            copy.kind === "tauri"
              ? "开启后刷新页面或重启 App 仍会恢复现代页草稿；关闭会清理已保存草稿。"
              : "开启后刷新页面或重新打开同一浏览器仍会恢复现代页草稿；关闭会清理已保存草稿。"
          }
          control={
            <Toggle
              checked={tweaks.persistCreativeDrafts}
              onChange={(v) => void setDraftPersistence(v)}
            />
          }
        />
      </Section>

      <Section
        title="通知"
        description="任务结束时是否弹出右上角的 toast 提示。"
      >
        <Row
          title="完成时通知"
          description="任务成功完成后弹出一条 toast。"
          control={
            <Toggle
              checked={tweaks.notifyOnComplete}
              onChange={(v) => setTweaks({ notifyOnComplete: v })}
            />
          }
        />
        <Row
          title="失败/取消时通知"
          description="任务失败或被取消时弹出一条 toast。"
          control={
            <Toggle
              checked={tweaks.notifyOnFailure}
              onChange={(v) => setTweaks({ notifyOnFailure: v })}
            />
          }
        />
      </Section>
    </div>
  );
}

function AboutPanel() {
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
        description: "「字符矩阵」主题已解锁，可在「外观」里随时切换。",
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
        toast.info("当前运行环境不支持 App 内更新", {
          description: "静态 Page 和 Docker Web 仍按部署端更新。",
        });
        return;
      }
      if (result.status === "up-to-date") {
        setAvailableUpdate(null);
        toast.success("已经是最新版本", {
          description: `当前版本 ${result.currentVersion}`,
        });
        return;
      }
      setAvailableUpdate(result.update);
      toast.success(`发现新版本 ${result.update.version}`, {
        description: "可以直接下载并安装。",
      });
    } catch (error) {
      toast.error("检查更新失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleInstallUpdate = async () => {
    setInstallingUpdate(true);
    setUpdateProgress("准备下载");
    try {
      const result = await installAppUpdate((progress) => {
        if (progress.phase === "starting") {
          setUpdateProgress("开始下载");
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
            setUpdateProgress(`下载中 ${pct}%`);
          } else {
            setUpdateProgress("下载中");
          }
          return;
        }
        setUpdateProgress("正在安装");
      });
      if (result.status === "up-to-date") {
        setAvailableUpdate(null);
        toast.success("已经是最新版本");
      }
    } catch (error) {
      toast.error("安装更新失败", {
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
            ? "本地图像生成与编辑桌面客户端。"
            : copy.kind === "http"
              ? "连接后端服务的 Web 创作工作台。"
              : "浏览器直连的 Web 创作工作台。"}
        </div>
      </header>

      {desktopRuntime ? (
        <>
          <Section
            title="应用更新"
            description="桌面 App 使用 Tauri 官方更新器。"
          >
            <Row
              title={
                availableUpdate
                  ? `可更新到 ${availableUpdate.version}`
                  : "检查桌面端更新"
              }
              description={
                availableUpdate?.body ||
                "有新版本时会下载签名更新包，安装完成后自动重启 App。"
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
                        {updateProgress ?? "安装中"}
                      </>
                    ) : (
                      "下载并重启"
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
                        检查中
                      </>
                    ) : (
                      "检查更新"
                    )}
                  </Button>
                )
              }
            />
          </Section>

          <Section
            title="数据位置"
            description="本地存放配置、历史和生成结果的路径。只读信息。"
          >
            <PathRow title="配置文件" path={paths?.config_file} />
            <PathRow title="历史数据库" path={paths?.history_file} />
            <PathRow title="任务输出目录" path={paths?.jobs_dir} isFolder />
            <PathRow title="配置目录" path={paths?.config_dir} isFolder />
          </Section>
        </>
      ) : (
        <>
          <Section
            title="版本"
            description={
              copy.kind === "http"
                ? "Web 前端和后端服务由部署端更新，页面内不安装桌面更新包。"
                : "静态 Web 由站点部署更新，页面内不安装桌面更新包。"
            }
          >
            <Row
              title={`当前前端版本 v${__APP_VERSION__}`}
              description={
                copy.kind === "http"
                  ? "后端服务更新后，刷新页面即可使用新的 Web 前端。"
                  : "站点发布后，刷新页面即可使用新的静态 Web 前端。"
              }
              control={
                <span className="inline-flex h-8 items-center rounded-full border border-border-faint px-3 text-[11px] font-semibold text-muted">
                  {copy.name}
                </span>
              }
            />
          </Section>

          <Section
            title={copy.kind === "http" ? "服务端数据" : "浏览器数据"}
            description={
              copy.kind === "http"
                ? "任务历史和结果由后端服务维护，网页只提供预览和下载入口。"
                : "历史、凭证、草稿和结果保留在当前浏览器数据中。"
            }
          >
            <Row
              title="结果获取"
              description={
                copy.kind === "http"
                  ? "单图可直接下载，多图任务会打包为 ZIP 下载。"
                  : "单图可直接下载，多图任务会从当前浏览器数据打包为 ZIP 下载。"
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
            ? "偏好保存在桌面 App 配置里；并发上限会实时同步到后台队列。"
            : copy.kind === "http"
              ? "网页不会显示服务器目录；需要结果文件时请使用下载按钮。"
              : "网页不会显示内部存储路径；需要结果文件时请使用下载按钮。"}
        </span>
      </div>
    </div>
  );
}

/* ── Top-level screen ─────────────────────────────────── */

export function SettingsScreen({ config }: { config?: ServerConfig } = {}) {
  const [tab, setTab] = useState<SettingsTab>("creds");

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden px-4 pb-4 pt-3 md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-5 md:px-6 md:pb-6 md:pt-2">
      <SettingsNav tab={tab} setTab={setTab} />

      <div className="surface-panel flex min-h-0 flex-1 flex-col overflow-hidden">
        <PanelHeader tab={tab} />

        {tab === "creds" && <CredsPanel config={config} />}
        {tab === "appearance" && <AppearancePanel />}
        {tab === "runtime" && <RuntimePanel />}
        {tab === "prompts" && <PromptTemplatesPanel />}
        {tab === "about" && <AboutPanel />}
      </div>
    </div>
  );
}
