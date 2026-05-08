import { toast } from "sonner";
import { api } from "@/lib/api";
import { openQuickLook } from "@/components/ui/quick-look";
import { copyImageToClipboard } from "./copy-image";
import { softDeleteJobWithUndo } from "./delete-job";
import { invalidateJobsQueries } from "./query-client";
import type { ImageAction } from "./types";

/**
 * Concrete `ImageAction` definitions registered in `registry.ts`. Each entry
 * combines its UI metadata (label / icon / shortcut hint / group) with a
 * runtime-aware `isAvailable` predicate and the actual `execute` function.
 *
 * Successor commits add: Use as Reference / Edit with Prompt / Reveal Job
 * (C4), Copy with Prompt / Drag-out / Share (C5), Quick Look (C3 wires up
 * Space + the action). Variations and Upscale stay out of scope until the
 * backend supports them.
 */

const quickLook: ImageAction = {
  id: "quick-look",
  // Quick Look isn't shown inside the right-click menu — Space is a much
  // stickier mental model for it, and the action would just bloat the menu.
  // Hover toolbar (first slot) and command palette still see it.
  label: () => "快速查看",
  icon: "eye",
  shortcut: "Space",
  group: "transfer",
  isAvailable: ({ surface, asset }) =>
    surface !== "context-menu" && Boolean(asset.src),
  execute: ({ asset }) => {
    openQuickLook({ asset });
  },
};

const copyImage: ImageAction = {
  id: "copy-image",
  label: () => "复制图片",
  icon: "copy",
  shortcut: "⌘C",
  group: "transfer",
  isAvailable: () => true,
  isEnabled: ({ asset, runtime }) => {
    if (runtime === "tauri") return Boolean(asset.path);
    return Boolean(asset.src);
  },
  execute: async ({ asset }) => {
    await copyImageToClipboard(asset);
    toast.success("已复制图片", { duration: 1_500 });
  },
};

const copyPathOrLink: ImageAction = {
  id: "copy-path-or-link",
  label: ({ runtime }) => (runtime === "tauri" ? "复制文件路径" : "复制链接"),
  icon: "external",
  shortcut: "⌥⌘C",
  group: "transfer",
  isAvailable: ({ runtime, asset }) => {
    // Browser runtime serves images as ephemeral blob: URLs that are useless
    // outside the current tab; only show the action when there's a stable
    // string to paste somewhere meaningful.
    if (runtime === "browser") return false;
    if (runtime === "tauri") return Boolean(asset.path);
    return Boolean(asset.src);
  },
  execute: async ({ asset, runtime }) => {
    const value = runtime === "tauri" ? asset.path ?? "" : asset.src;
    if (!value) throw new Error("没有可复制的路径或链接。");
    await navigator.clipboard.writeText(value);
    toast.success(runtime === "tauri" ? "已复制路径" : "已复制链接", {
      duration: 1_500,
    });
  },
};

const saveAs: ImageAction = {
  id: "save-as",
  label: () => "保存到下载文件夹",
  icon: "download",
  shortcut: "⌘S",
  group: "export",
  isAvailable: () => true,
  execute: async ({ asset, runtime }) => {
    if (runtime === "tauri") {
      if (asset.path) {
        const saved = await api.exportFilesToDownloads([asset.path]);
        toast.success(`已保存 ${saved.length} 张图片`, { duration: 2_000 });
      } else {
        const saved = await api.exportJobToDownloads(asset.jobId);
        toast.success(`已保存 ${saved.length} 张图片`, { duration: 2_000 });
      }
      return;
    }
    // Web fallback — trigger an anchor download. Modern Chromium / Safari
    // honor the `download` attribute even cross-origin if CORS allows it.
    const a = document.createElement("a");
    a.href = asset.src;
    a.download = inferDownloadName(asset.src, asset.jobId, asset.outputIndex);
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast.success("已开始下载", { duration: 1_500 });
  },
};

const revealInFinder: ImageAction = {
  id: "reveal-in-finder",
  label: () => "在 Finder 中显示",
  icon: "folder",
  shortcut: "⌥⌘R",
  group: "export",
  isAvailable: ({ runtime, asset }) =>
    runtime === "tauri" && Boolean(asset.path),
  execute: async ({ asset }) => {
    if (!asset.path) throw new Error("无可定位的路径。");
    await api.revealPath(asset.path);
  },
};

const openWithDefault: ImageAction = {
  id: "open-with-default",
  label: () => "用默认应用打开",
  icon: "external",
  group: "export",
  isAvailable: ({ runtime, asset }) =>
    runtime === "tauri" && Boolean(asset.path),
  execute: async ({ asset }) => {
    if (!asset.path) throw new Error("无可打开的路径。");
    await api.openPath(asset.path);
  },
};

const deleteAction: ImageAction = {
  id: "delete",
  label: () => "删除",
  icon: "trash",
  shortcut: "⌘⌫",
  group: "destructive",
  destructive: true,
  isAvailable: () => true,
  execute: async ({ asset, runtime }) => {
    await softDeleteJobWithUndo(asset.jobId, runtime);
    invalidateJobsQueries();
  },
};

export const C2_TRANSFER_EXPORT_MANAGE_ACTIONS: ImageAction[] = [
  copyImage,
  copyPathOrLink,
  saveAs,
  revealInFinder,
  openWithDefault,
  deleteAction,
];

export const C3_PREVIEW_ACTIONS: ImageAction[] = [quickLook];

function inferDownloadName(
  src: string,
  jobId: string,
  index: number,
): string {
  try {
    const url = new URL(src, window.location.href);
    const last = url.pathname.split("/").filter(Boolean).pop();
    if (last && last.includes(".")) return last;
  } catch {
    /* fall through to the fabricated name */
  }
  return `${jobId}-${index}.png`;
}
