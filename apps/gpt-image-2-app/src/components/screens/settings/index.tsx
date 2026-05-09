import {
  type ChangeEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion, useAnimationControls } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
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
  Bell,
  Mail,
  Webhook,
  HardDrive,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Segmented } from "@/components/ui/segmented";
import { Toggle } from "@/components/ui/toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { GlassSelect } from "@/components/ui/select";
import { useConfirm } from "@/hooks/use-confirm";
import { Empty } from "@/components/ui/empty";
import { Tooltip } from "@/components/ui/tooltip";
import { Icon } from "@/components/icon";
import { useTweaks } from "@/hooks/use-tweaks";
import { useQueueStatus } from "@/hooks/use-jobs";
import {
  useDeleteProvider,
  useNotificationCapabilities,
  useSetDefaultProvider,
  useTestProvider,
  useTestStorageTarget,
  useTestNotifications,
  useUpdateNotifications,
  useUpdatePaths,
  useUpdateStorage,
} from "@/hooks/use-config";
import {
  checkForAppUpdate,
  installAppUpdate,
  type AppUpdateInfo,
} from "@/lib/app-updater";
import { api, type ConfigPaths } from "@/lib/api";
import {
  defaultNotificationConfig,
  defaultStorageConfig,
  normalizePathConfig,
  normalizeNotificationConfig,
  normalizeStorageConfig,
  storageTargetType,
} from "@/lib/api/shared";
import { clearCreativeDrafts } from "@/lib/drafts";
import { copyText, openPath, revealPath } from "@/lib/user-actions";
import { isDesktopRuntime, runtimeCopy } from "@/lib/runtime-copy";
import { effectiveDefaultProvider } from "@/lib/providers";
import {
  type StorageFieldIssue,
  storageConfigIssue,
  storageTargetConfigIssue,
  visibleStorageTargetIssues,
} from "@/lib/storage-validation";
import { AddProviderDialog } from "@/components/screens/providers/add-provider-dialog";
import { PromptTemplatesPanel } from "@/components/screens/settings/prompt-templates-panel";
import { ProviderLogo } from "@/components/provider-logo";
import type {
  CredentialRef,
  EmailTlsMode,
  JobStatus,
  NotificationConfig,
  PathConfig,
  ProviderConfig,
  ServerConfig,
  StorageConfig,
  StorageFallbackPolicy,
  HttpStorageTargetConfig,
  SftpStorageTargetConfig,
  StorageTargetConfig,
  StorageTargetKind,
  BaiduNetdiskStorageTargetConfig,
  Pan123OpenStorageTargetConfig,
  WebDavStorageTargetConfig,
  WebhookNotificationConfig,
} from "@/lib/types";
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

type SettingsTab =
  | "creds"
  | "appearance"
  | "runtime"
  | "storage"
  | "prompts"
  | "about";

const NAV: { id: SettingsTab; label: string; icon: LucideIcon }[] = [
  { id: "creds", label: "凭证", icon: KeyRound },
  { id: "appearance", label: "外观", icon: Sparkles },
  { id: "runtime", label: "任务", icon: ListChecks },
  { id: "storage", label: "存储", icon: HardDrive },
  { id: "prompts", label: "模板", icon: FileText },
  { id: "about", label: "关于", icon: Info },
];

const PARALLEL_OPTIONS = [1, 2, 3, 4, 6, 8].map((n) => ({
  value: String(n),
  label: String(n),
}));

const TLS_OPTIONS = [
  { value: "start-tls", label: "STARTTLS" },
  { value: "smtps", label: "SMTPS" },
  { value: "none", label: "无 TLS" },
] as const;

const METHOD_OPTIONS = [
  { value: "POST", label: "POST" },
  { value: "PUT", label: "PUT" },
  { value: "PATCH", label: "PATCH" },
] as const;

const STORAGE_TARGET_TYPE_OPTIONS = [
  { value: "local", label: "本地" },
  { value: "http", label: "HTTP" },
  { value: "s3", label: "S3" },
  { value: "webdav", label: "WebDAV" },
  { value: "sftp", label: "SFTP" },
  { value: "baidu_netdisk", label: "百度网盘 OpenAPI" },
  { value: "pan123_open", label: "123 网盘 OpenAPI" },
] as const;

const BAIDU_AUTH_MODE_OPTIONS = [
  { value: "personal", label: "个人对接" },
  { value: "oauth", label: "OAuth 对接" },
] as const;

const PAN123_AUTH_MODE_OPTIONS = [
  { value: "client", label: "client 对接" },
  { value: "access_token", label: "accessToken 对接" },
] as const;

const STORAGE_FALLBACK_POLICY_OPTIONS = [
  { value: "on_failure", label: "失败时" },
  { value: "always", label: "总是" },
  { value: "never", label: "关闭" },
] as const;

const CREDENTIAL_SOURCE_OPTIONS = [
  { value: "file", label: "直接填写" },
  { value: "env", label: "环境变量" },
  { value: "keychain", label: "系统钥匙串" },
] as const;

const BAIDU_NETDISK_HINT = [
  "百度网盘 OpenAPI 对接条件：",
  "创建个人应用，并开通网盘上传权限。",
  "填写 App Key + Secret Key + Refresh Token，或长期 Access Token。",
  "上传路径位于 /apps/{应用名}/，应用名需与开放平台一致。",
].join("\n");

const PAN123_OPEN_HINT = [
  "123 网盘 OpenAPI 对接条件：",
  "填写长期 Access Token；或配置 clientID + clientSecret。",
  "父目录 ID 默认 0，表示根目录。",
  "直链是可选增强；未开通时仍会上传成功，只是不返回公开 URL。",
].join("\n");

const LOCAL_PUBLIC_BASE_URL_HINT = [
  "可选。",
  "仅当本地目录已经通过 Nginx、CDN 或静态文件服务映射成可访问地址时填写。",
  "上传记录会用它拼出图片 URL；留空时仍会保存到本地目录。",
].join("\n");

