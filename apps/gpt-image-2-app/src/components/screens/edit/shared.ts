import { api } from "@/lib/api";
import { OUTPUT_COUNT_OPTIONS } from "@/lib/image-options";
import type { SendToEditPayload } from "@/lib/job-navigation";
import type { ProviderConfig } from "@/lib/types";
import type { RefImage } from "./reference-card";

export type EditMode = "reference" | "region";
export type RefWithFile = RefImage & { file: File };
export type EditRegionMode = NonNullable<ProviderConfig["edit_region_mode"]>;

export type EditOutput = {
  index: number;
  url?: string;
  selected: boolean;
};

export const MAX_INPUT_IMAGES = 16;

const IMAGE_EXTENSION_BY_TYPE: Record<string, string> = {
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/tiff": "tiff",
  "image/webp": "webp",
};

const TRANSFER_IMAGE_EXTENSION_RE =
  /\.(avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/i;

export const FORMAT_OPTIONS = [
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG" },
  { value: "webp", label: "WEBP" },
];

export const COUNT_OPTIONS = OUTPUT_COUNT_OPTIONS.map((n) => ({
  value: String(n),
  label: String(n),
}));

export function blobFile(blob: Blob, name: string) {
  return new File([blob], name, { type: "image/png" });
}

function basename(value?: string | null) {
  if (!value) return "";
  const clean = value.split(/[?#]/)[0] ?? "";
  return clean.split(/[\\/]/).pop()?.trim() ?? "";
}

function imageExtensionForBlob(blob: Blob, fallbackName: string) {
  const fromType = blob.type ? IMAGE_EXTENSION_BY_TYPE[blob.type] : undefined;
  if (fromType) return fromType;
  const fromName = TRANSFER_IMAGE_EXTENSION_RE.exec(fallbackName)?.[1];
  if (!fromName) return "png";
  const normalized = fromName.toLowerCase();
  return normalized === "jpeg" ? "jpg" : normalized;
}

function imageMimeFromExtension(extension: string) {
  if (extension === "jpg") return "image/jpeg";
  if (extension === "tif") return "image/tiff";
  return `image/${extension}`;
}

function transferFileName(payload: SendToEditPayload, blob: Blob) {
  const raw =
    basename(payload.name) || basename(payload.path) || basename(payload.url);
  if (raw && TRANSFER_IMAGE_EXTENSION_RE.test(raw)) return raw;
  const base =
    raw ||
    [
      "sent-to-edit",
      payload.jobId,
      payload.outputIndex == null ? undefined : payload.outputIndex + 1,
    ]
      .filter(Boolean)
      .join("-");
  return `${base}.${imageExtensionForBlob(blob, raw)}`;
}

function transferSourceUrl(payload: SendToEditPayload) {
  const pathUrl = payload.path ? api.fileUrl(payload.path) : "";
  return pathUrl || payload.url || "";
}

export async function transferredImageFile(payload: SendToEditPayload) {
  const url = transferSourceUrl(payload);
  if (!url) throw new Error("这张图没有可读取的文件路径或预览地址。");
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`读取图片失败：${response.status} ${response.statusText}`);
  }
  const blob = await response.blob();
  if (blob.size <= 0) throw new Error("读取到的图片为空。");
  if (blob.type && !blob.type.startsWith("image/")) {
    throw new Error("读取到的文件不是图片。");
  }
  const name = transferFileName(payload, blob);
  const extension = imageExtensionForBlob(blob, name);
  return new File([blob], name, {
    type: blob.type || imageMimeFromExtension(extension),
    lastModified: Date.now(),
  });
}

export function regionModeLabel(mode: EditRegionMode) {
  if (mode === "native-mask") return "精确遮罩";
  if (mode === "reference-hint") return "软选区参考";
  return "不支持局部编辑";
}

export function clampZoom(value: number) {
  return Math.min(4, Math.max(0.08, value));
}
