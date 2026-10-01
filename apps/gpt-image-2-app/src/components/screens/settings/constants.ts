import { t } from "@/lib/i18n";
import {
  Archive,
  Cloud,
  Files,
  FileText,
  HardDrive,
  Info,
  KeyRound,
  ListChecks,
  Network,
  ScrollText,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CleanupMode, PipelineMode } from "@/lib/types";
import type { ThemePreset, ThemePresetId } from "@/lib/theme-presets";

// Visible preset order in the Appearance gallery. Hidden presets join
// at the tail once unlocked (see HIDDEN_PRESETS).
export const PRESET_ORDER: ThemePresetId[] = [
  "logo-grainient",
  "liquid-violet",
  "plasma-sunset",
  "beams-cyan",
  "mesh-mono",
];

export const FONT_LABEL: Record<ThemePreset["suggestedFont"], string> = {
  get system() {
    return t("系统");
  },
  get mono() {
    return t("等宽");
  },
  get serif() {
    return t("衬线");
  },
};

export const DENSITY_LABEL: Record<ThemePreset["suggestedDensity"], string> = {
  get compact() {
    return t("紧凑");
  },
  get comfortable() {
    return t("舒适");
  },
};

/** Custom event emitted when AboutPanel unlocks a hidden preset, so
 *  AppearancePanel can re-read the localStorage-backed unlock set
 *  without prop-drilling or context. */
export const UNLOCK_EVENT = "gpt2:unlocks";

export type SettingsTab =
  | "creds"
  | "appearance"
  | "runtime"
  | "storage"
  | "proxy"
  | "prompts"
  | "logs"
  | "about";

export const NAV: { id: SettingsTab; label: string; icon: LucideIcon }[] = [
  {
    id: "creds",
    get label() {
      return t("凭证");
    },
    icon: KeyRound,
  },
  {
    id: "appearance",
    get label() {
      return t("外观");
    },
    icon: Sparkles,
  },
  {
    id: "runtime",
    get label() {
      return t("任务");
    },
    icon: ListChecks,
  },
  {
    id: "storage",
    get label() {
      return t("存储");
    },
    icon: HardDrive,
  },
  {
    id: "proxy",
    get label() {
      return t("网络");
    },
    icon: Network,
  },
  {
    id: "prompts",
    get label() {
      return t("模板");
    },
    icon: FileText,
  },
  {
    id: "logs",
    get label() {
      return t("日志");
    },
    icon: ScrollText,
  },
  {
    id: "about",
    get label() {
      return t("关于");
    },
    icon: Info,
  },
];

// Static Web has no server-side file logger (logs would be empty) and routes
// provider traffic through the browser's own stack (an app-level proxy has
// nothing to act on), so hide both tabs there alongside the server-only storage
// tab.
export const BROWSER_HIDDEN_TABS: SettingsTab[] = ["storage", "proxy", "logs"];

export const PARALLEL_OPTIONS = [1, 2, 3, 4, 6, 8].map((n) => ({
  value: String(n),
  label: String(n),
}));

export const TLS_OPTIONS = [
  { value: "start-tls", label: "STARTTLS" },
  { value: "smtps", label: "SMTPS" },
  {
    value: "none",
    get label() {
      return t("无 TLS");
    },
  },
] as const;

export const METHOD_OPTIONS = [
  { value: "POST", label: "POST" },
  { value: "PUT", label: "PUT" },
  { value: "PATCH", label: "PATCH" },
] as const;

export const STORAGE_TARGET_TYPE_OPTIONS = [
  {
    value: "local",
    get label() {
      return t("本地");
    },
  },
  { value: "http", label: "HTTP" },
  { value: "s3", label: "S3" },
  { value: "webdav", label: "WebDAV" },
  { value: "sftp", label: "SFTP" },
  {
    value: "baidu_netdisk",
    get label() {
      return t("百度网盘 OpenAPI");
    },
  },
  {
    value: "pan123_open",
    get label() {
      return t("123 网盘 OpenAPI");
    },
  },
] as const;

/**
 * Same list, but `local` reads as "服务器目录" under HTTP runtime so that
 * Docker Web users do not assume the path resolves to their browser
 * machine (it doesn't — it's a server-side container path that needs a
 * volume mount to persist).
 */
export function getStorageTargetTypeOptions(
  runtimeKind: StoragePipelineCopyKind,
) {
  return STORAGE_TARGET_TYPE_OPTIONS.map((option) =>
    option.value === "local" && runtimeKind === "http"
      ? { value: option.value, label: t("服务器目录") }
      : option,
  );
}

export const BAIDU_AUTH_MODE_OPTIONS = [
  {
    value: "personal",
    get label() {
      return t("个人对接");
    },
  },
  {
    value: "oauth",
    get label() {
      return t("OAuth 对接");
    },
  },
] as const;

export const PAN123_AUTH_MODE_OPTIONS = [
  {
    value: "client",
    get label() {
      return t("client 对接");
    },
  },
  {
    value: "access_token",
    get label() {
      return t("accessToken 对接");
    },
  },
] as const;

export interface PipelineModeOption {
  value: PipelineMode;
  label: string;
  description: string;
  icon: LucideIcon;
}

/**
 * "本地" in this UI always means "the machine the result library lives on" —
 * the user's own laptop in Tauri Standalone, but the **Docker server**
 * (volume-mounted host directory) for self-hosted Web. Without runtime-aware
 * copy a Docker user reads "图片只保存在本机" and assumes the file is on
 * their browser machine, which is exactly wrong.
 */
export type StoragePipelineCopyKind = "tauri" | "http" | "browser";

