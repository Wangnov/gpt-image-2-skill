export const QUALITY_OPTIONS = [
  { value: "auto", label: "自动" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
] as const;

export const BACKGROUND_OPTIONS = [
  { value: "auto", label: "自动" },
  { value: "opaque", label: "不透明" },
] as const;

export const POPULAR_SIZE_OPTIONS = [
  { value: "auto", label: "自动" },
  { value: "1024x1024", label: "1024x1024 · 方图" },
  { value: "1536x1024", label: "1536x1024 · 横图" },
  { value: "1024x1536", label: "1024x1536 · 竖图" },
  { value: "2048x2048", label: "2048x2048 · 2K 方图" },
  { value: "2048x1152", label: "2048x1152 · 2K 横图" },
  { value: "3840x2160", label: "3840x2160 · 4K 横图" },
  { value: "2160x3840", label: "2160x3840 · 4K 竖图" },
] as const;

const MIN_TOTAL_PIXELS = 655_360;
const MAX_TOTAL_PIXELS = 8_294_400;
const MAX_EDGE = 3_840;
const MAX_ASPECT_RATIO = 3;

export const OUTPUT_COUNT_OPTIONS = [1, 2, 4, 6, 10] as const;
export const OUTPUT_COUNT_MIN = 1;
export const OUTPUT_COUNT_MAX = 10;

export function normalizeImageSize(value: string) {
  const normalized = value.trim().toLowerCase().replaceAll("×", "x");
  if (normalized === "2k") return "2048x2048";
  if (normalized === "4k") return "3840x2160";
  return normalized;
}

export function validateImageSize(value: string) {
  const normalized = normalizeImageSize(value);
  if (!normalized) {
    return { ok: false, message: "尺寸不能为空，可填 auto 或 WIDTHxHEIGHT。" };
  }
  if (normalized === "auto") {
    return { ok: true, normalized };
  }

  const match = normalized.match(/^(\d+)x(\d+)$/);
  if (!match) {
    return { ok: false, message: "尺寸格式应为 auto 或 WIDTHxHEIGHT，例如 1536x1024。" };
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return { ok: false, message: "宽高必须是正整数。" };
  }
  if (width % 16 !== 0 || height % 16 !== 0) {
    return { ok: false, message: "宽高都必须是 16 的倍数。" };
  }
  if (Math.max(width, height) > MAX_EDGE) {
    return { ok: false, message: `最长边不能超过 ${MAX_EDGE}px。` };
  }

  const totalPixels = width * height;
  if (totalPixels < MIN_TOTAL_PIXELS) {
    return { ok: false, message: `总像素不能少于 ${MIN_TOTAL_PIXELS.toLocaleString()}。` };
  }
  if (totalPixels > MAX_TOTAL_PIXELS) {
    return { ok: false, message: `总像素不能超过 ${MAX_TOTAL_PIXELS.toLocaleString()}。` };
  }
  if (Math.max(width, height) / Math.min(width, height) > MAX_ASPECT_RATIO) {
    return { ok: false, message: "长边和短边比例不能超过 3:1。" };
  }
  return { ok: true, normalized: `${width}x${height}` };
}

export function normalizeOutputCount(value: number) {
  if (!Number.isFinite(value)) return OUTPUT_COUNT_MIN;
  return Math.min(OUTPUT_COUNT_MAX, Math.max(OUTPUT_COUNT_MIN, Math.trunc(value)));
}

export function validateOutputCount(value: number) {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return { ok: false, message: "输出数量必须是整数。" };
  }
  if (value < OUTPUT_COUNT_MIN || value > OUTPUT_COUNT_MAX) {
    return { ok: false, message: `输出数量必须在 ${OUTPUT_COUNT_MIN}-${OUTPUT_COUNT_MAX} 之间。` };
  }
  return { ok: true, value };
}
