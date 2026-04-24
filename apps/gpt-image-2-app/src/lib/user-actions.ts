import { toast } from "sonner";
import { api } from "@/lib/api";

function messageFromError(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "操作失败，请稍后重试。";
}

export async function copyText(text?: string | null, label = "内容") {
  if (!text) {
    toast.error("没有可复制的内容");
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast.success("已复制", { description: `${label}已复制到剪贴板。` });
    return true;
  } catch (error) {
    toast.error("复制失败", { description: messageFromError(error) });
    return false;
  }
}

export async function saveImages(paths: Array<string | undefined | null>, label = "图片") {
  const validPaths = paths.filter((path): path is string => Boolean(path));
  if (validPaths.length === 0) {
    toast.error("没有可保存的图片");
    return [];
  }

  const toastId = toast.loading(validPaths.length > 1 ? "正在保存图片" : "正在保存图片…");
  try {
    const saved = await api.exportFilesToDownloads(validPaths);
    toast.success(validPaths.length > 1 ? "已保存全部图片" : "图片已保存", {
      id: toastId,
      description: api.canExportToDownloadsFolder
        ? "已保存到「下载/GPT Image 2」。"
        : "浏览器已开始下载图片。",
    });
    return saved;
  } catch (error) {
    toast.error(`${label}保存失败`, { id: toastId, description: messageFromError(error) });
    return [];
  }
}

export async function openPath(path?: string | null) {
  if (!path) {
    toast.error("没有可打开的文件");
    return false;
  }
  try {
    await api.openPath(path);
    return true;
  } catch (error) {
    toast.error("打开失败", { description: messageFromError(error) });
    return false;
  }
}

export async function revealPath(path?: string | null) {
  if (!path) {
    toast.error("没有可显示的位置");
    return false;
  }
  try {
    await api.revealPath(path);
    return true;
  } catch (error) {
    toast.error("打开文件夹失败", { description: messageFromError(error) });
    return false;
  }
}