export function getStoragePipelineModeOptions(
  runtimeKind: StoragePipelineCopyKind,
): PipelineModeOption[] {
  const onServer = runtimeKind === "http";
  const localTerm = onServer ? t("服务器") : t("本机");
  return [
    {
      value: "local_only",
      label: onServer ? t("仅服务器") : t("仅本机"),
      description: t("图片只保存在{p0}结果库；不复制到云端。", {
        p0: localTerm,
      }),
      icon: HardDrive,
    },
    {
      value: "mirror",
      label: t("{p0}为主，云端备份", { p0: localTerm }),
      description: t(
        "{p0}为原图，同时异步复制到一个或多个云端归档（双保险）。",
        { p0: localTerm },
      ),
      icon: Files,
    },
    {
      value: "cloud_primary",
      label: t("云端为主"),
      description: t("云端为原图，{p0}仅作上传缓冲；适合多设备共享。", {
        p0: localTerm,
      }),
      icon: Cloud,
    },
    {
      value: "cloud_archive_only",
      label: t("仅推送到云端"),
      description: t(
        "{p0}为原图，云端目标只接收推送（如 Webhook，不可回读）。",
        { p0: localTerm },
      ),
      icon: Archive,
    },
  ];
}

export interface CleanupModeOption {
  value: CleanupMode;
  label: string;
  badge?: string;
  disabled?: boolean;
}

export const STORAGE_CLEANUP_MODE_OPTIONS: CleanupModeOption[] = [
  {
    value: "never",
    get label() {
      return t("不清理");
    },
  },
  {
    value: "after_archive_success",
    get label() {
      return t("归档成功后清理");
    },
  },
  {
    value: "by_age",
    get label() {
      return t("按保留天数清理");
    },
  },
  {
    value: "by_size",
    get label() {
      return t("按上限大小清理");
    },
  },
];

export const CREDENTIAL_SOURCE_OPTIONS = [
  {
    value: "file",
    get label() {
      return t("直接填写");
    },
  },
  {
    value: "env",
    get label() {
      return t("环境变量");
    },
  },
  {
    value: "keychain",
    get label() {
      return t("系统钥匙串");
    },
  },
] as const;

export function baiduNetdiskHint() {
  return [
    t("百度网盘 OpenAPI 对接条件："),
    t("创建个人应用，并开通网盘上传权限。"),
    t("填写 App Key + Secret Key + Refresh Token，或长期 Access Token。"),
    t("上传路径位于 /apps/{应用名}/，应用名需与开放平台一致。"),
  ].join("\n");
}

export function pan123OpenHint() {
  return [
    t("123 网盘 OpenAPI 对接条件："),
    t("填写长期 Access Token；或配置 clientID + clientSecret。"),
    t("父目录 ID 默认 0，表示根目录。"),
    t("直链是可选增强；未开通时仍会上传成功，只是不返回公开 URL。"),
  ].join("\n");
}

export function localPublicBaseUrlHint() {
  return [
    t("可选。"),
    t("仅当此目录已经通过 Nginx、CDN 或静态文件服务映射成可访问地址时填写。"),
    t("上传记录会用它拼出图片 URL；留空时仍会保存到目录。"),
  ].join("\n");
}

export const EXPORT_DIR_MODE_OPTIONS = [
  {
    value: "downloads",
    get label() {
      return t("下载");
    },
  },
  {
    value: "documents",
    get label() {
      return t("文稿");
    },
  },
  {
    value: "pictures",
    get label() {
      return t("图片");
    },
  },
  {
    value: "custom",
    get label() {
      return t("其他文件夹");
    },
  },
] as const;

/** Global proxy mode picker (settings → 网络). */
export const PROXY_MODE_OPTIONS = [
  {
    value: "system",
    get label() {
      return t("跟随系统");
    },
  },
  {
    value: "none",
    get label() {
      return t("直连");
    },
  },
  {
    value: "custom",
    get label() {
      return t("自定义");
    },
  },
] as const;

/**
 * Per-provider proxy override picker. `inherit` is a UI-only pseudo mode that
 * maps to "no override" (provider.proxy === undefined); `none` / `custom` map
 * to a real override.
 */
export type ProviderProxyMode = "inherit" | "none" | "custom";

export const PROVIDER_PROXY_MODE_OPTIONS = [
  {
    value: "inherit",
    get label() {
      return t("跟随全局");
    },
  },
  {
    value: "none",
    get label() {
      return t("强制直连");
    },
  },
  {
    value: "custom",
    get label() {
      return t("自定义");
    },
  },
] as const;

export const TAB_TITLES: Record<
  SettingsTab,
  { title: string; subtitle: string }
> = {
  creds: {
    get title() {
      return t("凭证配置");
    },
    get subtitle() {
      return t("管理用于图像生成的供应商和 API Key");
    },
  },
  appearance: {
    get title() {
      return t("外观");
    },
    get subtitle() {
      return t("液态背景、字体与界面密度");
    },
  },
  runtime: {
    get title() {
      return t("任务");
    },
    get subtitle() {
      return t("同时执行几个任务、结束后怎么提醒");
    },
  },
  storage: {
    get title() {
      return t("保存与归档");
    },
    get subtitle() {
      return t("图片保存位置，以及是否自动归档到其他存储");
    },
  },
  proxy: {
    get title() {
      return t("网络代理");
    },
    get subtitle() {
      return t("供应商和 API 请求走系统代理、直连还是自定义代理");
    },
  },
  prompts: {
    get title() {
      return t("提示词模板");
    },
    get subtitle() {
      return t("管理可复用的生成和编辑提示词");
    },
  },
  logs: {
    get title() {
      return t("日志");
    },
    get subtitle() {
      return t("查看运行诊断日志，排查生成失败的原因");
    },
  },
  about: {
    get title() {
      return t("关于 / 更新");
    },
    get subtitle() {
      return t("版本、更新和数据位置");
    },
  },
};
