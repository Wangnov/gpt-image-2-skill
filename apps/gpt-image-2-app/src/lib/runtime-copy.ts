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
    name: "桌面 App",
    resultStorage: "本次结果文件夹",
    actionVerb: "保存",
    saveImageLabel: "保存图片",
    saveSelectedLabel: "保存选中",
    saveAllLabel: "保存全部",
    saveJobLabel: "保存全部",
    savingImages: () => "正在保存图片…",
    savedImagesTitle: (count) => (count > 1 ? "已保存全部图片" : "图片已保存"),
    savedImagesDescription: "已保存到你设置的文件夹。",
    savingJob: "正在保存任务图片",
    savedJobTitle: "已保存全部图片",
    savedJobDescription: "已保存到你设置的文件夹。",
  },
  http: {
    kind: "http",
    name: "Web",
    resultStorage: "服务端任务",
    actionVerb: "下载",
    saveImageLabel: "下载图片",
    saveSelectedLabel: "下载选中",
    saveAllLabel: "下载全部",
    saveJobLabel: "下载 ZIP",
    savingImages: (count) => (count > 1 ? "正在准备下载图片" : "正在准备下载图片…"),
    savedImagesTitle: (count) =>
      count > 1 ? "已开始下载全部图片" : "已开始下载图片",
    savedImagesDescription: "浏览器已开始下载图片。",
    savingJob: "正在准备任务 ZIP",
    savedJobTitle: "已开始下载 ZIP",
    savedJobDescription: "浏览器已开始下载任务 ZIP。",
  },
  browser: {
    kind: "browser",
    name: "静态 Web",
    resultStorage: "当前浏览器数据",
    actionVerb: "下载",
    saveImageLabel: "下载图片",
    saveSelectedLabel: "下载选中",
    saveAllLabel: "下载全部",
    saveJobLabel: "下载 ZIP",
    savingImages: (count) => (count > 1 ? "正在准备下载图片" : "正在准备下载图片…"),
    savedImagesTitle: (count) =>
      count > 1 ? "已开始下载全部图片" : "已开始下载图片",
    savedImagesDescription: "浏览器已开始下载图片。",
    savingJob: "正在准备任务 ZIP",
    savedJobTitle: "已开始下载 ZIP",
    savedJobDescription: "浏览器已开始下载任务 ZIP。",
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
    return `候选 ${selectedLabel} 已保存在本次结果文件夹`;
  }
  if (kind === "http") {
    return `候选 ${selectedLabel} 保存在服务端任务中，可下载查看`;
  }
  return `候选 ${selectedLabel} 保存在当前浏览器数据中，可下载查看`;
}
