import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import { Bell, Info, Mail, Webhook } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GlassSelect } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import {
  useNotificationCapabilities,
  useTestNotifications,
  useUpdateNotifications,
} from "@/hooks/use-config";
import type {
  CredentialRef,
  EmailTlsMode,
  JobStatus,
  NotificationConfig,
  WebhookNotificationConfig,
} from "@/lib/types";
import { METHOD_OPTIONS, TLS_OPTIONS } from "./constants";
import { CredentialEditor } from "./credential-editor";
import { Row, Section } from "./layout";
import {
  cloneNotificationConfig,
  parseRecipients,
  prepareNotificationConfigForSave,
  webhookHeaderEntries,
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
      <Row
        title="触发状态"
        description="哪些结果会通知。"
        control={
          <div className="grid w-full gap-2 sm:w-[600px] sm:grid-cols-3">
            <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-[color:var(--w-04)] px-3 py-2 text-[12px]">
              <span>完成</span>
              <Toggle
                checked={draft.on_completed}
                onChange={(on_completed) => patch({ on_completed })}
              />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-[color:var(--w-04)] px-3 py-2 text-[12px]">
              <span>失败</span>
              <Toggle
                checked={draft.on_failed}
                onChange={(on_failed) => patch({ on_failed })}
              />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-[color:var(--w-04)] px-3 py-2 text-[12px]">
              <span>取消</span>
              <Toggle
                checked={draft.on_cancelled}
                onChange={(on_cancelled) => patch({ on_cancelled })}
              />
            </label>
          </div>
        }
      />
      <Row
        title="本地提示"
        description="右上角弹提示；系统通知首次会请求权限。"
        control={
          <div className="grid w-full gap-2 sm:w-[600px] sm:grid-cols-2">
            <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-[color:var(--w-04)] px-3 py-2 text-[12px]">
              <span className="inline-flex items-center gap-2">
                <Bell size={13} />
                应用内
              </span>
              <Toggle
                checked={draft.toast.enabled}
                onChange={(enabled) =>
                  patch({ toast: { ...draft.toast, enabled } })
                }
              />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-[color:var(--w-04)] px-3 py-2 text-[12px]">
              <span className="inline-flex items-center gap-2">
                <Bell size={13} />
                系统通知
              </span>
              <Toggle
                checked={draft.system.enabled}
                onChange={(enabled) =>
                  patch({ system: { ...draft.system, enabled } })
                }
              />
            </label>
          </div>
        }
      />
      {capabilities?.server.email && (
      <Row
        title="邮件通知"
        description="密码支持直接填写 / 环境变量 / 系统钥匙串。"
        control={
          <div className="w-full space-y-2 sm:w-[600px]">
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2 text-[12px] text-muted">
                <Mail size={13} />
                SMTP
              </span>
              <Toggle
                checked={draft.email.enabled}
                onChange={(enabled) => patchEmail({ enabled })}
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_90px_120px]">
              <Input
                value={draft.email.smtp_host}
                onChange={(event) =>
                  patchEmail({ smtp_host: event.target.value })
                }
                placeholder="smtp.example.com"
                size="sm"
                aria-label="SMTP host"
              />
              <Input
                value={String(draft.email.smtp_port || "")}
                onChange={(event) =>
                  patchEmail({ smtp_port: Number(event.target.value) || 587 })
                }
                inputMode="numeric"
                size="sm"
                aria-label="SMTP port"
              />
              <GlassSelect
                value={draft.email.tls}
                onValueChange={(value) =>
                  patchEmail({ tls: value as EmailTlsMode })
                }
                options={TLS_OPTIONS}
                size="sm"
                ariaLabel="SMTP TLS"
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                value={draft.email.from}
                onChange={(event) => patchEmail({ from: event.target.value })}
                placeholder="GPT Image 2 <robot@example.com>"
                size="sm"
                aria-label="邮件发件人"
              />
              <Input
                value={draft.email.username ?? ""}
                onChange={(event) =>
                  patchEmail({ username: event.target.value || undefined })
                }
                placeholder="SMTP 用户名"
                size="sm"
                aria-label="SMTP username"
              />
            </div>
            <CredentialEditor
              credential={draft.email.password}
              onChange={(password) => patchEmail({ password })}
              placeholder="SMTP 密码"
              ariaLabel="SMTP 密码"
            />
            <Textarea
              value={recipientText}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                patchEmail({ to: parseRecipients(event.target.value) })
              }
              placeholder={"owner@example.com\nops@example.com"}
              minHeight={62}
              aria-label="邮件收件人"
            />
          </div>
        }
      />
      )}
      {capabilities?.server.webhook && (
      <Row
        title="Webhook"
        description="转发到你自己的服务地址，可加请求头鉴权。"
        control={
          <div className="w-full space-y-3 sm:w-[600px]">
            {draft.webhooks.length === 0 && (
              <div className="rounded-md border border-dashed border-border px-3 py-3 text-[12px] text-muted">
                暂无 webhook。
              </div>
            )}
            {draft.webhooks.map((webhook, index) => (
              <div
                key={webhook.id}
                className="space-y-2 rounded-lg border border-border bg-[color:var(--w-03)] p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-2 text-[12px] text-muted">
                    <Webhook size={13} />
                    {webhook.name || `Webhook ${index + 1}`}
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    <Toggle
                      checked={webhook.enabled}
                      onChange={(enabled) => patchWebhook(index, { enabled })}
                    />
                    <Button
                      variant="ghost"
                      size="iconSm"
                      icon="trash"
                      onClick={() => removeWebhook(index)}
                      aria-label="删除 webhook"
                    />
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-[120px_minmax(0,1fr)]">
                  <Input
                    value={webhook.name}
                    onChange={(event) =>
                      patchWebhook(index, { name: event.target.value })
                    }
                    placeholder="名称"
                    size="sm"
                    aria-label="Webhook 名称"
                  />
                  <Input
                    value={webhook.url}
                    onChange={(event) =>
                      patchWebhook(index, { url: event.target.value })
                    }
                    placeholder="https://example.com/hook"
                    size="sm"
                    aria-label="Webhook URL"
                  />
                </div>
                <div className="grid gap-2 sm:grid-cols-[120px_110px]">
                  <GlassSelect
                    value={webhook.method || "POST"}
                    onValueChange={(method) => patchWebhook(index, { method })}
                    options={METHOD_OPTIONS}
                    size="sm"
                    ariaLabel="Webhook method"
                  />
                  <Input
                    value={String(webhook.timeout_seconds || 10)}
                    onChange={(event) =>
                      patchWebhook(index, {
                        timeout_seconds: Number(event.target.value) || 10,
                      })
                    }
                    inputMode="numeric"
                    size="sm"
                    aria-label="Webhook timeout"
                  />
                </div>
                <div className="space-y-2">
                  {webhookHeaderEntries(webhook).map(([header, credential]) => (
                    <div
                      key={`${webhook.id}:${header}`}
                      className="grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)_32px]"
                    >
                      <Input
                        value={header}
                        onChange={(event) =>
                          renameHeader(index, header, event.target.value)
                        }
                        placeholder="Authorization"
                        size="sm"
                        monospace
                        aria-label="Webhook header"
                      />
                      <CredentialEditor
                        credential={credential}
                        onChange={(nextCredential) =>
                          updateHeaderCredential(index, header, nextCredential)
                        }
                        placeholder="Bearer ..."
                        ariaLabel={`${header} 值`}
                      />
                      <Button
                        variant="ghost"
                        size="iconSm"
                        icon="x"
                        onClick={() =>
                          updateHeaderCredential(index, header, null)
                        }
                        aria-label="删除 header"
                      />
                    </div>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="plus"
                    onClick={() => addHeader(index)}
                  >
                    添加 Header
                  </Button>
                </div>
              </div>
            ))}
            <Button
              variant="secondary"
              size="sm"
              icon="plus"
              onClick={addWebhook}
            >
              添加 Webhook
            </Button>
          </div>
        }
      />
      )}
      <Row
        title="保存与试发"
        description="试发一条假数据，使用已保存的配置。"
        control={
          <div className="flex w-full flex-wrap justify-end gap-2 sm:w-[600px]">
            <Button
              variant="secondary"
              size="sm"
              disabled={testNotifications.isPending}
              onClick={() => void test("completed")}
            >
              试发完成
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={testNotifications.isPending}
              onClick={() => void test("failed")}
            >
              试发失败
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={testNotifications.isPending}
              onClick={() => void test("cancelled")}
            >
              试发取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={updateNotifications.isPending}
              onClick={() => void save()}
            >
              保存
            </Button>
          </div>
        }
      />
    </Section>
  );
}
