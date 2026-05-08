import { type ChangeEvent } from "react";
import { Mail } from "lucide-react";
import { Input } from "@/components/ui/input";
import { GlassSelect } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import type { EmailTlsMode, NotificationConfig } from "@/lib/types";
import { TLS_OPTIONS } from "./constants";
import { CredentialEditor } from "./credential-editor";
import { Row } from "./layout";
import { parseRecipients } from "./settings-utils";

export function NotificationEmailRow({
  email,
  recipientText,
  patchEmail,
}: {
  email: NotificationConfig["email"];
  recipientText: string;
  patchEmail: (next: Partial<NotificationConfig["email"]>) => void;
}) {
  return (
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
              checked={email.enabled}
              onChange={(enabled) => patchEmail({ enabled })}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_90px_120px]">
            <Input
              value={email.smtp_host}
              onChange={(event) =>
                patchEmail({ smtp_host: event.target.value })
              }
              placeholder="smtp.example.com"
              size="sm"
              aria-label="SMTP host"
            />
            <Input
              value={String(email.smtp_port || "")}
              onChange={(event) =>
                patchEmail({ smtp_port: Number(event.target.value) || 587 })
              }
              inputMode="numeric"
              size="sm"
              aria-label="SMTP port"
            />
            <GlassSelect
              value={email.tls}
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
              value={email.from}
              onChange={(event) => patchEmail({ from: event.target.value })}
              placeholder="GPT Image 2 <robot@example.com>"
              size="sm"
              aria-label="邮件发件人"
            />
            <Input
              value={email.username ?? ""}
              onChange={(event) =>
                patchEmail({ username: event.target.value || undefined })
              }
              placeholder="SMTP 用户名"
              size="sm"
              aria-label="SMTP username"
            />
          </div>
          <CredentialEditor
            credential={email.password}
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
  );
}
