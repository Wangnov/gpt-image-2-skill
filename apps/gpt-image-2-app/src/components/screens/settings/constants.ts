import {
  FileText,
  HardDrive,
  Info,
  KeyRound,
  ListChecks,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
  | "prompts"
  | "about";

export const NAV: { id: SettingsTab; label: string; icon: LucideIcon }[] = [
  { id: "creds", label: "凭证", icon: KeyRound },
  { id: "appearance", label: "外观", icon: Sparkles },
  { id: "runtime", label: "任务", icon: ListChecks },
  { id: "storage", label: "存储", icon: HardDrive },
  { id: "prompts", label: "模板", icon: FileText },
  { id: "about", label: "关于", icon: Info },
];

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

export const BAIDU_AUTH_MODE_OPTIONS = [
  { value: "personal", label: "个人对接" },
  { value: "oauth", label: "OAuth 对接" },
] as const;

export const PAN123_AUTH_MODE_OPTIONS = [
  { value: "client", label: "client 对接" },
  { value: "access_token", label: "accessToken 对接" },
] as const;

export const STORAGE_FALLBACK_POLICY_OPTIONS = [
  { value: "on_failure", label: "失败时" },
  { value: "always", label: "总是" },
  { value: "never", label: "关闭" },
] as const;

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
  "仅当本地目录已经通过 Nginx、CDN 或静态文件服务映射成可访问地址时填写。",
  "上传记录会用它拼出图片 URL；留空时仍会保存到本地目录。",
].join("\n");

export const EXPORT_DIR_MODE_OPTIONS = [
  { value: "downloads", label: "下载" },
  { value: "documents", label: "文稿" },
  { value: "pictures", label: "图片" },
  { value: "result_library", label: "应用内结果库" },
  { value: "custom", label: "其他文件夹" },
] as const;

export const TAB_TITLES: Record<SettingsTab, { title: string; subtitle: string }> = {
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
