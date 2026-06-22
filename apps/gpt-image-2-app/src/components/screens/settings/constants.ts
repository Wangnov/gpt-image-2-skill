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
  system: "系统",
  mono: "等宽",
  serif: "衬线",
};

export const DENSITY_LABEL: Record<ThemePreset["suggestedDensity"], string> = {
  compact: "紧凑",
  comfortable: "舒适",
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
  | "about";

export const NAV: { id: SettingsTab; label: string; icon: LucideIcon }[] = [
  { id: "creds", label: "凭证", icon: KeyRound },
  { id: "appearance", label: "外观", icon: Sparkles },
  { id: "runtime", label: "任务", icon: ListChecks },
  { id: "storage", label: "存储", icon: HardDrive },
  { id: "proxy", label: "网络", icon: Network },
  { id: "prompts", label: "模板", icon: FileText },
  { id: "about", label: "关于", icon: Info },
];

// Static Web routes provider traffic through the browser's own stack, so an
// app-level proxy setting has nothing to act on — hide the tab there.
export const BROWSER_HIDDEN_TABS: SettingsTab[] = ["storage", "proxy"];

export const PARALLEL_OPTIONS = [1, 2, 3, 4, 6, 8].map((n) => ({
  value: String(n),
  label: String(n),
}));

export const TLS_OPTIONS = [
  { value: "start-tls", label: "STARTTLS" },
  { value: "smtps", label: "SMTPS" },
  { value: "none", label: "无 TLS" },
] as const;

export const METHOD_OPTIONS = [
  { value: "POST", label: "POST" },
  { value: "PUT", label: "PUT" },
  { value: "PATCH", label: "PATCH" },
] as const;

export const STORAGE_TARGET_TYPE_OPTIONS = [
  { value: "local", label: "本地" },
  { value: "http", label: "HTTP" },
  { value: "s3", label: "S3" },
  { value: "webdav", label: "WebDAV" },
  { value: "sftp", label: "SFTP" },
  { value: "baidu_netdisk", label: "百度网盘 OpenAPI" },
  { value: "pan123_open", label: "123 网盘 OpenAPI" },
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
      ? { value: option.value, label: "服务器目录" }
      : option,
  );
}

export const BAIDU_AUTH_MODE_OPTIONS = [
  { value: "personal", label: "个人对接" },
  { value: "oauth", label: "OAuth 对接" },
] as const;

export const PAN123_AUTH_MODE_OPTIONS = [
  { value: "client", label: "client 对接" },
  { value: "access_token", label: "accessToken 对接" },
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
  const localTerm = onServer ? "服务器" : "本机";
  return [
    {
      value: "local_only",
      label: onServer ? "仅服务器" : "仅本机",
      description: `图片只保存在${localTerm}结果库；不复制到云端。`,
      icon: HardDrive,
    },
    {
      value: "mirror",
      label: `${localTerm}为主，云端备份`,
      description: `${localTerm}为原图，同时异步复制到一个或多个云端归档（双保险）。`,
      icon: Files,
    },
    {
      value: "cloud_primary",
      label: "云端为主",
      description: `云端为原图，${localTerm}仅作上传缓冲；适合多设备共享。`,
      icon: Cloud,
    },
    {
      value: "cloud_archive_only",
      label: "仅推送到云端",
      description: `${localTerm}为原图，云端目标只接收推送（如 Webhook，不可回读）。`,
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
  { value: "never", label: "不清理" },
  {
    value: "after_archive_success",
    label: "归档成功后清理",
  },
  {
    value: "by_age",
    label: "按保留天数清理",
  },
  {
    value: "by_size",
    label: "按上限大小清理",
  },
];

export const CREDENTIAL_SOURCE_OPTIONS = [
  { value: "file", label: "直接填写" },
  { value: "env", label: "环境变量" },
  { value: "keychain", label: "系统钥匙串" },
] as const;

export const BAIDU_NETDISK_HINT = [
  "百度网盘 OpenAPI 对接条件：",
  "创建个人应用，并开通网盘上传权限。",
  "填写 App Key + Secret Key + Refresh Token，或长期 Access Token。",
  "上传路径位于 /apps/{应用名}/，应用名需与开放平台一致。",
].join("\n");

export const PAN123_OPEN_HINT = [
  "123 网盘 OpenAPI 对接条件：",
  "填写长期 Access Token；或配置 clientID + clientSecret。",
  "父目录 ID 默认 0，表示根目录。",
  "直链是可选增强；未开通时仍会上传成功，只是不返回公开 URL。",
].join("\n");

export const LOCAL_PUBLIC_BASE_URL_HINT = [
  "可选。",
  "仅当此目录已经通过 Nginx、CDN 或静态文件服务映射成可访问地址时填写。",
  "上传记录会用它拼出图片 URL；留空时仍会保存到目录。",
].join("\n");

export const EXPORT_DIR_MODE_OPTIONS = [
  { value: "downloads", label: "下载" },
  { value: "documents", label: "文稿" },
  { value: "pictures", label: "图片" },
  { value: "custom", label: "其他文件夹" },
] as const;

/** Global proxy mode picker (settings → 网络). */
export const PROXY_MODE_OPTIONS = [
  { value: "system", label: "跟随系统" },
  { value: "none", label: "直连" },
  { value: "custom", label: "自定义" },
] as const;

/**
 * Per-provider proxy override picker. `inherit` is a UI-only pseudo mode that
 * maps to "no override" (provider.proxy === undefined); `none` / `custom` map
 * to a real override.
 */
export type ProviderProxyMode = "inherit" | "none" | "custom";

export const PROVIDER_PROXY_MODE_OPTIONS = [
  { value: "inherit", label: "跟随全局" },
  { value: "none", label: "强制直连" },
  { value: "custom", label: "自定义" },
] as const;

export const TAB_TITLES: Record<
  SettingsTab,
  { title: string; subtitle: string }
> = {
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
    title: "保存与归档",
    subtitle: "图片保存位置，以及是否自动归档到其他存储",
  },
  proxy: {
    title: "网络代理",
    subtitle: "供应商和 API 请求走系统代理、直连还是自定义代理",
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
