import { useEffect, useMemo, useState } from "react";
import { Info } from "lucide-react";
import { toast } from "sonner";
import { Toggle } from "@/components/ui/toggle";
import {
  useNotificationCapabilities,
  useTestNotifications,
  useUpdateNotifications,
} from "@/hooks/use-config";
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
    [draft.email.to],
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
      const saved = await updateNotifications.mutateAsync(
        prepareNotificationConfigForSave(draft),
      );
      setDraft(cloneNotificationConfig(saved.notifications));
      toast.success("通知中心已保存");
    } catch (error) {
      toast.error("保存通知中心失败", {
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
      if (result.reason === "no_eligible_channel") {
        toast.info("没有可发送的方式", {
          description: "通知中心已关或未选任何状态 / 方式，不会发出。",
        });
        return;
      }
      if (result.ok) {
        const description =
          message ||
          (result.reason === "local_only"
            ? "未配置邮件 / 回调；真实任务结束时仍会弹应用内 / 系统通知。"
            : undefined);
        toast.success("试发已完成", { description });
      } else {
        toast.warning("试发未全部成功", { description: message });
      }
    } catch (error) {
      toast.error("试发失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <Section
      title="通知中心"
      description="任务结束时提醒你 — 应用内、系统、邮件或回调。"
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
            当前环境只能弹应用内 / 系统通知；邮件和回调需要桌面 App 或自建后端。
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
