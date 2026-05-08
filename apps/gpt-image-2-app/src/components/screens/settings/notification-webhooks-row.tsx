import { Webhook } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GlassSelect } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import type {
  CredentialRef,
  WebhookNotificationConfig,
} from "@/lib/types";
import { METHOD_OPTIONS } from "./constants";
import { CredentialEditor } from "./credential-editor";
import { Row } from "./layout";
import { webhookHeaderEntries } from "./settings-utils";

export function NotificationWebhooksRow({
  webhooks,
  patchWebhook,
  addWebhook,
  removeWebhook,
  addHeader,
  renameHeader,
  updateHeaderCredential,
}: {
  webhooks: WebhookNotificationConfig[];
  patchWebhook: (
    index: number,
    next: Partial<WebhookNotificationConfig>,
  ) => void;
  addWebhook: () => void;
  removeWebhook: (index: number) => void;
  addHeader: (index: number) => void;
  renameHeader: (index: number, oldName: string, nextName: string) => void;
  updateHeaderCredential: (
    index: number,
    header: string,
    credential: CredentialRef | null,
  ) => void;
}) {
  return (
    <Row
      title="Webhook"
      description="转发到你自己的服务地址，可加请求头鉴权。"
      control={
        <div className="w-full space-y-3 sm:w-[600px]">
          {webhooks.length === 0 && (
            <div className="rounded-md border border-dashed border-border px-3 py-3 text-[12px] text-muted">
              暂无 webhook。
            </div>
          )}
          {webhooks.map((webhook, index) => (
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
                      onClick={() => updateHeaderCredential(index, header, null)}
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
          <Button variant="secondary" size="sm" icon="plus" onClick={addWebhook}>
            添加 Webhook
          </Button>
        </div>
      }
    />
  );
}
