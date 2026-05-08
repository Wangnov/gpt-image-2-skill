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
