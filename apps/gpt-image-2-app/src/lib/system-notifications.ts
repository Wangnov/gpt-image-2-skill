import type { Job } from "@/lib/types";
import { promptSummary } from "@/lib/prompt-display";

type NativeNotificationModule = {
  isPermissionGranted: () => Promise<boolean>;
  requestPermission: () => Promise<"granted" | "denied" | "default">;
  sendNotification: (options: { title: string; body?: string }) => void;
};

function commandLabel(job: Job) {
  return job.command === "images edit" ? "编辑" : "生成";
}

function outputCount(job: Job) {
  if (job.outputs.length > 0) return job.outputs.length;
  return job.output_path ? 1 : 0;
}

export function jobNotificationTitle(job: Job) {
  if (job.status === "completed") return `${commandLabel(job)}完成`;
  if (job.status === "failed") return `${commandLabel(job)}失败`;
  return "任务已取消";
}

export function jobNotificationBody(job: Job) {
  if (job.status === "completed") {
    const parts = [job.provider];
    const size = job.metadata.size;
    if (typeof size === "string" && size) parts.push(size);
    const count = outputCount(job);
    if (count > 0) parts.push(count > 1 ? `${count} 张图片` : "1 张图片");
    return parts.join(" · ");
  }

  const error = job.error as { message?: string } | null | undefined;
  return (
    promptSummary(error?.message, 96, "") ||
    `${job.provider} · ${promptSummary(job.metadata.prompt, 48, commandLabel(job))}`
  );
}

function isTauriRuntime() {
  return Boolean(
    typeof window !== "undefined" &&
    (window.__TAURI_INTERNALS__ || window.__TAURI__),
  );
}

async function loadTauriNotification() {
  if (!isTauriRuntime()) return null;
  try {
    return (await import("@tauri-apps/plugin-notification")) as NativeNotificationModule;
  } catch {
    return null;
  }
}

async function sendTauriNotification(title: string, body: string) {
  const notifications = await loadTauriNotification();
  if (!notifications) return false;
  let granted = await notifications.isPermissionGranted();
  if (!granted) {
    granted = (await notifications.requestPermission()) === "granted";
  }
  if (!granted) return false;
  notifications.sendNotification({ title, body });
  return true;
}

async function sendBrowserNotification(title: string, body: string) {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return false;
  }
  let permission = window.Notification.permission;
  if (permission === "default") {
    permission = await window.Notification.requestPermission();
  }
  if (permission !== "granted") return false;
  new window.Notification(title, { body });
  return true;
}

export async function sendSystemJobNotification(job: Job) {
  const title = jobNotificationTitle(job);
  const body = jobNotificationBody(job);
  if (await sendTauriNotification(title, body)) return true;
  return sendBrowserNotification(title, body);
}
