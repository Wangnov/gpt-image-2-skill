import { toast } from "sonner";
import { api } from "@/lib/api";
import { openQuickLook } from "@/components/ui/quick-look";
import { openJobInHistory, sendImageToEdit } from "@/lib/job-navigation";
import { actionsConfirm } from "./confirm-action";
import { copyImageToClipboard } from "./copy-image";
import { softDeleteJobWithUndo } from "./delete-job";
import { inferImageExtension, inferImageMime } from "./mime";
import { navigateToScreen } from "./navigation";
import { invalidateJobsQueries } from "./query-client";
import type { ImageAction, ImageAsset } from "./types";

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

const copyPrompt: ImageAction = {
  id: "copy-prompt",
  label: () => "复制提示词",
  icon: "copy",
  shortcut: "⇧⌘C",
  group: "transfer",
  // Hide on older jobs without a saved prompt — there's no graceful "fall
  // back to image" here because the user explicitly asked for the prompt.
  isAvailable: ({ asset }) => Boolean(asset.prompt?.trim()),
  execute: async ({ asset }) => {
    if (!asset.prompt) throw new Error("没有提示词。");
    await navigator.clipboard.writeText(asset.prompt);
    toast.success("已复制提示词", { duration: 1_500 });
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
  label: ({ runtime }) =>
    runtime === "tauri" ? "导出到默认文件夹" : "下载图片",
  icon: "download",
  shortcut: "⌘S",
  group: "export",
  isAvailable: () => true,
  execute: async ({ asset, runtime }) => {
    if (runtime === "tauri") {
      if (asset.path) {
        const saved = await api.exportFilesToConfiguredFolder([asset.path]);
        toast.success(`已保存 ${saved.length} 张图片`, { duration: 2_000 });
      } else {
        const saved = await api.exportJobToConfiguredFolder(asset.jobId);
        toast.success(`已保存 ${saved.length} 张图片`, { duration: 2_000 });
      }
      return;
    }
    // Web fallback — trigger an anchor download. Modern Chromium / Safari
    // honor the `download` attribute even cross-origin if CORS allows it.
    const a = document.createElement("a");
    a.href = asset.src;
    a.download = inferDownloadName(asset);
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

const useAsReference: ImageAction = {
  id: "use-as-reference",
  label: () => "用作参考图",
  icon: "arrowin",
  group: "generate",
  isAvailable: ({ asset }) => Boolean(asset.path || asset.src),
  execute: ({ asset }) => {
    sendImageToEdit({
      jobId: asset.jobId,
      outputIndex: asset.outputIndex,
      path: asset.path ?? null,
      url: asset.src,
    });
    navigateToScreen("edit");
  },
};

const editWithPrompt: ImageAction = {
  id: "edit-with-prompt",
  label: () => "用提示词编辑",
  icon: "edit",
  group: "generate",
  isAvailable: ({ asset }) => Boolean(asset.path || asset.src),
  isEnabled: ({ asset }) => Boolean(asset.prompt?.trim()),
  disabledReason: () => "这个任务没有保存提示词",
  execute: ({ asset }) => {
    sendImageToEdit({
      jobId: asset.jobId,
      outputIndex: asset.outputIndex,
      path: asset.path ?? null,
      url: asset.src,
      prompt: asset.prompt,
    });
    navigateToScreen("edit");
  },
};

const revealJobInHistory: ImageAction = {
  id: "reveal-job-in-history",
  label: () => "在历史中查看任务",
  icon: "history",
  group: "manage",
  isAvailable: ({ asset }) => Boolean(asset.jobId),
  execute: ({ asset }) => {
    navigateToScreen("history");
    // openJobInHistory's listener is mounted on the History screen which
    // is always rendered (just hidden). The event is delivered immediately;
    // the history drawer opens once navigation lands.
    openJobInHistory(asset.jobId);
  },
};

const shareAction: ImageAction = {
  id: "share",
  label: () => "分享…",
  icon: "external",
  group: "transfer",
  isAvailable: ({ runtime, asset }) => {
    if (runtime === "tauri") return false;
    if (typeof navigator === "undefined") return false;
    if (typeof navigator.share !== "function") return false;
    return Boolean(asset.src);
  },
  execute: async ({ asset }) => {
    const response = await fetch(asset.src);
    if (!response.ok) {
      throw new Error(`无法读取图片：HTTP ${response.status}`);
    }
    // Match the share payload's mime + filename extension to the actual
    // image format so JPEG/WEBP/GIF jobs don't get sent to native share
    // sheets advertised as PNG (some targets reject the mismatch outright).
    const mime = inferImageMime(asset);
    const ext = inferImageExtension(asset);
    const raw = await response.blob();
    const blob = raw.type === mime ? raw : new Blob([await raw.arrayBuffer()], { type: mime });
    const filename = `${asset.jobId}-${asset.outputIndex}.${ext}`;
    const file = new File([blob], filename, { type: mime });
    const shareData: ShareData = { files: [file] };
    if (asset.prompt) shareData.text = asset.prompt;
    // Some platforms (older Safari) don't support file shares — fall back
    // to URL-only when feature detection fails.
    if (
      typeof navigator.canShare === "function" &&
      !navigator.canShare({ files: [file] })
    ) {
      await navigator.share({
        url: asset.src,
        text: asset.prompt,
      });
      return;
    }
    await navigator.share(shareData);
  },
};

const deleteAction: ImageAction = {
  id: "delete",
  label: () => "删除任务",
  icon: "trash",
  shortcut: "⌘⌫",
  group: "destructive",
  destructive: true,
  isAvailable: () => true,
  execute: async ({ asset, runtime }) => {
    // Important: a Job is the unit of deletion — a multi-output job has
    // all of its outputs grouped under one DB row + one folder. Right-
    // clicking a single output and choosing Delete WILL remove the entire
    // job, so the confirm copy makes that explicit when there's more than
    // one output.
    const outputCount = asset.job?.outputs?.length ?? 1;
    const description =
      outputCount > 1
        ? `这是包含 ${outputCount} 张图的任务，删除会移除整个任务记录和全部 ${outputCount} 张图，无法分别删除单张。`
        : "这会删除这张图和它的任务记录。";
    const ok = await actionsConfirm({
      title: "删除任务？",
      description,
      confirmText: "删除任务",
      variant: "danger",
    });
    if (!ok) return;
    await softDeleteJobWithUndo(asset.jobId, runtime);
    invalidateJobsQueries();
  },
};

export const C2_TRANSFER_EXPORT_MANAGE_ACTIONS: ImageAction[] = [
  copyImage,
  copyPrompt,
  copyPathOrLink,
  saveAs,
  revealInFinder,
  openWithDefault,
  shareAction,
  deleteAction,
];

export const C3_PREVIEW_ACTIONS: ImageAction[] = [quickLook];

export const C4_GENERATE_ACTIONS: ImageAction[] = [
  useAsReference,
  editWithPrompt,
  revealJobInHistory,
];

function inferDownloadName(asset: ImageAsset): string {
  // Prefer a real basename from the URL when present.
  try {
    const url = new URL(asset.src, window.location.href);
    const last = url.pathname.split("/").filter(Boolean).pop();
    if (last && last.includes(".")) return last;
  } catch {
    /* fall through to the fabricated name */
  }
  // Fabricated fallback — must match the asset's true format so OS / app
  // associations don't mis-handle a JPEG/WEBP saved with a `.png`
  // extension. `inferImageExtension` consults metadata.format first, then
  // URL/path extension, before defaulting to png.
  return `${asset.jobId}-${asset.outputIndex}.${inferImageExtension(asset)}`;
}
