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
  if (diffSec < 60) return "刚刚";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`;
  return `${d.toLocaleDateString("zh-CN")} ${d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
}

export function formatDuration(ms?: number): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function statusLabel(status: string): string {
  const map: Record<string, string> = {
    running: "运行中",
    uploading: "上传中",
    completed: "已完成",
    failed: "失败",
    queued: "排队中",
    cancelled: "已取消",
    canceled: "已取消",
  };
  return map[status] ?? status;
}

export function providerKindLabel(kind?: string): string {
  const map: Record<string, string> = {
    "openai-compatible": "OpenAI 兼容",
    openai: "OpenAI 官方",
    codex: "Codex",
  };
  return kind ? (map[kind] ?? kind) : "—";
}
