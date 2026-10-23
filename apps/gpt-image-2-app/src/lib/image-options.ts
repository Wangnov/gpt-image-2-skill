import { t } from "@/lib/i18n";
export const QUALITY_OPTIONS = [
  {
    value: "auto",
    get label() {
      return t("自动");
    },
  },
  {
    value: "low",
    get label() {
      return t("低");
    },
  },
  {
    value: "medium",
    get label() {
      return t("中");
    },
  },
  {
    value: "high",
    get label() {
      return t("高");
    },
  },
  {
    value: "xhigh",
    get label() {
      return t("超高（2.5）");
    },
  },
  {
    value: "max",
    get label() {
      return t("最高（2.5）");
    },
  },
] as const;

export const BACKGROUND_OPTIONS = [
  {
    value: "auto",
    get label() {
      return t("自动");
    },
  },
  {
    value: "opaque",
    get label() {
      return t("不透明");
    },
  },
] as const;

export const POPULAR_SIZE_OPTIONS = [
  {
    value: "auto",
    get label() {
      return t("自动");
    },
    get description() {
      return t("由模型自行决定");
    },
  },
  {
    value: "1024x1024",
    get label() {
      return t("1:1 · 方图 1K");
    },
    description: "1024 × 1024",
  },
  {
    value: "2048x2048",
    get label() {
      return t("1:1 · 方图 2K");
    },
    description: "2048 × 2048",
  },
  {
    value: "1536x1024",
    get label() {
      return t("3:2 · 横图");
    },
    description: "1536 × 1024",
  },
  {
    value: "1024x1536",
    get label() {
      return t("2:3 · 竖图");
    },
    description: "1024 × 1536",
  },
  {
    value: "2048x1152",
    get label() {
      return t("16:9 · 横图 2K");
    },
    description: "2048 × 1152",
  },
  {
    value: "1152x2048",
    get label() {
      return t("9:16 · 竖图 2K");
    },
    description: "1152 × 2048",
  },
  {
    value: "3840x2160",
    get label() {
      return t("16:9 · 4K 横图");
    },
    description: "3840 × 2160",
  },
  {
    value: "2160x3840",
    get label() {
      return t("9:16 · 4K 竖图");
    },
    description: "2160 × 3840",
  },
  {
    value: "2520x1080",
    get label() {
      return t("21:9 · 超宽");
    },
    description: "2520 × 1080",
  },
  {
    value: "3360x1440",
    get label() {
      return t("21:9 · 超宽 2K");
    },
    description: "3360 × 1440",
  },
  { value: "1280x720", label: "16:9 · 720p", description: "1280 × 720" },
  {
    value: "1080x1080",
    get label() {
      return t("Instagram 方");
    },
    description: "1080 × 1080",
  },
] as const;

const MIN_TOTAL_PIXELS = 655_360;
const MAX_TOTAL_PIXELS = 8_294_400;
const MAX_EDGE = 3_840;
const MAX_ASPECT_RATIO = 3;

export const OUTPUT_COUNT_OPTIONS = [1, 2, 3, 4, 6, 8, 10] as const;
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
    return {
      ok: false,
      message: t("尺寸不能为空，可填 auto 或 WIDTHxHEIGHT。"),
    };
  }
  if (normalized === "auto") {
    return { ok: true, normalized };
  }

  const match = normalized.match(/^(\d+)x(\d+)$/);
  if (!match) {
    return {
      ok: false,
      message: t("尺寸格式应为 auto 或 WIDTHxHEIGHT，例如 1536x1024。"),
    };
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return { ok: false, message: t("宽高必须是正整数。") };
  }
  if (width % 16 !== 0 || height % 16 !== 0) {
    return { ok: false, message: t("宽高都必须是 16 的倍数。") };
  }
  if (Math.max(width, height) > MAX_EDGE) {
    return {
      ok: false,
      message: t("最长边不能超过 {p0}px。", { p0: MAX_EDGE }),
    };
  }

  const totalPixels = width * height;
  if (totalPixels < MIN_TOTAL_PIXELS) {
    return {
      ok: false,
      message: t("总像素不能少于 {p0}。", {
        p0: MIN_TOTAL_PIXELS.toLocaleString(),
      }),
    };
  }
  if (totalPixels > MAX_TOTAL_PIXELS) {
    return {
      ok: false,
      message: t("总像素不能超过 {p0}。", {
        p0: MAX_TOTAL_PIXELS.toLocaleString(),
      }),
    };
  }
  if (Math.max(width, height) / Math.min(width, height) > MAX_ASPECT_RATIO) {
    return { ok: false, message: t("长边和短边比例不能超过 3:1。") };
  }
  return { ok: true, normalized: `${width}x${height}` };
}

export function normalizeOutputCount(value: number) {
  if (!Number.isFinite(value)) return OUTPUT_COUNT_MIN;
  return Math.min(
    OUTPUT_COUNT_MAX,
    Math.max(OUTPUT_COUNT_MIN, Math.trunc(value)),
  );
}

export function validateOutputCount(value: number) {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return { ok: false, message: t("输出数量必须是整数。") };
  }
  if (value < OUTPUT_COUNT_MIN || value > OUTPUT_COUNT_MAX) {
    return {
      ok: false,
      message: t("输出数量必须在 {p0}-{p1} 之间。", {
        p0: OUTPUT_COUNT_MIN,
        p1: OUTPUT_COUNT_MAX,
      }),
    };
  }
  return { ok: true, value };
}
