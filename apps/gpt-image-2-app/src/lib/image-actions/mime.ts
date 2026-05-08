import type { ImageAsset } from "./types";

/**
 * Infer the image mime type for an asset. Used by every web-side path that
 * needs to declare a content type to a Web API (ClipboardItem key, File
 * constructor, navigator.share files) — declaring the wrong mime silently
 * breaks paste targets / share targets on some browsers.
 *
 * Order of preference:
 *   1. `metadata.format` from the originating GenerateRequest (most
 *      authoritative — that's what the backend actually rendered as)
 *   2. URL / path extension (`.jpg`, `.webp`, ...)
 *   3. Default to `image/png`
 */
export function inferImageMime(asset: ImageAsset): string {
  const meta = asset.job?.metadata as { format?: unknown } | undefined;
  if (typeof meta?.format === "string") {
    const fromMeta = formatToMime(meta.format);
    if (fromMeta) return fromMeta;
  }
  const ext = extensionFromUrl(asset.path ?? asset.src);
  if (ext) {
    const fromExt = formatToMime(ext);
    if (fromExt) return fromExt;
  }
  return "image/png";
}

/** File extension to put on a download / share filename. */
export function inferImageExtension(asset: ImageAsset): string {
  const mime = inferImageMime(asset);
  return mimeToExtension(mime);
}

function extensionFromUrl(url: string): string | null {
  const tail = url.toLowerCase().split("?")[0]?.split("#")[0]?.split(".").pop();
  return tail && tail !== url.toLowerCase() ? tail : null;
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

function mimeToExtension(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "png";
  }
}
