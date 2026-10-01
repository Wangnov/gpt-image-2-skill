import { t } from "@/lib/i18n";
import type { Job } from "@/lib/types";
import { promptSummary } from "@/lib/prompt-display";

type NativeNotificationModule = {
  isPermissionGranted: () => Promise<boolean>;
  requestPermission: () => Promise<"granted" | "denied" | "default">;
  sendNotification: (options: { title: string; body?: string }) => void;
};

export type SystemNotificationResult = {
  ok: boolean;
  channel?: "tauri" | "browser";
  reason?: "unsupported" | "permission_denied" | "send_failed";
  message?: string;
};

function commandLabel(job: Job) {
  return job.command === "images edit" ? t("编辑") : t("生成");
}

function outputCount(job: Job) {
  if (job.outputs.length > 0) return job.outputs.length;
  return job.output_path ? 1 : 0;
}

export function jobNotificationTitle(job: Job) {
  if (job.status === "completed")
    return t("{p0}完成", { p0: commandLabel(job) });
  if (job.status === "partial_failed")
    return t("{p0}部分完成", { p0: commandLabel(job) });
  if (job.status === "failed") return t("{p0}失败", { p0: commandLabel(job) });
  return t("任务已取消");
}

export function jobNotificationBody(job: Job) {
  if (job.status === "completed" || job.status === "partial_failed") {
    const parts = [job.provider];
    const size = job.metadata.size;
    if (typeof size === "string" && size) parts.push(size);
    const count = outputCount(job);
    if (count > 0)
      parts.push(count > 1 ? t("{p0} 张图片", { p0: count }) : t("1 张图片"));
    if (job.status === "partial_failed") {
      const error = job.error as { message?: string } | null | undefined;
      if (error?.message) parts.push(promptSummary(error.message, 64, ""));
    }
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

async function ensureTauriNotificationPermission() {
  const notifications = await loadTauriNotification();
  if (!notifications) return null;
  let granted = await notifications.isPermissionGranted();
  if (!granted) {
    granted = (await notifications.requestPermission()) === "granted";
  }
  return granted;
}

async function ensureBrowserNotificationPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return null;
  }
  let permission = window.Notification.permission;
  if (permission === "default") {
    permission = await window.Notification.requestPermission();
  }
  return permission === "granted";
}

export async function ensureSystemNotificationPermission(): Promise<SystemNotificationResult> {
  const tauriPermission = await ensureTauriNotificationPermission();
  if (tauriPermission === true) return { ok: true, channel: "tauri" };
  if (tauriPermission === false) {
    return {
      ok: false,
      channel: "tauri",
      reason: "permission_denied",
      message: t("系统通知权限未开启。"),
    };
  }

  const browserPermission = await ensureBrowserNotificationPermission();
  if (browserPermission === true) return { ok: true, channel: "browser" };
  if (browserPermission === false) {
    return {
      ok: false,
      channel: "browser",
      reason: "permission_denied",
      message: t("浏览器通知权限未开启。"),
    };
  }

  return {
    ok: false,
    reason: "unsupported",
    message: t("当前环境不支持系统通知。"),
  };
}

export async function sendSystemNotification(
  title: string,
  body: string,
): Promise<SystemNotificationResult> {
  const notifications = await loadTauriNotification();
  if (notifications) {
    const permission = await ensureTauriNotificationPermission();
    if (!permission) {
      return {
        ok: false,
        channel: "tauri",
        reason: "permission_denied",
        message: t("系统通知权限未开启。"),
      };
    }
    try {
      notifications.sendNotification({ title, body });
      return { ok: true, channel: "tauri" };
    } catch (error) {
      return {
        ok: false,
        channel: "tauri",
        reason: "send_failed",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const browserPermission = await ensureBrowserNotificationPermission();
  if (browserPermission === true) {
    new window.Notification(title, { body });
    return { ok: true, channel: "browser" };
  }
  if (browserPermission === false) {
    return {
      ok: false,
      channel: "browser",
      reason: "permission_denied",
      message: t("浏览器通知权限未开启。"),
    };
  }
  return {
    ok: false,
    reason: "unsupported",
    message: t("当前环境不支持系统通知。"),
  };
}

export async function sendSystemJobNotification(job: Job) {
  const title = jobNotificationTitle(job);
  const body = jobNotificationBody(job);
  return sendSystemNotification(title, body);
}
