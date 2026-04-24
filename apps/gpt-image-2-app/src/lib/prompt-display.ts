const DEFAULT_PROMPT_FALLBACK = "未命名图片";

export function promptText(value: unknown, fallback = DEFAULT_PROMPT_FALLBACK) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

export function promptSummary(
  value: unknown,
  limit = 56,
  fallback = DEFAULT_PROMPT_FALLBACK,
) {
  const text = promptText(value, fallback).replace(/\s+/g, " ");
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

export function promptLength(value: unknown) {
  return typeof value === "string" ? value.trim().length : 0;
}
