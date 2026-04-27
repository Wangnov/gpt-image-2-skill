import { type ReactNode, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  KeyRound,
  Sparkles,
  ListChecks,
  Info,
  Bot,
  FileCog,
  Plus,
  Pencil,
  Play,
  Trash2,
  Check,
  Loader2,
  X,
  Eye,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Segmented } from "@/components/ui/segmented";
import { Toggle } from "@/components/ui/toggle";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/hooks/use-confirm";
import { Empty } from "@/components/ui/empty";
import { Icon } from "@/components/icon";
import { useTweaks } from "@/hooks/use-tweaks";
import { useQueueStatus } from "@/hooks/use-jobs";
import {
  useDeleteProvider,
  useSetDefaultProvider,
  useTestProvider,
} from "@/hooks/use-config";
import { api, type ConfigPaths } from "@/lib/api";
import { copyText, openPath, revealPath } from "@/lib/user-actions";
import { effectiveDefaultProvider } from "@/lib/providers";
import { AddProviderDialog } from "@/components/screens/providers/add-provider-dialog";
import type { ProviderConfig, ServerConfig } from "@/lib/types";
import { cn } from "@/lib/cn";

type SettingsTab = "creds" | "appearance" | "runtime" | "about";

const NAV: { id: SettingsTab; label: string; icon: LucideIcon }[] = [
  { id: "creds", label: "凭证", icon: KeyRound },
  { id: "appearance", label: "外观", icon: Sparkles },
  { id: "runtime", label: "队列与通知", icon: ListChecks },
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
    title: "队列与通知",
    subtitle: "并发上限和任务结束提示",
  },
  about: {
    title: "关于 / 数据位置",
    subtitle: "本地存放配置、历史和生成结果的路径",
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
        <header className="border-b border-border-faint px-5 py-3">
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
    <div className="flex items-center gap-4 px-5 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-foreground">{title}</div>
        {description && (
          <div className="mt-0.5 text-[11.5px] text-muted">{description}</div>
        )}
      </div>
      <div className="shrink-0">{control}</div>
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
  return (
    <div className="flex items-center gap-4 px-5 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-foreground">{title}</div>
        <div
          className="mt-0.5 truncate font-mono text-[11px] text-faint"
          title={path ?? undefined}
        >
          {path ?? "—"}
        </div>
      </div>
      <div className="flex shrink-0 gap-0.5">
        <Button
          variant="ghost"
          size="iconSm"
          icon="folder"
          disabled={!path}
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
            if (path) void copyText(path, "路径");
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
    <aside className="flex flex-col gap-2">
      <div className="px-2 pt-1 pb-2">
        <div className="t-title text-foreground">设置</div>
      </div>
      <div className="surface-panel flex flex-col p-1.5 gap-0.5">
        {NAV.map((n) => {
          const I = n.icon;
          const active = n.id === tab;
          return (
            <button
              key={n.id}
              type="button"
              onClick={() => setTab(n.id)}
              className={cn(
                "flex items-center gap-2.5 h-9 px-3 rounded-md text-[13px] transition-colors text-left",
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
  const meta = TAB_TITLES[tab];
  return (
    <header className="px-6 pt-5 pb-4 border-b border-border-faint">
      <div className="t-h2">{meta.title}</div>
      <div className="mt-0.5 text-[12px] text-muted">{meta.subtitle}</div>
    </header>
  );
}

/* ── Sub-panels ───────────────────────────────────────── */

/* ── CredIcon: visual marker per provider type ─────────────── */
function CredIcon({ kind }: { kind: ProviderConfig["type"] }) {
  if (kind === "openai") {
    return (
      <div className="h-10 w-10 shrink-0 rounded-xl bg-[color:var(--w-06)] border border-[color:var(--w-10)] flex items-center justify-center">
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          className="text-foreground opacity-90"
        >
          <path
            d="M22.28 9.82a5.85 5.85 0 0 0-.5-4.81 5.93 5.93 0 0 0-6.4-2.84A5.93 5.93 0 0 0 4.7 4.74 5.85 5.85 0 0 0 .8 7.58a5.92 5.92 0 0 0 .73 6.93 5.85 5.85 0 0 0 .5 4.82 5.93 5.93 0 0 0 6.39 2.84 5.85 5.85 0 0 0 4.41 1.96 5.93 5.93 0 0 0 5.65-4.1 5.85 5.85 0 0 0 3.9-2.84 5.92 5.92 0 0 0-.74-6.93Z"
            stroke="currentColor"
            strokeWidth="1.4"
          />
        </svg>
      </div>
    );
  }
  if (kind === "codex") {
    return (
      <div
        className="h-10 w-10 shrink-0 rounded-xl flex items-center justify-center"
        style={{
          background: "var(--accent-gradient-glow)",
          border: "1px solid var(--accent-35)",
        }}
      >
        <Bot size={18} className="text-foreground" />
      </div>
    );
  }
  return (
    <div className="h-10 w-10 shrink-0 rounded-xl bg-[color:var(--w-06)] border border-[color:var(--w-10)] flex items-center justify-center">
      <FileCog size={17} className="text-foreground opacity-85" />
    </div>
  );
}

function maskKey(value: string | undefined): string {
  if (!value) return "—";
  if (value.length <= 8) return value.replace(/.(?=.{3})/g, "•");
  return `${value.slice(0, 3)}${"•".repeat(12)}${value.slice(-4)}`;
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
  const apiKeyDisplay =
    apiKeyCredential?.value && typeof apiKeyCredential.value === "string"
      ? maskKey(apiKeyCredential.value)
      : apiKeyCredential
        ? maskKey("sk-loaded-from-secret-store")
        : null;

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-3.5 py-3 rounded-xl border transition-colors",
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
              <span className="font-mono">{prov.api_base}</span>
            </div>
          )}
          {apiKeyDisplay && (
            <div className="text-[11.5px] text-muted flex items-center gap-2">
              <span className="text-faint">API Key </span>
              <span className="font-mono">{apiKeyDisplay}</span>
              <Eye size={12} className="opacity-50" aria-hidden />
            </div>
          )}
          {prov.model && (
            <div className="text-[11px] text-faint font-mono">
              {prov.model}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={onTest}
          disabled={testStatus === "running"}
          className="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted hover:text-foreground hover:bg-[color:var(--w-06)] transition-colors disabled:opacity-50"
          title="测试连接"
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
        <button
          type="button"
          onClick={onEdit}
          className="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted hover:text-foreground hover:bg-[color:var(--w-06)] transition-colors"
          title="编辑"
          aria-label={`编辑 ${name}`}
        >
          <Pencil size={13} />
        </button>
        {!isDefault && (
          <Button size="sm" onClick={onUse}>
            使用
          </Button>
        )}
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
          title="删除"
          aria-label={`删除 ${name}`}
        >
          <Trash2 size={13} />
        </button>
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
      if (r.ok) toast.success("连接正常", { description: `${name} 可以使用。` });
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
    <div className="flex-1 min-h-0 overflow-auto p-5">
      {names.length === 0 ? (
        <Empty
          icon="providers"
          title="还没有配置凭证"
          subtitle="点击下方「添加凭证」开始配置 OpenAI / Azure / 自定义供应商。"
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

function AppearancePanel() {
  const { tweaks, setTweaks } = useTweaks();
  return (
    <div className="flex-1 min-h-0 overflow-auto p-5 space-y-4">
      <Section title="主题">
        <Row
          title="主题"
          description="液态深色 — 玻璃质感单一主题，强调色为紫蓝渐变。"
          control={
            <span
              className="inline-flex items-center gap-2 px-3 h-8 rounded-full text-[12.5px]"
              style={{
                background: "var(--accent-gradient-soft)",
                border: "1px solid var(--accent-35)",
                color: "var(--text)",
              }}
            >
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{
                  background: "var(--accent-gradient-line)",
                  boxShadow: "0 0 8px var(--accent-60)",
                }}
              />
              Liquid
            </span>
          }
        />
        <Row
          title="液态背景"
          description="启用 WebGL 流体动画作为窗口背景。关闭后改用静态深色，节省 GPU。"
          control={
            <Toggle
              checked={tweaks.liquidBackground}
              onChange={(v) => setTweaks({ liquidBackground: v })}
            />
          }
        />
        <Row
          title="面板透明度"
          description="所有玻璃面板的不透明度。值越低背景越能透出，值越高内容越易读。"
          control={
            <div className="flex items-center gap-3 w-[240px]">
              <input
                type="range"
                min={5}
                max={95}
                step={1}
                value={tweaks.glassOpacity}
                onChange={(e) =>
                  setTweaks({ glassOpacity: Number(e.target.value) })
                }
                className="flex-1 cursor-pointer"
                style={{
                  accentColor: "var(--accent)",
                  height: 4,
                }}
                aria-label="面板透明度"
              />
              <span className="font-mono text-[11px] text-faint w-10 text-right tabular-nums">
                {tweaks.glassOpacity}%
              </span>
            </div>
          }
        />
      </Section>

      <Section title="排版">
        <Row
          title="字体"
          description="系统默认读起来最自然；等宽/衬线用于强调代码或文本风格。"
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
          description="紧凑减少空白，舒适更透气。"
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
  const { data: queue } = useQueueStatus();
  const running = queue?.running ?? 0;
  const queued = queue?.queued ?? 0;
  const queueSummary =
    running + queued === 0
      ? "目前没有任务在队列里"
      : `当前 ${running} 个在跑，${queued} 个排队`;

  return (
    <div className="flex-1 min-h-0 overflow-auto p-5 space-y-4">
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
  const { data: paths } = useQuery<ConfigPaths>({
    queryKey: ["config-paths"],
    queryFn: api.configPaths,
    staleTime: 60_000,
  });

  return (
    <div className="flex-1 min-h-0 overflow-auto p-5 space-y-4">
      <Section
        title="数据位置"
        description="本地存放配置、历史和生成结果的路径。只读信息。"
      >
        <PathRow title="配置文件" path={paths?.config_file} />
        <PathRow title="历史数据库" path={paths?.history_file} />
        <PathRow title="任务输出目录" path={paths?.jobs_dir} isFolder />
        <PathRow title="配置目录" path={paths?.config_dir} isFolder />
      </Section>

      <div className="flex items-center gap-1.5 px-1 pt-1 text-[11px] text-faint">
        <Icon name="info" size={11} />
        <span>偏好保存在本机存储里；并发上限会实时同步到后台队列。</span>
      </div>
    </div>
  );
}

/* ── Top-level screen ─────────────────────────────────── */

export function SettingsScreen({ config }: { config?: ServerConfig } = {}) {
  const [tab, setTab] = useState<SettingsTab>("creds");

  return (
    <div className="grid h-full grid-cols-[200px_minmax(0,1fr)] gap-5 px-6 pb-6 pt-2 overflow-hidden">
      <SettingsNav tab={tab} setTab={setTab} />

      <div className="surface-panel overflow-hidden flex flex-col min-h-0">
        <PanelHeader tab={tab} />

        {tab === "creds" && <CredsPanel config={config} />}
        {tab === "appearance" && <AppearancePanel />}
        {tab === "runtime" && <RuntimePanel />}
        {tab === "about" && <AboutPanel />}
      </div>
    </div>
  );
}