const EXPORT_DIR_MODE_OPTIONS = [
  { value: "downloads", label: "下载" },
  { value: "documents", label: "文稿" },
  { value: "pictures", label: "图片" },
  { value: "result_library", label: "应用内结果库" },
  { value: "custom", label: "其他文件夹" },
] as const;

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
    subtitle: "同时执行几个任务、结束后怎么提醒",
  },
  storage: {
    title: "保存与上传",
    subtitle: "保存到本机的位置，以及是否自动上传",
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
  headerAction,
  children,
}: {
  title: string;
  description?: string;
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      className="rounded-xl overflow-hidden border border-border-faint"
      style={{ background: "var(--w-02)" }}
    >
      {(title || description || headerAction) && (
        <header className="flex items-start gap-3 border-b border-border-faint px-4 py-3 sm:px-5">
          <div className="min-w-0 flex-1">
            <div className="t-h3">{title}</div>
            {description && (
              <div className="mt-0.5 text-[12px] text-muted">{description}</div>
            )}
          </div>
          {headerAction && <div className="shrink-0">{headerAction}</div>}
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

function HintButton({
  text,
  ariaLabel = "查看对接条件",
}: {
  text: string;
  ariaLabel?: string;
}) {
  return (
    <Tooltip text={text}>
      <button
        type="button"
        aria-label={ariaLabel}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border text-[11px] font-semibold text-muted transition-colors hover:border-[color:var(--accent-45)] hover:text-foreground"
      >
        ?
      </button>
    </Tooltip>
  );
}

function issueForField(issues: StorageFieldIssue[], field: string) {
  return issues.find((issue) => issue.field === field)?.message;
}

function StorageField({
  error,
  required,
  children,
}: {
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      {required && (
        <div className="text-right text-[11px] font-semibold leading-none text-[color:var(--accent-70)]">
          *
        </div>
      )}
      {children}
      {error && (
        <div className="text-[11px] leading-snug text-status-err">{error}</div>
      )}
    </div>
  );
}

function PathRow({
  title,
  path,
  isFolder,
  dim = false,
}: {
  title: string;
  path?: string;
  isFolder?: boolean;
  dim?: boolean;
}) {
  // Bumping this trigger replays the ScrambleText reveal — used as a
  // visual receipt that "the value you just copied is the value you
  // see right now", catching cases where the user might have stale
  // path text in their clipboard.
  const [copyTrigger, setCopyTrigger] = useState(0);
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5",
        dim ? "px-4 py-2" : "px-4 py-3",
      )}
    >
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            dim
              ? "text-[11.5px] font-medium text-muted"
              : "text-[13px] font-semibold text-foreground",
          )}
        >
          {title}
        </div>
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
  const reducedMotion = useReducedMotion();
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
                "relative flex h-9 shrink-0 items-center gap-2.5 rounded-md px-3 text-left text-[13px] transition-colors md:w-full",
                active
                  ? "text-foreground"
                  : "text-muted hover:text-foreground hover:bg-[color:var(--w-05)]",
              )}
            >
              {/* Sliding active pill — same trick the top-nav uses.
                  motion shares one element across all tabs via layoutId,
                  so the highlight slides between tabs instead of cutting. */}
              {active && (
                <motion.span
                  layoutId="settings-nav-active-pill"
                  aria-hidden="true"
                  className="absolute inset-0 z-0 rounded-md border border-[color:var(--w-10)]"
                  style={{ background: "var(--w-10)" }}
                  transition={{
                    duration: reducedMotion ? 0 : 0.24,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                />
              )}
              <I size={14} className="relative z-10 opacity-80" />
              <span className="relative z-10 flex-1">{n.label}</span>
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
  const reducedMotion = useReducedMotion();
  // Bumped on every transition into "ok" / "err" so the success ring
  // (or failure shake) replays even when the user clicks 测试 twice
  // in a row and lands on the same terminal state. Without this the
  // motion would only fire on the very first state change.
  const [resultPulseKey, setResultPulseKey] = useState(0);
  useEffect(() => {
    if (testStatus === "ok" || testStatus === "err") {
      setResultPulseKey((k) => k + 1);
    }
  }, [testStatus]);
  // Imperative shake on each "err" transition. Previously the button
  // got `key={\`err-${resultPulseKey}\`}` so React would unmount and
  // remount it on every failure, which is the standard "remount to
  // replay" trick — but it dropped keyboard focus mid-retry. Using
  // animation controls keeps the DOM stable and replays the keyframes
  // on resultPulseKey bumps so consecutive failures still cue.
  const shakeControls = useAnimationControls();
  useEffect(() => {
    if (testStatus === "err" && !reducedMotion) {
      void shakeControls.start({
        x: [0, -2, 2, -1.5, 1.5, 0],
        transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] },
      });
    }
  }, [resultPulseKey, testStatus, reducedMotion, shakeControls]);
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
          <motion.button
            type="button"
            onClick={onTest}
            disabled={testStatus === "running"}
            // Failure shake — three small horizontal nudges, only on
            // the err pulse. Success path leaves the button still and
            // lets the ring carry the news. Driven by shakeControls
            // (see effect above) so the DOM node stays stable across
            // retries — `key`-based remount drops keyboard focus.
            animate={shakeControls}
            className="relative h-8 w-8 inline-flex items-center justify-center rounded-md text-muted hover:text-foreground hover:bg-[color:var(--w-06)] transition-colors disabled:opacity-50"
            aria-label={`测试 ${name} 的连接`}
          >
            {/* Success ring pulse — radial accent fading from 0.7 -> 0
                as it scales out. Only paints on each fresh "ok" via
                resultPulseKey so re-tests replay the cue. */}
            <AnimatePresence>
              {testStatus === "ok" && !reducedMotion && (
                <motion.span
                  key={`ok-pulse-${resultPulseKey}`}
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-md"
                  initial={{ opacity: 0.75, scale: 0.7 }}
                  animate={{ opacity: 0, scale: 1.6 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  style={{
                    background:
                      "radial-gradient(circle at center, var(--status-ok-25), transparent 70%)",
                    boxShadow: "0 0 0 1px var(--status-ok-25)",
                  }}
                />
              )}
            </AnimatePresence>
            {/* Status icon swap — mode="wait" so each glyph plays its
                own enter after the previous one finishes its exit;
                avoids two icons overlapping mid-transition. */}
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={testStatus ?? "idle"}
                initial={
                  reducedMotion ? { opacity: 1 } : { opacity: 0, scale: 0.6 }
                }
                animate={{ opacity: 1, scale: 1 }}
                exit={
                  reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.8 }
                }
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="relative z-10 inline-flex"
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
              </motion.span>
            </AnimatePresence>
          </motion.button>
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
  const reducedMotion = useReducedMotion();
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
          <AnimatePresence initial={false}>
            {names.map((name) => (
              <motion.div
                key={name}
                layout="position"
                initial={
                  reducedMotion
                    ? false
                    : { opacity: 0, y: 6, scale: 0.98 }
                }
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={
                  reducedMotion
                    ? { opacity: 0 }
                    : { opacity: 0, scale: 0.96, x: -12 }
                }
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              >
                <CredCard
                  name={name}
                  prov={providers[name]}
                  isDefault={name === effectiveDefault}
                  testStatus={testMap[name]?.status}
                  onEdit={() => setEditingName(name)}
                  onUse={() => makeDefault(name)}
                  onTest={() => runTest(name)}
                  onDelete={() => removeProvider(name)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
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
  const { data: queue } = useQueueStatus();
  const { data: config } = useQuery<ServerConfig>({
    queryKey: ["config"],
    queryFn: api.getConfig,
  });
  const notifications = config?.notifications;
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
        description="一次最多并行几个，避免占满网络或 CPU。"
      >
        <Row
          title="同时执行数"
          description={`${queueSummary}。`}
          control={
            <Segmented
              value={String(tweaks.maxParallel)}
              onChange={(v) => setTweaks({ maxParallel: Number(v) })}
              size="sm"
              ariaLabel="同时执行数"
              options={PARALLEL_OPTIONS}
            />
          }
        />
      </Section>

      <Section
        title="草稿"
        description="保留生成 / 编辑页未提交的内容（参数、参考图、遮罩）。"
      >
        <Row
          title="保留创作草稿"
          description="刷新或重启后仍能恢复未提交的内容；关闭会清空。"
          control={
            <Toggle
              checked={tweaks.persistCreativeDrafts}
              onChange={(v) => void setDraftPersistence(v)}
            />
          }
        />
      </Section>

      <NotificationCenterPanel notifications={notifications} />
    </div>
  );
}

function cloneNotificationConfig(value?: NotificationConfig) {
  return normalizeNotificationConfig(
    value
      ? (JSON.parse(JSON.stringify(value)) as NotificationConfig)
      : defaultNotificationConfig(),
  );
}

function fileCredentialValue(credential?: CredentialRef | null) {
  return credential?.source === "file" && typeof credential.value === "string"
    ? credential.value
    : "";
}

// Keep in sync with `KEYCHAIN_SERVICE` in crates/gpt-image-2-core/src/lib.rs;
// the backend resolves keychain refs against this exact service name.
const DEFAULT_KEYCHAIN_SERVICE = "gpt-image-2-skill";

function blankCredential(
  source: CredentialRef["source"],
  previous?: CredentialRef | null,
): CredentialRef {
  if (source === "env") {
    return { source, env: previous?.source === "env" ? previous.env : "" };
  }
  if (source === "keychain") {
    return {
      source,
      service:
        previous?.source === "keychain"
          ? previous.service
          : DEFAULT_KEYCHAIN_SERVICE,
      account: previous?.source === "keychain" ? previous.account : "",
    };
  }
  return { source: "file", value: "" };
}

function normalizeCredentialForSave(credential?: CredentialRef | null) {
  if (!credential) return null;
  if (credential.source === "env") {
    const env = credential.env?.trim();
    return env ? { source: "env" as const, env } : null;
  }
  if (credential.source === "keychain") {
    const account = credential.account?.trim();
    if (!account) return null;
    const service = credential.service?.trim();
    return {
      source: "keychain" as const,
      service: service || undefined,
      account,
    };
  }
  return {
    source: "file" as const,
    value: typeof credential.value === "string" ? credential.value : "",
  };
}

function parseRecipients(value: string) {
  return value
    .split(/[\n,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function webhookHeaderEntries(webhook: WebhookNotificationConfig) {
  return Object.entries(webhook.headers ?? {});
}

function prepareNotificationConfigForSave(
  config: NotificationConfig,
): NotificationConfig {
  const webhookHeaders = (webhook: WebhookNotificationConfig) => {
    const headers: Record<string, CredentialRef> = {};
    for (const [header, credential] of webhookHeaderEntries(webhook)) {
      const name = header.trim();
      const nextCredential = normalizeCredentialForSave(credential);
      if (name && nextCredential) headers[name] = nextCredential;
    }
    return headers;
  };

  return {
    ...config,
    email: {
      ...config.email,
      smtp_host: config.email.smtp_host.trim(),
      smtp_port: Math.max(1, Math.round(config.email.smtp_port || 587)),
      username: config.email.username?.trim() || undefined,
      password: normalizeCredentialForSave(config.email.password),
      from: config.email.from.trim(),
      to: config.email.to.map((item) => item.trim()).filter(Boolean),
      timeout_seconds: Math.max(
        1,
        Math.round(config.email.timeout_seconds || 10),
      ),
    },
    webhooks: config.webhooks.map((webhook) => ({
      ...webhook,
      name: webhook.name.trim(),
      url: webhook.url.trim(),
      method: webhook.method.trim().toUpperCase() || "POST",
      timeout_seconds: Math.max(1, Math.round(webhook.timeout_seconds || 10)),
      headers: webhookHeaders(webhook),
    })),
  };
}

function cloneStorageConfig(value?: StorageConfig) {
  return normalizeStorageConfig(
    value
      ? (JSON.parse(JSON.stringify(value)) as StorageConfig)
      : defaultStorageConfig(),
  );
}

function clonePathConfig(value?: PathConfig) {
  return {
    ...normalizePathConfig(
      value
        ? (JSON.parse(JSON.stringify(value)) as PathConfig)
        : undefined,
    ),
  };
}

function preparePathConfigForSave(config: PathConfig): PathConfig {
  return {
    ...config,
    app_data_dir: {
      mode: config.app_data_dir.mode,
      path:
        config.app_data_dir.mode === "custom"
          ? config.app_data_dir.path?.trim() || null
          : null,
    },
    result_library_dir: {
      mode: config.result_library_dir.mode,
      path:
        config.result_library_dir.mode === "custom"
          ? config.result_library_dir.path?.trim() || null
          : null,
    },
    default_export_dir: {
      mode: config.default_export_dir.mode,
      path:
        config.default_export_dir.mode === "custom"
          ? config.default_export_dir.path?.trim() || null
          : null,
    },
    legacy_shared_codex_dir: {
      ...config.legacy_shared_codex_dir,
      path: config.legacy_shared_codex_dir.path.trim(),
    },
  };
}

function storageTargetLabel(target: StorageTargetConfig) {
  const type = storageTargetType(target);
  return (
    STORAGE_TARGET_TYPE_OPTIONS.find((option) => option.value === type)
      ?.label ?? type
  );
}

function blankStorageTarget(type: StorageTargetKind): StorageTargetConfig {
  if (type === "s3") {
    return {
      type,
      bucket: "",
      region: "",
      endpoint: "",
      prefix: "",
      access_key_id: null,
      secret_access_key: null,
      session_token: null,
      public_base_url: "",
    };
  }
  if (type === "webdav") {
    return {
      type,
      url: "",
      username: "",
      password: null,
      public_base_url: "",
    };
  }
  if (type === "http") {
    return {
      type,
      url: "",
      method: "POST",
      headers: {},
      public_url_json_pointer: "",
    };
  }
  if (type === "sftp") {
    return {
      type,
      host: "",
      port: 22,
      host_key_sha256: "",
      username: "",
      password: null,
      private_key: null,
      remote_dir: "/",
      public_base_url: "",
    };
  }
  if (type === "baidu_netdisk") {
    return {
      type,
      auth_mode: "personal",
      app_key: "",
      secret_key: null,
      access_token: null,
      refresh_token: null,
      app_name: "",
      remote_dir: "",
      public_base_url: "",
    };
  }
  if (type === "pan123_open") {
    return {
      type,
      auth_mode: "client",
      client_id: "",
      client_secret: null,
      access_token: null,
      parent_id: 0,
      use_direct_link: false,
    };
  }
  return { type: "local", directory: "", public_base_url: "" };
}

function normalizeStorageTargetForSave(
  target: StorageTargetConfig,
): StorageTargetConfig {
  const type = storageTargetType(target);
  if (type === "s3" && "bucket" in target) {
    return {
      type,
      bucket: target.bucket.trim(),
      region: target.region?.trim() || undefined,
      endpoint: target.endpoint?.trim() || undefined,
      prefix: target.prefix?.trim() || undefined,
      access_key_id: normalizeCredentialForSave(target.access_key_id),
      secret_access_key: normalizeCredentialForSave(target.secret_access_key),
      session_token: normalizeCredentialForSave(target.session_token),
      public_base_url: target.public_base_url?.trim() || undefined,
    };
  }
  if (type === "webdav") {
    const webdav = target as WebDavStorageTargetConfig;
    return {
      type,
      url: webdav.url.trim(),
      username: webdav.username?.trim() || undefined,
      password: normalizeCredentialForSave(webdav.password),
      public_base_url: webdav.public_base_url?.trim() || undefined,
    };
  }
  if (type === "http") {
    const http = target as HttpStorageTargetConfig;
    const headers: Record<string, CredentialRef> = {};
    for (const [header, credential] of Object.entries(http.headers ?? {})) {
      const key = header.trim();
      const nextCredential = normalizeCredentialForSave(credential);
      if (key && nextCredential) headers[key] = nextCredential;
    }
    return {
      type,
      url: http.url.trim(),
      method: http.method.trim().toUpperCase() || "POST",
      headers,
      public_url_json_pointer:
        http.public_url_json_pointer?.trim() || undefined,
    };
  }
  if (type === "sftp") {
    const sftp = target as SftpStorageTargetConfig;
    return {
      type,
      host: sftp.host.trim(),
      port: Math.max(1, Math.round(sftp.port || 22)),
      host_key_sha256: sftp.host_key_sha256?.trim() || undefined,
      username: sftp.username.trim(),
      password: normalizeCredentialForSave(sftp.password),
      private_key: normalizeCredentialForSave(sftp.private_key),
      remote_dir: sftp.remote_dir.trim() || "/",
      public_base_url: sftp.public_base_url?.trim() || undefined,
    };
  }
  if (type === "baidu_netdisk") {
    const baidu = target as BaiduNetdiskStorageTargetConfig;
    const authMode = baidu.auth_mode === "oauth" ? "oauth" : "personal";
    return {
      type,
      auth_mode: authMode,
      app_key: authMode === "oauth" ? baidu.app_key.trim() : "",
      secret_key:
        authMode === "oauth"
          ? normalizeCredentialForSave(baidu.secret_key)
          : undefined,
      access_token:
        authMode === "personal"
          ? normalizeCredentialForSave(baidu.access_token)
          : undefined,
      refresh_token:
        authMode === "oauth"
          ? normalizeCredentialForSave(baidu.refresh_token)
          : undefined,
      app_name: baidu.app_name.trim(),
      remote_dir: baidu.remote_dir?.trim() || undefined,
      public_base_url: baidu.public_base_url?.trim() || undefined,
    };
  }
  if (type === "pan123_open") {
    const pan123 = target as Pan123OpenStorageTargetConfig;
    const authMode =
      pan123.auth_mode === "access_token" ? "access_token" : "client";
    return {
      type,
      auth_mode: authMode,
      client_id: authMode === "client" ? pan123.client_id.trim() : "",
      client_secret:
        authMode === "client"
          ? normalizeCredentialForSave(pan123.client_secret)
          : undefined,
      access_token:
        authMode === "access_token"
          ? normalizeCredentialForSave(pan123.access_token)
          : undefined,
      parent_id: Math.max(0, Math.round(pan123.parent_id || 0)),
      use_direct_link: Boolean(pan123.use_direct_link),
    };
  }
  return {
    type: "local",
    directory: "directory" in target ? target.directory.trim() : "",
    public_base_url:
      "public_base_url" in target
        ? target.public_base_url?.trim() || undefined
        : undefined,
  };
}

function prepareStorageConfigForSave(config: StorageConfig): StorageConfig {
  const renamedTargets = Object.fromEntries(
    Object.entries(config.targets)
      .map(([name, target]) => [
        name.trim(),
        normalizeStorageTargetForSave(target),
      ])
      .filter(([name]) => name),
  );
  const nameMap = new Map(
    Object.keys(config.targets).map((name) => [name, name.trim()]),
  );
  const validNames = new Set(Object.keys(renamedTargets));
  const normalizeTargetNames = (names: string[]) =>
    names
      .map((name) => nameMap.get(name) ?? name.trim())
      .filter((name): name is string => Boolean(name) && validNames.has(name));
  return {
    targets: renamedTargets,
    default_targets: normalizeTargetNames(config.default_targets),
    fallback_targets: normalizeTargetNames(config.fallback_targets),
    fallback_policy: config.fallback_policy,
    upload_concurrency: Math.max(
      1,
      Math.round(config.upload_concurrency || 4),
    ),
    target_concurrency: Math.max(
      1,
      Math.round(config.target_concurrency || 2),
    ),
  };
}

function CredentialEditor({
  credential,
  onChange,
  placeholder,
  ariaLabel,
  invalid,
}: {
  credential?: CredentialRef | null;
  onChange: (credential: CredentialRef | null) => void;
  placeholder?: string;
  ariaLabel: string;
  invalid?: boolean;
}) {
  const source = credential?.source ?? "file";
  const secretDisplay = credentialSecretDisplay(credential);
  const changeSource = (nextSource: CredentialRef["source"]) => {
    onChange(blankCredential(nextSource, credential));
  };

  return (
    <div className="grid gap-2 sm:grid-cols-[132px_minmax(0,1fr)]">
      <GlassSelect
        value={source}
        onValueChange={(value) =>
          changeSource(value as CredentialRef["source"])
        }
        options={CREDENTIAL_SOURCE_OPTIONS}
        size="sm"
        ariaLabel={`${ariaLabel} 来源`}
      />
      {source === "file" && (
        <Input
          value={fileCredentialValue(credential)}
          onChange={(event) =>
            onChange({ source: "file", value: event.target.value })
          }
          placeholder={
            secretDisplay ? `${secretDisplay}，留空保留` : placeholder
          }
          size="sm"
          monospace
          aria-label={ariaLabel}
          aria-invalid={invalid}
        />
      )}
      {source === "env" && (
        <Input
          value={credential?.source === "env" ? credential.env : ""}
          onChange={(event) =>
            onChange({ source: "env", env: event.target.value })
          }
          placeholder="如 OPENAI_API_KEY"
          size="sm"
          monospace
          aria-label={ariaLabel}
          aria-invalid={invalid}
        />
      )}
      {source === "keychain" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            value={
              credential?.source === "keychain"
                ? (credential.service ?? "")
                : ""
            }
            onChange={(event) =>
              onChange({
                source: "keychain",
                service: event.target.value,
                account:
                  credential?.source === "keychain" ? credential.account : "",
              })
            }
            placeholder="service"
            size="sm"
            monospace
            aria-label={`${ariaLabel} Keychain service`}
            aria-invalid={invalid}
          />
          <Input
            value={credential?.source === "keychain" ? credential.account : ""}
            onChange={(event) =>
              onChange({
                source: "keychain",
                service:
                  credential?.source === "keychain"
                    ? credential.service
                    : DEFAULT_KEYCHAIN_SERVICE,
                account: event.target.value,
              })
            }
            placeholder="account"
            size="sm"
            monospace
            aria-label={`${ariaLabel} Keychain account`}
            aria-invalid={invalid}
          />
        </div>
      )}
    </div>
  );
}

function NotificationCenterPanel({
  notifications,
}: {
  notifications?: NotificationConfig;
}) {
  const [draft, setDraft] = useState(() =>
    cloneNotificationConfig(notifications),
  );
  const updateNotifications = useUpdateNotifications();
  const testNotifications = useTestNotifications();
  const { data: capabilities } = useNotificationCapabilities();

  useEffect(() => {
    setDraft(cloneNotificationConfig(notifications));
  }, [notifications]);

  const recipientText = useMemo(
    () => draft.email.to.join("\n"),
    [draft.email.to],
  );
  const canUseServerNotifications = Boolean(
    capabilities?.server.email || capabilities?.server.webhook,
  );

  const patch = (next: Partial<NotificationConfig>) => {
    setDraft((current) => ({ ...current, ...next }));
  };
  const patchEmail = (next: Partial<NotificationConfig["email"]>) => {
    setDraft((current) => ({
      ...current,
      email: { ...current.email, ...next },
    }));
  };
  const patchWebhook = (
    index: number,
    next: Partial<WebhookNotificationConfig>,
  ) => {
    setDraft((current) => ({
      ...current,
      webhooks: current.webhooks.map((webhook, itemIndex) =>
        itemIndex === index ? { ...webhook, ...next } : webhook,
      ),
    }));
  };
  const addWebhook = () => {
    setDraft((current) => ({
      ...current,
      webhooks: [
        ...current.webhooks,
        {
          id: `webhook-${Date.now()}`,
          name: "",
          enabled: true,
          url: "",
          method: "POST",
          headers: {},
          timeout_seconds: 10,
        },
      ],
    }));
  };
  const removeWebhook = (index: number) => {
    setDraft((current) => ({
      ...current,
      webhooks: current.webhooks.filter((_, itemIndex) => itemIndex !== index),
    }));
  };
  const addHeader = (index: number) => {
    const webhook = draft.webhooks[index];
    if (!webhook) return;
    const headers = { ...(webhook.headers ?? {}) };
    let key = "Authorization";
    let count = 1;
    while (headers[key]) {
      count += 1;
      key = `X-Webhook-Secret-${count}`;
    }
    headers[key] = { source: "file", value: "" };
    patchWebhook(index, { headers });
  };
  const renameHeader = (index: number, oldName: string, nextName: string) => {
    const webhook = draft.webhooks[index];
    if (!webhook) return;
    const headers = { ...(webhook.headers ?? {}) };
    const credential = headers[oldName];
    delete headers[oldName];
    headers[nextName] = credential;
    patchWebhook(index, { headers });
  };
  const updateHeaderCredential = (
    index: number,
    header: string,
    credential: CredentialRef | null,
  ) => {
    const webhook = draft.webhooks[index];
    if (!webhook) return;
    const headers = { ...(webhook.headers ?? {}) };
    if (credential) headers[header] = credential;
    else delete headers[header];
    patchWebhook(index, { headers });
  };

  const save = async () => {
    try {
      const saved = await updateNotifications.mutateAsync(
        prepareNotificationConfigForSave(draft),
      );
      setDraft(cloneNotificationConfig(saved.notifications));
      toast.success("通知中心已保存");
    } catch (error) {
      toast.error("保存通知中心失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const test = async (status: JobStatus) => {
    try {
      const result = await testNotifications.mutateAsync(status);
      const failed = result.deliveries.filter((item) => !item.ok);
      const message =
        failed[0]?.message ||
        result.deliveries.map((item) => item.message).filter(Boolean)[0];
      if (result.reason === "no_eligible_channel") {
        toast.info("没有可发送的方式", {
          description: "通知中心已关或未选任何状态 / 方式，不会发出。",
        });
        return;
      }
      if (result.ok) {
        const description =
          message ||
          (result.reason === "local_only"
            ? "未配置邮件 / 回调；真实任务结束时仍会弹应用内 / 系统通知。"
            : undefined);
        toast.success("试发已完成", { description });
      } else {
        toast.warning("试发未全部成功", { description: message });
      }
    } catch (error) {
      toast.error("试发失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <Section
      title="通知中心"
      description="任务结束时提醒你 — 应用内、系统、邮件或回调。"
      headerAction={
        <Toggle
          checked={draft.enabled}
          onChange={(enabled) => patch({ enabled })}
        />
      }
    >
      {capabilities && !canUseServerNotifications && (
        <div className="flex items-start gap-2 px-4 py-3 text-[12px] text-muted sm:px-5">
          <Info size={14} className="mt-0.5 shrink-0" />
          <div>
            当前环境只能弹应用内 / 系统通知；邮件和回调需要桌面 App 或自建后端。
          </div>
        </div>
      )}
      <Row
        title="触发状态"
        description="哪些结果会通知。"
        control={
          <div className="grid w-full gap-2 sm:w-[600px] sm:grid-cols-3">
            <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-[color:var(--w-04)] px-3 py-2 text-[12px]">
              <span>完成</span>
              <Toggle
                checked={draft.on_completed}
                onChange={(on_completed) => patch({ on_completed })}
              />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-[color:var(--w-04)] px-3 py-2 text-[12px]">
              <span>失败</span>
              <Toggle
                checked={draft.on_failed}
                onChange={(on_failed) => patch({ on_failed })}
              />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-[color:var(--w-04)] px-3 py-2 text-[12px]">
              <span>取消</span>
              <Toggle
                checked={draft.on_cancelled}
                onChange={(on_cancelled) => patch({ on_cancelled })}
              />
            </label>
          </div>
        }
      />
      <Row
        title="本地提示"
        description="右上角弹提示；系统通知首次会请求权限。"
        control={
          <div className="grid w-full gap-2 sm:w-[600px] sm:grid-cols-2">
            <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-[color:var(--w-04)] px-3 py-2 text-[12px]">
              <span className="inline-flex items-center gap-2">
                <Bell size={13} />
                应用内
              </span>
              <Toggle
                checked={draft.toast.enabled}
                onChange={(enabled) =>
                  patch({ toast: { ...draft.toast, enabled } })
                }
              />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-[color:var(--w-04)] px-3 py-2 text-[12px]">
              <span className="inline-flex items-center gap-2">
                <Bell size={13} />
                系统通知
              </span>
              <Toggle
                checked={draft.system.enabled}
                onChange={(enabled) =>
                  patch({ system: { ...draft.system, enabled } })
                }
              />
            </label>
          </div>
        }
      />
      {capabilities?.server.email && (
      <Row
        title="邮件通知"
        description="密码支持直接填写 / 环境变量 / 系统钥匙串。"
        control={
          <div className="w-full space-y-2 sm:w-[600px]">
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2 text-[12px] text-muted">
                <Mail size={13} />
                SMTP
              </span>
              <Toggle
                checked={draft.email.enabled}
                onChange={(enabled) => patchEmail({ enabled })}
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_90px_120px]">
              <Input
                value={draft.email.smtp_host}
                onChange={(event) =>
                  patchEmail({ smtp_host: event.target.value })
                }
                placeholder="smtp.example.com"
                size="sm"
                aria-label="SMTP host"
              />
              <Input
                value={String(draft.email.smtp_port || "")}
                onChange={(event) =>
                  patchEmail({ smtp_port: Number(event.target.value) || 587 })
                }
                inputMode="numeric"
                size="sm"
                aria-label="SMTP port"
              />
              <GlassSelect
                value={draft.email.tls}
                onValueChange={(value) =>
                  patchEmail({ tls: value as EmailTlsMode })
                }
                options={TLS_OPTIONS}
                size="sm"
                ariaLabel="SMTP TLS"
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                value={draft.email.from}
                onChange={(event) => patchEmail({ from: event.target.value })}
                placeholder="GPT Image 2 <robot@example.com>"
                size="sm"
                aria-label="邮件发件人"
              />
              <Input
                value={draft.email.username ?? ""}
                onChange={(event) =>
                  patchEmail({ username: event.target.value || undefined })
                }
                placeholder="SMTP 用户名"
                size="sm"
                aria-label="SMTP username"
              />
            </div>
            <CredentialEditor
              credential={draft.email.password}
              onChange={(password) => patchEmail({ password })}
              placeholder="SMTP 密码"
              ariaLabel="SMTP 密码"
            />
            <Textarea
              value={recipientText}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                patchEmail({ to: parseRecipients(event.target.value) })
              }
              placeholder={"owner@example.com\nops@example.com"}
              minHeight={62}
              aria-label="邮件收件人"
            />
          </div>
        }
      />
      )}
      {capabilities?.server.webhook && (
      <Row
        title="Webhook"
        description="转发到你自己的服务地址，可加请求头鉴权。"
        control={
          <div className="w-full space-y-3 sm:w-[600px]">
            {draft.webhooks.length === 0 && (
              <div className="rounded-md border border-dashed border-border px-3 py-3 text-[12px] text-muted">
                暂无 webhook。
              </div>
            )}
            {draft.webhooks.map((webhook, index) => (
              <div
                key={webhook.id}
                className="space-y-2 rounded-lg border border-border bg-[color:var(--w-03)] p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-2 text-[12px] text-muted">
                    <Webhook size={13} />
                    {webhook.name || `Webhook ${index + 1}`}
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    <Toggle
                      checked={webhook.enabled}
                      onChange={(enabled) => patchWebhook(index, { enabled })}
                    />
                    <Button
                      variant="ghost"
                      size="iconSm"
                      icon="trash"
                      onClick={() => removeWebhook(index)}
                      aria-label="删除 webhook"
                    />
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-[120px_minmax(0,1fr)]">
                  <Input
                    value={webhook.name}
                    onChange={(event) =>
                      patchWebhook(index, { name: event.target.value })
                    }
                    placeholder="名称"
                    size="sm"
                    aria-label="Webhook 名称"
                  />
                  <Input
                    value={webhook.url}
                    onChange={(event) =>
                      patchWebhook(index, { url: event.target.value })
                    }
                    placeholder="https://example.com/hook"
                    size="sm"
                    aria-label="Webhook URL"
                  />
                </div>
                <div className="grid gap-2 sm:grid-cols-[120px_110px]">
                  <GlassSelect
                    value={webhook.method || "POST"}
                    onValueChange={(method) => patchWebhook(index, { method })}
                    options={METHOD_OPTIONS}
                    size="sm"
                    ariaLabel="Webhook method"
                  />
                  <Input
                    value={String(webhook.timeout_seconds || 10)}
                    onChange={(event) =>
                      patchWebhook(index, {
                        timeout_seconds: Number(event.target.value) || 10,
                      })
                    }
                    inputMode="numeric"
                    size="sm"
                    aria-label="Webhook timeout"
                  />
                </div>
                <div className="space-y-2">
                  {webhookHeaderEntries(webhook).map(([header, credential]) => (
                    <div
                      key={`${webhook.id}:${header}`}
                      className="grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)_32px]"
                    >
                      <Input
                        value={header}
                        onChange={(event) =>
                          renameHeader(index, header, event.target.value)
                        }
                        placeholder="Authorization"
                        size="sm"
                        monospace
                        aria-label="Webhook header"
                      />
                      <CredentialEditor
                        credential={credential}
                        onChange={(nextCredential) =>
                          updateHeaderCredential(index, header, nextCredential)
                        }
                        placeholder="Bearer ..."
                        ariaLabel={`${header} 值`}
                      />
                      <Button
                        variant="ghost"
                        size="iconSm"
                        icon="x"
                        onClick={() =>
                          updateHeaderCredential(index, header, null)
                        }
                        aria-label="删除 header"
                      />
                    </div>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="plus"
                    onClick={() => addHeader(index)}
                  >
                    添加 Header
                  </Button>
                </div>
              </div>
            ))}
            <Button
              variant="secondary"
              size="sm"
              icon="plus"
              onClick={addWebhook}
            >
              添加 Webhook
            </Button>
          </div>
        }
      />
      )}
      <Row
        title="保存与试发"
        description="试发一条假数据，使用已保存的配置。"
        control={
          <div className="flex w-full flex-wrap justify-end gap-2 sm:w-[600px]">
            <Button
              variant="secondary"
              size="sm"
              disabled={testNotifications.isPending}
              onClick={() => void test("completed")}
            >
              试发完成
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={testNotifications.isPending}
              onClick={() => void test("failed")}
            >
              试发失败
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={testNotifications.isPending}
              onClick={() => void test("cancelled")}
            >
              试发取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={updateNotifications.isPending}
              onClick={() => void save()}
            >
              保存
            </Button>
          </div>
        }
      />
    </Section>
  );
}

function ResultFoldersSection({
  paths,
  configPaths,
}: {
  paths?: PathConfig;
  configPaths?: ConfigPaths;
}) {
  const [draft, setDraft] = useState(() => clonePathConfig(paths));
  const updatePaths = useUpdatePaths();
  const customExport = draft.default_export_dir.mode === "custom";
  const previewExportDir = customExport
    ? (draft.default_export_dir.path ?? "")
    : (configPaths?.default_export_dirs?.[draft.default_export_dir.mode] ??
      configPaths?.default_export_dir ??
      "");
  const canSave = Boolean(api.updatePaths) && api.canExportToConfiguredFolder;

  useEffect(() => {
    setDraft(clonePathConfig(paths));
  }, [paths]);

  const patchExportDir = (next: Partial<PathConfig["default_export_dir"]>) => {
    setDraft((current) => ({
      ...current,
      default_export_dir: {
        ...current.default_export_dir,
        ...next,
      },
    }));
  };

  const save = async () => {
    try {
      const saved = await updatePaths.mutateAsync(
        preparePathConfigForSave(draft),
      );
      setDraft(clonePathConfig(saved.paths));
      toast.success("保存位置已更新");
    } catch (error) {
      toast.error("保存位置更新失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <Section
      title="保存到本机"
      description={
        canSave
          ? "点「保存图片」时，会复制到哪个文件夹。"
          : "网页版会用浏览器下载位置，无法指定本机文件夹。"
      }
      headerAction={
        <Button
          variant="primary"
          size="sm"
          disabled={!canSave || updatePaths.isPending}
          onClick={() => void save()}
        >
          保存设置
        </Button>
      }
    >
      <Row
        title="默认文件夹"
        description="App 历史保留所有图；这里只决定「保存图片」复制到哪里。"
        control={
          <div className="grid w-full gap-2 sm:w-[520px] sm:grid-cols-[170px_minmax(0,1fr)]">
            <GlassSelect
              value={draft.default_export_dir.mode}
              onValueChange={(mode) => {
                const nextMode = mode as PathConfig["default_export_dir"]["mode"];
                patchExportDir({
                  mode: nextMode,
                  path:
                    nextMode === "custom"
                      ? (draft.default_export_dir.path ??
                        configPaths?.default_export_dir ??
                        "")
                      : null,
                });
              }}
              options={EXPORT_DIR_MODE_OPTIONS}
              size="sm"
              ariaLabel="默认保存文件夹"
              disabled={!canSave}
            />
            <Input
              value={previewExportDir}
              onChange={(event) =>
                patchExportDir({ path: event.target.value })
              }
              placeholder={
                customExport
                  ? "/Users/you/Pictures/GPT Image 2"
                  : "按所选模式自动决定"
              }
              disabled={!canSave || !customExport}
              size="sm"
              aria-label="自定义保存文件夹"
            />
          </div>
        }
      />
      <PathRow
        title="当前保存位置"
        path={configPaths?.default_export_dir}
        isFolder
        dim
      />
      <PathRow
        title="App 历史目录"
        path={configPaths?.result_library_dir ?? configPaths?.jobs_dir}
        isFolder
        dim
      />
    </Section>
  );
}

function StoragePanel({
  storage,
  paths,
}: {
  storage?: StorageConfig;
  paths?: PathConfig;
}) {
  const [draft, setDraft] = useState(() => cloneStorageConfig(storage));
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [testedTargets, setTestedTargets] = useState<Set<string>>(
    () => new Set(),
  );
  const updateStorage = useUpdateStorage();
  const testStorage = useTestStorageTarget();
  const copy = runtimeCopy();
  const confirm = useConfirm();
  const requireLocalDirectory = copy.kind !== "browser";
  const { data: configPaths } = useQuery<ConfigPaths>({
    queryKey: ["config-paths"],
    queryFn: api.configPaths,
    staleTime: 60_000,
  });

  useEffect(() => {
    setDraft(cloneStorageConfig(storage));
    setSaveAttempted(false);
    setTestedTargets(new Set());
  }, [storage]);

  const targetEntries = Object.entries(draft.targets);
  const strategyTargetEntries =
    copy.kind === "browser"
      ? targetEntries.filter(([, target]) => storageTargetType(target) === "local")
      : targetEntries;
  const remoteDraftCount =
    copy.kind === "browser"
      ? targetEntries.length - strategyTargetEntries.length
      : 0;
  const targetOptions = targetEntries.map(([name, target]) => ({
    value: name,
    label: `${name} · ${storageTargetLabel(target)}`,
  }));

  const patch = (next: Partial<StorageConfig>) => {
    setDraft((current) => ({ ...current, ...next }));
  };
  const patchTarget = (
    name: string,
    next: Partial<StorageTargetConfig> | StorageTargetConfig,
  ) => {
    setDraft((current) => ({
      ...current,
      targets: {
        ...current.targets,
        [name]: { ...current.targets[name], ...next } as StorageTargetConfig,
      },
    }));
  };
  const setTargetType = (name: string, type: StorageTargetKind) => {
    patchTarget(name, blankStorageTarget(type));
  };
  const addTarget = () => {
    setDraft((current) => {
      let index = Object.keys(current.targets).length + 1;
      let name = `target-${index}`;
      while (current.targets[name]) {
        index += 1;
        name = `target-${index}`;
      }
      return {
        ...current,
        targets: { ...current.targets, [name]: blankStorageTarget("local") },
      };
    });
  };
  const removeTarget = (name: string) => {
    setDraft((current) => {
      const { [name]: _removed, ...targets } = current.targets;
      return {
        ...current,
        targets,
        default_targets: current.default_targets.filter((item) => item !== name),
        fallback_targets: current.fallback_targets.filter(
          (item) => item !== name,
        ),
      };
    });
  };
  const confirmRemoveTarget = async (name: string) => {
    const ok = await confirm({
      title: `删除存储目标「${name}」`,
      description:
        "会从当前存储配置草稿中移除这个目标，并同步从默认目标和回退目标里移除。保存后生效。",
      confirmText: "删除",
      variant: "danger",
    });
    if (ok) removeTarget(name);
  };
  const renameTarget = (name: string, nextName: string) => {
    const clean = nextName.trim();
    if (!clean || clean === name || draft.targets[clean]) return;
    setDraft((current) => {
      const entries = Object.entries(current.targets).map(([key, target]) =>
        key === name ? ([clean, target] as const) : ([key, target] as const),
      );
      return {
        ...current,
        targets: Object.fromEntries(entries),
        default_targets: current.default_targets.map((item) =>
          item === name ? clean : item,
        ),
        fallback_targets: current.fallback_targets.map((item) =>
          item === name ? clean : item,
        ),
      };
    });
  };
  const toggleTargetList = (
    field: "default_targets" | "fallback_targets",
    name: string,
    checked: boolean,
  ) => {
    setDraft((current) => ({
      ...current,
      [field]: checked
        ? Array.from(new Set([...current[field], name]))
        : current[field].filter((item) => item !== name),
    }));
  };
  const addHttpHeader = (name: string) => {
    const target = draft.targets[name];
    if (!target || storageTargetType(target) !== "http" || !("headers" in target))
      return;
    const headers = { ...(target.headers ?? {}) };
    let key = "Authorization";
    let count = 1;
    while (headers[key]) {
      count += 1;
      key = `X-Storage-Secret-${count}`;
    }
    headers[key] = { source: "file", value: "" };
    patchTarget(name, { headers });
  };
  const updateHttpHeader = (
    name: string,
    header: string,
    nextHeader: string,
    credential: CredentialRef | null,
  ) => {
    const target = draft.targets[name];
    if (!target || storageTargetType(target) !== "http" || !("headers" in target))
      return;
    const headers = { ...(target.headers ?? {}) };
    delete headers[header];
    if (credential && nextHeader.trim()) headers[nextHeader] = credential;
    patchTarget(name, { headers });
  };

  const save = async () => {
    setSaveAttempted(true);
    const issue = storageConfigIssue(draft, { requireLocalDirectory });
    if (issue) {
      toast.warning("存储配置未完成", { description: issue });
      return;
    }
    try {
      const saved = await updateStorage.mutateAsync(
        prepareStorageConfigForSave(draft),
      );
      setDraft(cloneStorageConfig(saved.storage));
      setSaveAttempted(false);
      setTestedTargets(new Set());
      toast.success("结果存储已保存");
    } catch (error) {
      toast.error("保存结果存储失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const runTest = async (name: string) => {
    setTestedTargets((current) => new Set(current).add(name));
    const issue = storageTargetConfigIssue(name, draft.targets[name], {
      requireLocalDirectory,
    });
    if (issue) {
      toast.warning("测试失败", { description: issue });
      return;
    }
    try {
      const result = await testStorage.mutateAsync({
        name,
        target: normalizeStorageTargetForSave(draft.targets[name]),
      });
      if (result.ok) {
        toast.success("存储目标可用", { description: result.message });
      } else {
        toast.warning("存储目标不可用", { description: result.message });
      }
    } catch (error) {
      toast.error("测试存储目标失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-auto p-4 sm:p-5 space-y-4">
      <ResultFoldersSection paths={paths} configPaths={configPaths} />

      <Section
        title="投递策略"
        description={
          copy.kind === "browser"
            ? "静态 Web 只保留浏览器本地结果；远端上传需要桌面 App 或服务端 Web。"
            : "任务仍会先写入本地结果目录，再按这里的目标上传或回退。"
        }
      >
        <Row
          title="默认目标"
          description="每个完成任务优先投递到这些目标。"
          control={
            <div className="flex w-full flex-wrap gap-2 sm:w-[520px]">
              {strategyTargetEntries.map(([name]) => (
                <label
                  key={`default-${name}`}
                  className="flex items-center gap-2 rounded-md border border-border bg-[color:var(--w-04)] px-2.5 py-1.5 text-[12px]"
                >
                  <input
                    type="checkbox"
                    checked={draft.default_targets.includes(name)}
                    onChange={(event) =>
                      toggleTargetList(
                        "default_targets",
                        name,
                        event.target.checked,
                      )
                    }
                  />
                  <span>{name}</span>
                </label>
              ))}
              {strategyTargetEntries.length === 0 && (
                <span className="text-[12px] text-muted">暂无目标。</span>
              )}
              {remoteDraftCount > 0 && (
                <span className="text-[12px] text-faint">
                  {remoteDraftCount} 个云端目标已配置但不启用。
                </span>
              )}
            </div>
          }
        />
        <Row
          title="回退目标"
          description="主目标失败后使用；默认本地回退适合保底留存。"
          control={
            <div className="flex w-full flex-wrap gap-2 sm:w-[520px]">
              {strategyTargetEntries.map(([name]) => (
                <label
                  key={`fallback-${name}`}
                  className="flex items-center gap-2 rounded-md border border-border bg-[color:var(--w-04)] px-2.5 py-1.5 text-[12px]"
                >
                  <input
                    type="checkbox"
                    checked={draft.fallback_targets.includes(name)}
                    onChange={(event) =>
                      toggleTargetList(
                        "fallback_targets",
                        name,
                        event.target.checked,
                      )
                    }
                  />
                  <span>{name}</span>
                </label>
              ))}
            </div>
          }
        />
        <Row
          title="失败处理与上传速度"
          description="控制上传失败后是否走回退，以及一次最多同时上传多少内容。"
          control={
            <div className="grid w-full gap-2 sm:w-[620px] lg:grid-cols-[1.15fr_1fr_1fr]">
              <div className="space-y-1">
                <div className="text-[10.5px] font-medium text-muted">
                  主目标失败后
                </div>
                <GlassSelect
                  value={draft.fallback_policy}
                  onValueChange={(fallback_policy) =>
                    patch({
                      fallback_policy:
                        fallback_policy as StorageFallbackPolicy,
                    })
                  }
                  options={STORAGE_FALLBACK_POLICY_OPTIONS}
                  size="sm"
                  ariaLabel="存储回退策略"
                />
              </div>
              <label className="space-y-1">
                <span className="block text-[10.5px] font-medium text-muted">
                  同时上传的图片数
                </span>
                <Input
                  value={String(draft.upload_concurrency)}
                  onChange={(event) =>
                    patch({
                      upload_concurrency: Number(event.target.value) || 1,
                    })
                  }
                  inputMode="numeric"
                  min={1}
                  size="sm"
                  aria-label="同时上传的图片数"
                />
                <span className="block text-[10px] leading-tight text-faint">
                  默认 4，控制多张结果图的上传速度。
                </span>
              </label>
              <label className="space-y-1">
                <span className="block text-[10.5px] font-medium text-muted">
                  每张图同时上传的目标数
                </span>
                <Input
                  value={String(draft.target_concurrency)}
                  onChange={(event) =>
                    patch({
                      target_concurrency: Number(event.target.value) || 1,
                    })
                  }
                  inputMode="numeric"
                  min={1}
                  size="sm"
                  aria-label="每张图同时上传的目标数"
                />
                <span className="block text-[10px] leading-tight text-faint">
                  默认 2，控制同一张图同时写入几个存储。
                </span>
              </label>
            </div>
          }
        />
      </Section>

      <Section title="目标">
        <div className="space-y-3 px-4 py-3.5 sm:px-5">
          {targetEntries.map(([name, target]) => {
            const type = storageTargetType(target);
            const webdavTarget =
              type === "webdav"
                ? (target as WebDavStorageTargetConfig)
                : undefined;
            const httpTarget =
              type === "http" ? (target as HttpStorageTargetConfig) : undefined;
            const sftpTarget =
              type === "sftp" ? (target as SftpStorageTargetConfig) : undefined;
            const baiduTarget =
              type === "baidu_netdisk"
                ? (target as BaiduNetdiskStorageTargetConfig)
                : undefined;
            const pan123Target =
              type === "pan123_open"
                ? (target as Pan123OpenStorageTargetConfig)
                : undefined;
            const targetIssues = visibleStorageTargetIssues(
              name,
              target,
              { saveAttempted, testedTargets },
              { requireLocalDirectory },
            );
            const fieldError = (field: string) =>
              issueForField(targetIssues, field);
            const baiduAuthMode =
              baiduTarget?.auth_mode === "oauth" ? "oauth" : "personal";
            const pan123AuthMode =
              pan123Target?.auth_mode === "access_token"
                ? "access_token"
                : "client";
            return (
              <div
                key={name}
                className="overflow-hidden rounded-lg border border-border bg-[color:var(--w-03)]"
              >
                <div className="flex min-w-0 items-center gap-2 overflow-x-auto border-b border-border bg-[color:var(--w-04)] px-3 py-2">
                  <input
                    defaultValue={name}
                    onBlur={(event) => renameTarget(name, event.target.value)}
                    aria-label="上传位置名称"
                    className="h-7 min-w-[9rem] flex-[1_1_10rem] rounded-md border border-border bg-[color:var(--w-05)] px-2.5 font-mono text-[13px] outline-none transition-colors placeholder:text-faint focus:border-[color:var(--accent-55)] focus:bg-[color:var(--accent-06)] focus:shadow-[0_0_0_3px_var(--accent-14)]"
                  />
                  <div className="min-w-[12rem] flex-[1_1_14rem]">
                    <GlassSelect
                      value={type}
                      onValueChange={(value) =>
                        setTargetType(name, value as StorageTargetKind)
                      }
                      options={STORAGE_TARGET_TYPE_OPTIONS}
                      size="sm"
                      ariaLabel="上传位置类型"
                    />
                  </div>
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center">
                    {type === "baidu_netdisk" && (
                      <HintButton text={BAIDU_NETDISK_HINT} />
                    )}
                    {type === "pan123_open" && (
                      <HintButton text={PAN123_OPEN_HINT} />
                    )}
                  </div>
                  <div className="ml-auto flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="play"
                      disabled={testStorage.isPending}
                      onClick={() => void runTest(name)}
                    >
                      测试
                    </Button>
                    <Button
                      variant="danger"
                      size="iconSm"
                      icon="trash"
                      onClick={() => void confirmRemoveTarget(name)}
                      title="删除上传位置"
                      aria-label="删除上传位置"
                    />
                  </div>
                </div>
                <div className="space-y-2 bg-[color:var(--w-02)] px-3 py-3">
                  {type === "local" && "directory" in target && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <StorageField error={fieldError("directory")} required>
                        <Input
                          value={target.directory}
                          onChange={(event) =>
                            patchTarget(name, { directory: event.target.value })
                          }
                          placeholder="/path/to/storage"
                          size="sm"
                          aria-label="本地目录"
                          aria-invalid={Boolean(fieldError("directory"))}
                        />
                      </StorageField>
                      <StorageField>
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted">
                            <span>公开访问前缀（可选）</span>
                            <HintButton
                              text={LOCAL_PUBLIC_BASE_URL_HINT}
                              ariaLabel="查看公开访问前缀说明"
                            />
                          </div>
                          <Input
                            value={target.public_base_url ?? ""}
                            onChange={(event) =>
                              patchTarget(name, {
                                public_base_url: event.target.value,
                              })
                            }
                            placeholder="https://cdn.example.com/images"
                            size="sm"
                            aria-label="公开访问前缀"
                          />
                          <p className="text-[11px] leading-snug text-muted">
                            用于生成可访问图片 URL；没有静态访问服务时留空。
                          </p>
                        </div>
                      </StorageField>
                    </div>
                  )}
                {type === "s3" && "bucket" in target && (
                  <div className="space-y-2">
                    <div className="grid gap-2 sm:grid-cols-3">
                      <StorageField error={fieldError("bucket")} required>
                        <Input
                          value={target.bucket}
                          onChange={(event) =>
                            patchTarget(name, { bucket: event.target.value })
                          }
                          placeholder="bucket"
                          size="sm"
                          aria-label="S3 bucket"
                          aria-invalid={Boolean(fieldError("bucket"))}
                        />
                      </StorageField>
                      <Input
                        value={target.region ?? ""}
                        onChange={(event) =>
                          patchTarget(name, { region: event.target.value })
                        }
                        placeholder="region"
                        size="sm"
                        aria-label="S3 region"
                      />
                      <Input
                        value={target.prefix ?? ""}
                        onChange={(event) =>
                          patchTarget(name, { prefix: event.target.value })
                        }
                        placeholder="prefix/"
                        size="sm"
                        aria-label="S3 prefix"
                      />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Input
                        value={target.endpoint ?? ""}
                        onChange={(event) =>
                          patchTarget(name, { endpoint: event.target.value })
                        }
                        placeholder="S3 endpoint"
                        size="sm"
                        aria-label="S3 endpoint"
                      />
                      <Input
                        value={target.public_base_url ?? ""}
                        onChange={(event) =>
                          patchTarget(name, {
                            public_base_url: event.target.value,
                          })
                        }
                        placeholder="公开基础 URL"
                        size="sm"
                        aria-label="S3 public base URL"
                      />
                    </div>
                    <StorageField error={fieldError("access_key_id")} required>
                      <CredentialEditor
                        credential={target.access_key_id}
                        onChange={(access_key_id) =>
                          patchTarget(name, { access_key_id })
                        }
                        placeholder="Access Key ID"
                        ariaLabel="S3 Access Key ID"
                        invalid={Boolean(fieldError("access_key_id"))}
                      />
                    </StorageField>
                    <StorageField error={fieldError("secret_access_key")} required>
                      <CredentialEditor
                        credential={target.secret_access_key}
                        onChange={(secret_access_key) =>
                          patchTarget(name, { secret_access_key })
                        }
                        placeholder="Secret Access Key"
                        ariaLabel="S3 Secret Access Key"
                        invalid={Boolean(fieldError("secret_access_key"))}
                      />
                    </StorageField>
                  </div>
                )}
                {webdavTarget && (
                  <div className="space-y-2">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <StorageField error={fieldError("url")} required>
                        <Input
                          value={webdavTarget.url}
                          onChange={(event) =>
                            patchTarget(name, { url: event.target.value })
                          }
                          placeholder="https://dav.example.com/out"
                          size="sm"
                          aria-label="WebDAV URL"
                          aria-invalid={Boolean(fieldError("url"))}
                        />
                      </StorageField>
                      <Input
                        value={webdavTarget.public_base_url ?? ""}
                        onChange={(event) =>
                          patchTarget(name, {
                            public_base_url: event.target.value,
                          })
                        }
                        placeholder="公开基础 URL"
                        size="sm"
                        aria-label="WebDAV public base URL"
                      />
                    </div>
                    <Input
                      value={webdavTarget.username ?? ""}
                      onChange={(event) =>
                        patchTarget(name, { username: event.target.value })
                      }
                      placeholder="username"
                      size="sm"
                      aria-label="WebDAV username"
                    />
                    <CredentialEditor
                      credential={webdavTarget.password}
                      onChange={(password) => patchTarget(name, { password })}
                      placeholder="password"
                      ariaLabel="WebDAV password"
                    />
                  </div>
                )}
                {httpTarget && (
                  <div className="space-y-2">
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_110px_150px]">
                      <StorageField error={fieldError("url")} required>
                        <Input
                          value={httpTarget.url}
                          onChange={(event) =>
                            patchTarget(name, { url: event.target.value })
                          }
                          placeholder="https://upload.example.com"
                          size="sm"
                          aria-label="HTTP upload URL"
                          aria-invalid={Boolean(fieldError("url"))}
                        />
                      </StorageField>
                      <GlassSelect
                        value={httpTarget.method || "POST"}
                        onValueChange={(method) =>
                          patchTarget(name, { method })
                        }
                        options={METHOD_OPTIONS}
                        size="sm"
                        ariaLabel="HTTP method"
                      />
                      <Input
                        value={httpTarget.public_url_json_pointer ?? ""}
                        onChange={(event) =>
                          patchTarget(name, {
                            public_url_json_pointer: event.target.value,
                          })
                        }
                        placeholder="/url"
                        size="sm"
                        aria-label="URL JSON pointer"
                      />
                    </div>
                    {Object.entries(httpTarget.headers ?? {}).map(
                      ([header, credential]) => (
                        <div
                          key={`${name}:${header}`}
                          className="grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)_32px]"
                        >
                          <Input
                            value={header}
                            onChange={(event) =>
                              updateHttpHeader(
                                name,
                                header,
                                event.target.value,
                                credential,
                              )
                            }
                            placeholder="Authorization"
                            size="sm"
                            monospace
                            aria-label="HTTP header"
                          />
                          <CredentialEditor
                            credential={credential}
                            onChange={(nextCredential) =>
                              updateHttpHeader(
                                name,
                                header,
                                header,
                                nextCredential,
                              )
                            }
                            placeholder="Bearer ..."
                            ariaLabel={`${header} 值`}
                          />
                          <Button
                            variant="ghost"
                            size="iconSm"
                            icon="x"
                            onClick={() =>
                              updateHttpHeader(name, header, "", null)
                            }
                            aria-label="删除 HTTP header"
                          />
                        </div>
                      ),
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="plus"
                      onClick={() => addHttpHeader(name)}
                    >
                      添加 Header
                    </Button>
                  </div>
                )}
                {sftpTarget && (
                  <div className="space-y-2">
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_88px_minmax(0,1fr)]">
                      <StorageField error={fieldError("host")} required>
                        <Input
                          value={sftpTarget.host}
                          onChange={(event) =>
                            patchTarget(name, { host: event.target.value })
                          }
                          placeholder="host"
                          size="sm"
                          aria-label="SFTP host"
                          aria-invalid={Boolean(fieldError("host"))}
                        />
                      </StorageField>
                      <Input
                        value={String(sftpTarget.port || 22)}
                        onChange={(event) =>
                          patchTarget(name, {
                            port: Number(event.target.value) || 22,
                          })
                        }
                        inputMode="numeric"
                        size="sm"
                        aria-label="SFTP port"
                      />
                      <StorageField error={fieldError("username")} required>
                        <Input
                          value={sftpTarget.username}
                          onChange={(event) =>
                            patchTarget(name, { username: event.target.value })
                          }
                          placeholder="username"
                          size="sm"
                          aria-label="SFTP username"
                          aria-invalid={Boolean(fieldError("username"))}
                        />
                      </StorageField>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <StorageField error={fieldError("remote_dir")} required>
                        <Input
                          value={sftpTarget.remote_dir}
                          onChange={(event) =>
                            patchTarget(name, { remote_dir: event.target.value })
                          }
                          placeholder="/remote/out"
                          size="sm"
                          aria-label="SFTP remote dir"
                          aria-invalid={Boolean(fieldError("remote_dir"))}
                        />
                      </StorageField>
                      <Input
                        value={sftpTarget.public_base_url ?? ""}
                        onChange={(event) =>
                          patchTarget(name, {
                            public_base_url: event.target.value,
                          })
                        }
                        placeholder="公开基础 URL"
                        size="sm"
                        aria-label="SFTP public base URL"
                      />
                    </div>
                    <StorageField error={fieldError("host_key_sha256")} required>
                      <Input
                        value={sftpTarget.host_key_sha256 ?? ""}
                        onChange={(event) =>
                          patchTarget(name, {
                            host_key_sha256: event.target.value,
                          })
                        }
                        placeholder="SHA256 host key fingerprint"
                        size="sm"
                        aria-label="SFTP host key SHA256"
                        aria-invalid={Boolean(fieldError("host_key_sha256"))}
                      />
                    </StorageField>
                    <StorageField error={fieldError("sftp_auth")} required>
                      <CredentialEditor
                        credential={sftpTarget.password}
                        onChange={(password) => patchTarget(name, { password })}
                        placeholder="password"
                        ariaLabel="SFTP password"
                        invalid={Boolean(fieldError("sftp_auth"))}
                      />
                    </StorageField>
                    <CredentialEditor
                      credential={sftpTarget.private_key}
                      onChange={(private_key) =>
                        patchTarget(name, { private_key })
                      }
                      placeholder="private key"
                      ariaLabel="SFTP private key"
                      invalid={Boolean(fieldError("sftp_auth"))}
                    />
                  </div>
                )}
                {baiduTarget && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Segmented
                        value={baiduAuthMode}
                        onChange={(auth_mode) =>
                          patchTarget(name, { auth_mode })
                        }
                        options={BAIDU_AUTH_MODE_OPTIONS}
                        size="sm"
                        ariaLabel="百度网盘对接方式"
                      />
                      <span className="text-[11px] text-faint">
                        {baiduAuthMode === "personal"
                          ? "个人对接只需要长期 Access Token。"
                          : "OAuth 对接使用应用凭证换取访问令牌。"}
                      </span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <StorageField error={fieldError("app_name")} required>
                        <Input
                          value={baiduTarget.app_name}
                          onChange={(event) =>
                            patchTarget(name, { app_name: event.target.value })
                          }
                          placeholder="应用目录名"
                          size="sm"
                          aria-label="百度网盘应用目录名"
                          aria-invalid={Boolean(fieldError("app_name"))}
                        />
                      </StorageField>
                      <Input
                        value={baiduTarget.remote_dir ?? ""}
                        onChange={(event) =>
                          patchTarget(name, { remote_dir: event.target.value })
                        }
                        placeholder="outputs"
                        size="sm"
                        aria-label="百度网盘远端目录"
                      />
                    </div>
                    <Input
                      value={baiduTarget.public_base_url ?? ""}
                      onChange={(event) =>
                        patchTarget(name, {
                          public_base_url: event.target.value,
                        })
                      }
                      placeholder="公开基础 URL（可选）"
                      size="sm"
                      aria-label="百度网盘公开基础 URL"
                    />
                    {baiduAuthMode === "personal" && (
                      <StorageField error={fieldError("access_token")} required>
                        <CredentialEditor
                          credential={baiduTarget.access_token}
                          onChange={(access_token) =>
                            patchTarget(name, { access_token })
                          }
                          placeholder="Access Token"
                          ariaLabel="百度网盘 Access Token"
                          invalid={Boolean(fieldError("access_token"))}
                        />
                      </StorageField>
                    )}
                    {baiduAuthMode === "oauth" && (
                      <div className="space-y-2">
                        <StorageField error={fieldError("app_key")} required>
                          <Input
                            value={baiduTarget.app_key}
                            onChange={(event) =>
                              patchTarget(name, { app_key: event.target.value })
                            }
                            placeholder="App Key"
                            size="sm"
                            aria-label="百度网盘 App Key"
                            aria-invalid={Boolean(fieldError("app_key"))}
                            suffix={<HintButton text={BAIDU_NETDISK_HINT} />}
                          />
                        </StorageField>
                        <StorageField error={fieldError("secret_key")} required>
                          <CredentialEditor
                            credential={baiduTarget.secret_key}
                            onChange={(secret_key) =>
                              patchTarget(name, { secret_key })
                            }
                            placeholder="Secret Key"
                            ariaLabel="百度网盘 Secret Key"
                            invalid={Boolean(fieldError("secret_key"))}
                          />
                        </StorageField>
                        <StorageField error={fieldError("refresh_token")} required>
                          <CredentialEditor
                            credential={baiduTarget.refresh_token}
                            onChange={(refresh_token) =>
                              patchTarget(name, { refresh_token })
                            }
                            placeholder="Refresh Token"
                            ariaLabel="百度网盘 Refresh Token"
                            invalid={Boolean(fieldError("refresh_token"))}
                          />
                        </StorageField>
                      </div>
                    )}
                  </div>
                )}
                {pan123Target && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Segmented
                        value={pan123AuthMode}
                        onChange={(auth_mode) =>
                          patchTarget(name, { auth_mode })
                        }
                        options={PAN123_AUTH_MODE_OPTIONS}
                        size="sm"
                        ariaLabel="123 网盘对接方式"
                      />
                      <span className="text-[11px] text-faint">
                        {pan123AuthMode === "client"
                          ? "client 对接使用 clientID + clientSecret。"
                          : "accessToken 对接只需要长期 accessToken。"}
                      </span>
                    </div>
                    <Input
                      value={String(pan123Target.parent_id || 0)}
                      onChange={(event) =>
                        patchTarget(name, {
                          parent_id: Number(event.target.value) || 0,
                        })
                      }
                      inputMode="numeric"
                      size="sm"
                      aria-label="123 网盘父目录 ID"
                    />
                    <label className="flex items-center gap-2 rounded-md border border-border bg-[color:var(--w-04)] px-2.5 py-1.5 text-[12px] text-muted">
                      <input
                        type="checkbox"
                        checked={pan123Target.use_direct_link}
                        onChange={(event) =>
                          patchTarget(name, {
                            use_direct_link: event.target.checked,
                          })
                        }
                      />
                      <span>上传后尝试获取直链</span>
                      <HintButton text={PAN123_OPEN_HINT} />
                    </label>
                    {pan123AuthMode === "client" && (
                      <div className="space-y-2">
                        <StorageField error={fieldError("client_id")} required>
                          <Input
                            value={pan123Target.client_id}
                            onChange={(event) =>
                              patchTarget(name, {
                                client_id: event.target.value,
                              })
                            }
                            placeholder="clientID"
                            size="sm"
                            aria-label="123 网盘 clientID"
                            aria-invalid={Boolean(fieldError("client_id"))}
                            suffix={<HintButton text={PAN123_OPEN_HINT} />}
                          />
                        </StorageField>
                        <StorageField error={fieldError("client_secret")} required>
                          <CredentialEditor
                            credential={pan123Target.client_secret}
                            onChange={(client_secret) =>
                              patchTarget(name, { client_secret })
                            }
                            placeholder="clientSecret"
                            ariaLabel="123 网盘 clientSecret"
                            invalid={Boolean(fieldError("client_secret"))}
                          />
                        </StorageField>
                      </div>
                    )}
                    {pan123AuthMode === "access_token" && (
                      <StorageField error={fieldError("access_token")} required>
                        <CredentialEditor
                          credential={pan123Target.access_token}
                          onChange={(access_token) =>
                            patchTarget(name, { access_token })
                          }
                          placeholder="accessToken"
                          ariaLabel="123 网盘 accessToken"
                          invalid={Boolean(fieldError("access_token"))}
                        />
                      </StorageField>
                    )}
                  </div>
                )}
                </div>
              </div>
            );
          })}
          <div className="flex items-center justify-between gap-2">
            <Button variant="secondary" size="sm" icon="plus" onClick={addTarget}>
              添加上传位置
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={updateStorage.isPending}
              onClick={() => void save()}
            >
              保存
            </Button>
          </div>
          {targetOptions.length > 0 && (
            <div className="text-[11px] text-faint">
              当前目标：{targetOptions.map((item) => item.label).join(" / ")}
            </div>
          )}
        </div>
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
            description="本地配置、历史、应用内结果库和保存位置。只读信息。"
          >
            <PathRow title="配置文件" path={paths?.config_file} />
            <PathRow title="历史数据库" path={paths?.history_file} />
            <PathRow
              title="应用内结果库"
              path={paths?.result_library_dir ?? paths?.jobs_dir}
              isFolder
            />
            <PathRow
              title="当前保存位置"
              path={paths?.default_export_dir}
              isFolder
            />
            <PathRow
              title="旧共享目录"
              path={paths?.legacy_jobs_dir}
              isFolder
            />
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
  const reducedMotion = useReducedMotion();

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden px-4 pb-4 pt-3 md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-5 md:px-6 md:pb-6 md:pt-2">
      <SettingsNav tab={tab} setTab={setTab} />

      <div className="surface-panel flex min-h-0 flex-1 flex-col overflow-hidden">
        <PanelHeader tab={tab} />

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={reducedMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            {tab === "creds" && <CredsPanel config={config} />}
            {tab === "appearance" && <AppearancePanel />}
            {tab === "runtime" && <RuntimePanel />}
            {tab === "storage" && (
              <StoragePanel storage={config?.storage} paths={config?.paths} />
            )}
            {tab === "prompts" && <PromptTemplatesPanel />}
            {tab === "about" && <AboutPanel />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
