import { api } from "@/lib/api";
import type { ImageAsset } from "./types";

/**
 * Copy an image to the system clipboard.
 *
 * Tauri: `path` is required. We invoke `copy_image_to_clipboard` Rust command,
 * which reads the file directly from disk and writes a PNG bitmap to the
 * system clipboard via `tauri-plugin-clipboard-manager`. This bypasses the
 * WebKit image-cache eviction bug that makes the webview's default Copy Image
 * unreliable on large or off-screen images.
 *
 * Web (HTTP / Browser): we fetch the image URL and write it through the
 * standard `navigator.clipboard.write` API. Safari requires the blob to be
 * passed to `ClipboardItem` as a Promise (synchronous gesture preservation),
 * which is what `fetchAsBlob()` returns below.
 */
export async function copyImageToClipboard(
  asset: ImageAsset,
  options: { withPrompt?: boolean } = {},
): Promise<void> {
  const wantsPrompt = options.withPrompt === true;
  const promptText = wantsPrompt && asset.prompt ? asset.prompt : null;

  if (api.kind === "tauri") {
    if (!asset.path) {
      throw new Error("Tauri 模式需要本地文件路径来复制图片。");
    }
    await api.copyImageToClipboard(asset.path, promptText);
    return;
  }

  // Web path — `ClipboardItem` accepts a Promise<Blob>, which Safari needs
  // in order to count this as a same-microtask user gesture. The mime is
  // inferred ahead of time from the asset metadata / URL extension so we
  // declare the right ClipboardItem key (PNG / JPEG / WEBP / GIF) — a
  // mismatched declaration silently breaks paste targets on some browsers.
  if (typeof ClipboardItem === "undefined") {
    throw new Error("浏览器不支持 ClipboardItem，无法复制图片。");
  }
  const mime = inferImageMime(asset);
  const items: Record<string, Blob | Promise<Blob>> = {
    [mime]: fetchAsBlob(asset.src, mime),
  };
  if (promptText) {
    items["text/plain"] = new Blob([promptText], { type: "text/plain" });
  }
  await navigator.clipboard.write([new ClipboardItem(items)]);
}

async function fetchAsBlob(src: string, expectedMime: string): Promise<Blob> {
  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`无法读取图片：HTTP ${response.status}`);
  }
  const raw = await response.blob();
  // If the server / blob URL returned a mime that doesn't match what the
  // ClipboardItem key promises (e.g. blob: URLs default to ""), re-wrap so
  // the Blob.type matches the dictionary key — some browsers reject the
  // write otherwise.
  if (raw.type === expectedMime) return raw;
  return new Blob([await raw.arrayBuffer()], { type: expectedMime });
}

/**
 * Infer the image mime type for an asset. Used by the web path to declare
 * the right ClipboardItem key (which must match the blob's mime, otherwise
 * paste targets receive an unrecognized payload).
 *
 * Order of preference:
 *   1. `metadata.format` from the originating GenerateRequest (most
 *      authoritative — that's what the backend actually rendered as)
 *   2. URL extension (`.jpg`, `.webp`, ...)
 *   3. Default to `image/png`
 */
function inferImageMime(asset: ImageAsset): string {
  const meta = asset.job?.metadata as { format?: unknown } | undefined;
  if (typeof meta?.format === "string") {
    const fromMeta = formatToMime(meta.format);
    if (fromMeta) return fromMeta;
  }
  const ext = asset.src
    .toLowerCase()
    .split("?")[0]
    .split("#")[0]
    .split(".")
    .pop();
  if (ext) {
    const fromExt = formatToMime(ext);
    if (fromExt) return fromExt;
  }
  return "image/png";
}

function formatToMime(value: string): string | null {
  switch (value.toLowerCase()) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return null;
  }
}
