import { api } from "@/lib/api";
import { inferImageMime } from "./mime";
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

