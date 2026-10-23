import { t } from "@/lib/i18n";
import { api } from "@/lib/api";
import type { RuntimeKind } from "@/lib/api/types";

type RuntimeCopy = {
  kind: RuntimeKind;
  name: string;
  resultStorage: string;
  actionVerb: string;
  saveImageLabel: string;
  saveSelectedLabel: string;
  saveAllLabel: string;
  saveJobLabel: string;
  savingImages: (count: number) => string;
  savedImagesTitle: (count: number) => string;
  savedImagesDescription: string;
  savingJob: string;
  savedJobTitle: string;
  savedJobDescription: string;
};

const COPIES: Record<RuntimeKind, RuntimeCopy> = {
  tauri: {
    kind: "tauri",
    get name() {
      return t("桌面 App");
    },
    get resultStorage() {
      return t("本次结果文件夹");
    },
    get actionVerb() {
      return t("保存");
    },
    get saveImageLabel() {
      return t("保存图片");
    },
    get saveSelectedLabel() {
      return t("保存选中");
    },
    get saveAllLabel() {
      return t("保存全部");
    },
    get saveJobLabel() {
      return t("保存全部");
    },
    savingImages: () => t("正在保存图片…"),
    savedImagesTitle: (count) =>
      count > 1 ? t("已保存全部图片") : t("图片已保存"),
    get savedImagesDescription() {
      return t("已保存到你设置的文件夹。");
    },
    get savingJob() {
      return t("正在保存任务图片");
    },
    get savedJobTitle() {
      return t("已保存全部图片");
    },
    get savedJobDescription() {
      return t("已保存到你设置的文件夹。");
    },
  },
  http: {
    kind: "http",
    name: "Web",
    get resultStorage() {
      return t("服务端任务");
    },
    get actionVerb() {
      return t("下载");
    },
    get saveImageLabel() {
      return t("下载图片");
    },
    get saveSelectedLabel() {
      return t("下载选中");
    },
    get saveAllLabel() {
      return t("下载全部");
    },
    get saveJobLabel() {
      return t("下载 ZIP");
    },
    savingImages: (count) =>
      count > 1 ? t("正在准备下载图片") : t("正在准备下载图片…"),
    savedImagesTitle: (count) =>
      count > 1 ? t("已开始下载全部图片") : t("已开始下载图片"),
    get savedImagesDescription() {
      return t("浏览器已开始下载图片。");
    },
    get savingJob() {
      return t("正在准备任务 ZIP");
    },
    get savedJobTitle() {
      return t("已开始下载 ZIP");
    },
    get savedJobDescription() {
      return t("浏览器已开始下载任务 ZIP。");
    },
  },
  browser: {
    kind: "browser",
    get name() {
      return t("静态 Web");
    },
    get resultStorage() {
      return t("当前浏览器数据");
    },
    get actionVerb() {
      return t("下载");
    },
    get saveImageLabel() {
      return t("下载图片");
    },
    get saveSelectedLabel() {
      return t("下载选中");
    },
    get saveAllLabel() {
      return t("下载全部");
    },
    get saveJobLabel() {
      return t("下载 ZIP");
    },
    savingImages: (count) =>
      count > 1 ? t("正在准备下载图片") : t("正在准备下载图片…"),
    savedImagesTitle: (count) =>
      count > 1 ? t("已开始下载全部图片") : t("已开始下载图片"),
    get savedImagesDescription() {
      return t("浏览器已开始下载图片。");
    },
    get savingJob() {
      return t("正在准备任务 ZIP");
    },
    get savedJobTitle() {
      return t("已开始下载 ZIP");
    },
    get savedJobDescription() {
      return t("浏览器已开始下载任务 ZIP。");
    },
  },
};

export function runtimeCopy(kind: RuntimeKind = api.kind) {
  return COPIES[kind];
}

export function isDesktopRuntime(kind: RuntimeKind = api.kind) {
  return kind === "tauri";
}

export function resultLocationText(
  selectedLabel: string,
  kind: RuntimeKind = api.kind,
) {
  if (kind === "tauri") {
    return t("候选 {p0} 已保存在本次结果文件夹", { p0: selectedLabel });
  }
  if (kind === "http") {
    return t("候选 {p0} 保存在服务端任务中，可下载查看", { p0: selectedLabel });
  }
  return t("候选 {p0} 保存在当前浏览器数据中，可下载查看", {
    p0: selectedLabel,
  });
}
