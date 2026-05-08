import type {
  JobStatus,
  NotificationCapabilities,
  NotificationTestResult,
  StorageTargetConfig,
} from "../../types";
import { normalizeNotificationConfig, storageTargetType } from "../shared";
import type { ConfigPaths } from "../types";
import { prepareBrowserRuntime } from "./queue";
import { readConfigRecord } from "./store";

export async function browserConfigPaths(): Promise<ConfigPaths> {
  await prepareBrowserRuntime();
  return {
    config_dir: "IndexedDB: gpt-image-2-web",
    config_file: "IndexedDB: kv/config",
    history_file: "IndexedDB: jobs",
    jobs_dir: "IndexedDB: outputs",
    app_data_dir: "IndexedDB: gpt-image-2-web",
    result_library_dir: "IndexedDB: outputs",
    default_export_dir: "浏览器默认下载位置",
    default_export_dirs: {
      browser_default: "浏览器默认下载位置",
      downloads: "浏览器默认下载位置",
      documents: "浏览器默认下载位置",
      pictures: "浏览器默认下载位置",
      result_library: "IndexedDB: outputs",
    },
    storage_fallback_dir: "IndexedDB: outputs",
    legacy_codex_config_dir: "",
    legacy_jobs_dir: "",
  };
}

export async function testBrowserNotifications(
  status?: JobStatus,
): Promise<NotificationTestResult> {
  const config = normalizeNotificationConfig(
    (await readConfigRecord()).notifications,
  );
  const allowed =
    (config.enabled ?? true) &&
    ((status === "failed" && config.on_failed) ||
      (status === "cancelled" && config.on_cancelled) ||
      ((!status || status === "completed") && config.on_completed));
  const localChannelEnabled = config.toast.enabled || config.system.enabled;
  if (!allowed || !localChannelEnabled) {
    return {
      ok: false,
      reason: "no_eligible_channel",
      deliveries: [],
    };
  }
  return {
    ok: true,
    reason: "local_only",
    deliveries: [
      {
        channel: "browser",
        name: "Browser runtime",
        ok: true,
        message:
          "已校验本地 toast / 系统通知配置；邮件和 webhook 需要桌面 App 或服务端 Web。",
      },
    ],
  };
}

export function browserNotificationCapabilities(): NotificationCapabilities {
  return {
    system: {
      tauri_native: false,
      browser: typeof window !== "undefined" && "Notification" in window,
    },
    server: { email: false, webhook: false },
  };
}

export async function testBrowserStorageTarget(
  name: string,
  target?: StorageTargetConfig,
) {
  const targetType = storageTargetType(target);
  if (targetType === "local") {
    return {
      ok: true,
      target: name,
      target_type: targetType,
      message:
        "静态 Web 仅会把结果保存在当前浏览器数据中，不会写入服务器或本机目录。",
      local_only: true,
    };
  }
  return {
    ok: false,
    target: name,
    target_type: targetType,
    message:
      "远端存储上传需要桌面 App 或服务端 Web；静态 Web 不会保存远端密钥。",
    unsupported: true,
  };
}
