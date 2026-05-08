import { toast } from "sonner";
import { api } from "@/lib/api";
import { runtimeCopy } from "@/lib/runtime-copy";

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
  const copy = runtimeCopy();
  if (validPaths.length === 0) {
    toast.error(`没有可${copy.actionVerb}的图片`);
    return [];
  }

  const toastId = toast.loading(copy.savingImages(validPaths.length));
  try {
    const saved = await api.exportFilesToConfiguredFolder(validPaths);
    toast.success(copy.savedImagesTitle(validPaths.length), {
      id: toastId,
      description: copy.savedImagesDescription,
    });
    return saved;
  } catch (error) {
    toast.error(`${label}${copy.actionVerb}失败`, {
      id: toastId,
      description: messageFromError(error),
    });
    return [];
  }
}

export async function saveJobImages(jobId: string, label = "任务图片") {
  const copy = runtimeCopy();
  if (!jobId) {
    toast.error(`没有可${copy.actionVerb}的任务`);
    return [];
  }

  const toastId = toast.loading(copy.savingJob);
  try {
    const saved = await api.exportJobToConfiguredFolder(jobId);
    toast.success(copy.savedJobTitle, {
      id: toastId,
      description: copy.savedJobDescription,
    });
    return saved;
  } catch (error) {
    toast.error(`${label}${copy.actionVerb}失败`, {
      id: toastId,
      description: messageFromError(error),
    });
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
  const copy = runtimeCopy();
  if (!path) {
    toast.error("没有可显示的位置");
    return false;
  }
  try {
    await api.revealPath(path);
    return true;
  } catch (error) {
    toast.error(copy.kind === "tauri" ? "打开文件夹失败" : "打开位置失败", {
      description: messageFromError(error),
    });
    return false;
  }
}
