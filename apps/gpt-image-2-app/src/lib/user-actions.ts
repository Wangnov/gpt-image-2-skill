import { t } from "@/lib/i18n";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { runtimeCopy } from "@/lib/runtime-copy";

function messageFromError(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return t("操作失败，请稍后重试。");
}

export async function copyText(text?: string | null, label = t("内容")) {
  if (!text) {
    toast.error(t("没有可复制的内容"));
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast.success(t("已复制"), {
      description: t("{p0}已复制到剪贴板。", { p0: label }),
    });
    return true;
  } catch (error) {
    toast.error(t("复制失败"), { description: messageFromError(error) });
    return false;
  }
}

export async function saveImages(
  paths: Array<string | undefined | null>,
  label = t("图片"),
) {
  const validPaths = paths.filter((path): path is string => Boolean(path));
  const copy = runtimeCopy();
  if (validPaths.length === 0) {
    toast.error(t("没有可{p0}的图片", { p0: copy.actionVerb }));
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
    toast.error(t("{p0}{p1}失败", { p0: label, p1: copy.actionVerb }), {
      id: toastId,
      description: messageFromError(error),
    });
    return [];
  }
}

export async function saveJobImages(jobId: string, label = t("任务图片")) {
  const copy = runtimeCopy();
  if (!jobId) {
    toast.error(t("没有可{p0}的任务", { p0: copy.actionVerb }));
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
    toast.error(t("{p0}{p1}失败", { p0: label, p1: copy.actionVerb }), {
      id: toastId,
      description: messageFromError(error),
    });
    return [];
  }
}

export async function saveJobOutputImage(
  jobId: string,
  outputIndex: number,
  label = t("图片"),
) {
  const copy = runtimeCopy();
  if (!jobId) {
    toast.error(t("没有可{p0}的图片", { p0: copy.actionVerb }));
    return [];
  }

  const toastId = toast.loading(copy.savingImages(1));
  try {
    const saved = await api.exportJobOutputToConfiguredFolder(
      jobId,
      outputIndex,
    );
    toast.success(copy.savedImagesTitle(saved.length || 1), {
      id: toastId,
      description: copy.savedImagesDescription,
    });
    return saved;
  } catch (error) {
    toast.error(t("{p0}{p1}失败", { p0: label, p1: copy.actionVerb }), {
      id: toastId,
      description: messageFromError(error),
    });
    return [];
  }
}

export async function openPath(path?: string | null) {
  if (!path) {
    toast.error(t("没有可打开的文件"));
    return false;
  }
  try {
    await api.openPath(path);
    return true;
  } catch (error) {
    toast.error(t("打开失败"), { description: messageFromError(error) });
    return false;
  }
}

export async function revealPath(path?: string | null) {
  const copy = runtimeCopy();
  if (!path) {
    toast.error(t("没有可显示的位置"));
    return false;
  }
  try {
    await api.revealPath(path);
    return true;
  } catch (error) {
    toast.error(
      copy.kind === "tauri" ? t("打开文件夹失败") : t("打开位置失败"),
      {
        description: messageFromError(error),
      },
    );
    return false;
  }
}
