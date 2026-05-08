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

  // Web path — `ClipboardItem` accepts a Promise<Blob>, which Safari needs in
  // order to count this as a same-microtask user gesture.
  const items: Record<string, Blob | Promise<Blob>> = {
    "image/png": fetchAsBlob(asset.src),
  };
  if (promptText) {
    items["text/plain"] = new Blob([promptText], { type: "text/plain" });
  }
  if (typeof ClipboardItem === "undefined") {
    throw new Error("浏览器不支持 ClipboardItem，无法复制图片。");
  }
  await navigator.clipboard.write([new ClipboardItem(items)]);
}

async function fetchAsBlob(src: string): Promise<Blob> {
  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`无法读取图片：HTTP ${response.status}`);
  }
  return response.blob();
}
