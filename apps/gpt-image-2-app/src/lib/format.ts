import { getLocale, t } from "@/lib/i18n";
function parseTime(value: string): Date | null {
  const trimmed = value.trim();
  const numeric = Number(trimmed);
  const d =
    Number.isFinite(numeric) && trimmed !== ""
      ? new Date(numeric < 1_000_000_000_000 ? numeric * 1000 : numeric)
      : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDateTime(value?: string | null): string {
  if (!value) return "—";
  const d = parseTime(value);
  if (!d) return value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatTime(iso: string): string {
  const d = parseTime(iso);
  if (!d) return iso;

  const now = new Date();
  const diffSec = (now.getTime() - d.getTime()) / 1000;
  if (diffSec < 60) return t("刚刚");
  if (diffSec < 3600) return t("{p0} 分钟前", { p0: Math.floor(diffSec / 60) });
  if (diffSec < 86400)
    return t("{p0} 小时前", { p0: Math.floor(diffSec / 3600) });
  return `${d.toLocaleDateString(getLocale())} ${d.toLocaleTimeString(getLocale(), { hour: "2-digit", minute: "2-digit" })}`;
}

export function formatDuration(ms?: number): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function statusLabel(status: string): string {
  const map: Record<string, string> = {
    running: t("运行中"),
    uploading: t("上传中"),
    completed: t("已完成"),
    failed: t("失败"),
    queued: t("排队中"),
    cancelled: t("已取消"),
    canceled: t("已取消"),
  };
  return map[status] ?? status;
}

export function providerKindLabel(kind?: string): string {
  const map: Record<string, string> = {
    "openai-compatible": t("OpenAI 兼容"),
    openai: t("OpenAI 官方"),
    codex: "Codex",
  };
  return kind ? (map[kind] ?? kind) : "—";
}
