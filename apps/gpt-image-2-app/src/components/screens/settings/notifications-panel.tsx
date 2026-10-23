import { t, getLocale } from "@/lib/i18n";
import { useEffect, useMemo, useState } from "react";
import { Info } from "lucide-react";
import { toast } from "sonner";
import { Toggle } from "@/components/ui/toggle";
import {
  useNotificationCapabilities,
  useTestNotifications,
  useUpdateNotifications,
} from "@/hooks/use-config";
import {
  ensureSystemNotificationPermission,
  sendSystemNotification,
} from "@/lib/system-notifications";
import type {
  CredentialRef,
  JobStatus,
  NotificationConfig,
  WebhookNotificationConfig,
} from "@/lib/types";
import { Section } from "./layout";
import { NotificationActionsRow } from "./notification-actions-row";
import { NotificationEmailRow } from "./notification-email-row";
import { NotificationLocalRow } from "./notification-local-row";
import { NotificationStatusRow } from "./notification-status-row";
import { NotificationWebhooksRow } from "./notification-webhooks-row";
import {
  cloneNotificationConfig,
  prepareNotificationConfigForSave,
} from "./settings-utils";

export function NotificationCenterPanel({
  notifications,
}: {
  notifications?: NotificationConfig;
}) {
  const [draft, setDraft] = useState(() =>
    cloneNotificationConfig(notifications),
  );
  const updateNotifications = useUpdateNotifications();
  const testNotifications = useTestNotifications();
  const { data: capabilities } = useNotificationCapabilities();

  useEffect(() => {
    setDraft(cloneNotificationConfig(notifications));
  }, [notifications]);

  const recipientText = useMemo(
    () => draft.email.to.join("\n"),
    [draft.email.to, getLocale()],
  );
  const canUseServerNotifications = Boolean(
    capabilities?.server.email || capabilities?.server.webhook,
  );

  const patch = (next: Partial<NotificationConfig>) => {
    setDraft((current) => ({ ...current, ...next }));
  };
  const patchEmail = (next: Partial<NotificationConfig["email"]>) => {
    setDraft((current) => ({
      ...current,
      email: { ...current.email, ...next },
    }));
  };
  const patchWebhook = (
    index: number,
    next: Partial<WebhookNotificationConfig>,
  ) => {
    setDraft((current) => ({
      ...current,
      webhooks: current.webhooks.map((webhook, itemIndex) =>
        itemIndex === index ? { ...webhook, ...next } : webhook,
      ),
    }));
  };
  const addWebhook = () => {
    setDraft((current) => ({
      ...current,
      webhooks: [
        ...current.webhooks,
        {
          id: `webhook-${Date.now()}`,
          name: "",
          enabled: true,
          url: "",
          method: "POST",
          headers: {},
          timeout_seconds: 10,
        },
      ],
    }));
  };
  const removeWebhook = (index: number) => {
    setDraft((current) => ({
      ...current,
      webhooks: current.webhooks.filter((_, itemIndex) => itemIndex !== index),
    }));
  };
  const addHeader = (index: number) => {
    const webhook = draft.webhooks[index];
    if (!webhook) return;
    const headers = { ...(webhook.headers ?? {}) };
    let key = "Authorization";
    let count = 1;
    while (headers[key]) {
      count += 1;
      key = `X-Webhook-Secret-${count}`;
    }
    headers[key] = { source: "file", value: "" };
    patchWebhook(index, { headers });
  };
  const renameHeader = (index: number, oldName: string, nextName: string) => {
    const webhook = draft.webhooks[index];
    if (!webhook) return;
    const headers = { ...(webhook.headers ?? {}) };
    const credential = headers[oldName];
    delete headers[oldName];
    headers[nextName] = credential;
    patchWebhook(index, { headers });
  };
  const updateHeaderCredential = (
    index: number,
    header: string,
    credential: CredentialRef | null,
  ) => {
    const webhook = draft.webhooks[index];
    if (!webhook) return;
    const headers = { ...(webhook.headers ?? {}) };
    if (credential) headers[header] = credential;
    else delete headers[header];
    patchWebhook(index, { headers });
  };

  const save = async () => {
    try {
      if (draft.enabled && draft.system.enabled) {
        const permission = await ensureSystemNotificationPermission();
        if (!permission.ok) {
          toast.warning(t("系统通知权限未开启"), {
            description:
              permission.message ||
              t("请在系统设置中允许 GPT Image 2 发送通知。"),
          });
        }
      }
      const saved = await updateNotifications.mutateAsync(
        prepareNotificationConfigForSave(draft),
      );
      setDraft(cloneNotificationConfig(saved.notifications));
      toast.success(t("通知中心已保存"));
    } catch (error) {
      toast.error(t("保存通知中心失败"), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const test = async (status: JobStatus) => {
    try {
      const result = await testNotifications.mutateAsync(status);
      const failed = result.deliveries.filter((item) => !item.ok);
      const message =
        failed[0]?.message ||
        result.deliveries.map((item) => item.message).filter(Boolean)[0];
      const localEnabled =
        draft.enabled &&
        ((status === "completed" && draft.on_completed) ||
          (status === "failed" && draft.on_failed) ||
          (status === "cancelled" && draft.on_cancelled));
      const localMessages: string[] = [];
      let localFailure = false;
      if (localEnabled && draft.toast.enabled) {
        const title =
          status === "failed"
            ? t("测试通知失败")
            : status === "cancelled"
              ? t("测试通知已取消")
              : t("测试通知完成");
        toast(status === "failed" ? t("测试通知失败") : title, {
          description: t("应用内通知已触发。"),
        });
        localMessages.push(t("应用内通知已触发"));
      }
      if (localEnabled && draft.system.enabled) {
        const system = await sendSystemNotification(
          t("GPT Image 2 测试通知"),
          status === "failed"
            ? t("这是一条失败状态的系统通知测试。")
            : status === "cancelled"
              ? t("这是一条取消状态的系统通知测试。")
              : t("这是一条完成状态的系统通知测试。"),
        );
        if (system.ok) {
          localMessages.push(t("系统通知已发送"));
        } else {
          localFailure = true;
          localMessages.push(system.message || t("系统通知未发送"));
        }
      }
      if (result.reason === "no_eligible_channel") {
        toast.info(t("没有可发送的方式"), {
          description: t("通知中心已关或未选任何状态 / 方式，不会发出。"),
        });
        return;
      }
      if (result.ok && !localFailure) {
        const description =
          message ||
          localMessages.join("；") ||
          (result.reason === "local_only"
            ? t("未配置邮件 / 回调；已试发本地通知。")
            : undefined);
        toast.success(t("试发已完成"), { description });
      } else {
        toast.warning(t("试发未全部成功"), {
          description: message || localMessages.join("；"),
        });
      }
    } catch (error) {
      toast.error(t("试发失败"), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <Section
      title={t("通知中心")}
      description={t("任务结束时提醒你 — 应用内、系统、邮件或回调。")}
      headerAction={
        <Toggle
          checked={draft.enabled}
          onChange={(enabled) => patch({ enabled })}
        />
      }
    >
      {capabilities && !canUseServerNotifications && (
        <div className="flex items-start gap-2 px-4 py-3 text-[12px] text-muted sm:px-5">
          <Info size={14} className="mt-0.5 shrink-0" />
          <div>
            {t(
              "当前环境只能弹应用内 / 系统通知；邮件和回调需要桌面 App 或自建后端。",
            )}
          </div>
        </div>
      )}
      <NotificationStatusRow draft={draft} patch={patch} />
      <NotificationLocalRow draft={draft} patch={patch} />
      {capabilities?.server.email && (
        <NotificationEmailRow
          email={draft.email}
          recipientText={recipientText}
          patchEmail={patchEmail}
        />
      )}
      {capabilities?.server.webhook && (
        <NotificationWebhooksRow
          webhooks={draft.webhooks}
          patchWebhook={patchWebhook}
          addWebhook={addWebhook}
          removeWebhook={removeWebhook}
          addHeader={addHeader}
          renameHeader={renameHeader}
          updateHeaderCredential={updateHeaderCredential}
        />
      )}
      <NotificationActionsRow
        testing={testNotifications.isPending}
        saving={updateNotifications.isPending}
        test={(status) => void test(status)}
        save={() => void save()}
      />
    </Section>
  );
}
