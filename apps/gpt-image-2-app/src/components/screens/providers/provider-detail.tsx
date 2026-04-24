import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { SourceChip } from "@/components/ui/source-chip";
import { Icon } from "@/components/icon";
import { providerKindLabel } from "@/lib/format";
import type { ProviderConfig } from "@/lib/types";

type TestStatus = "idle" | "running" | "ok" | "err";

export function ProviderDetail({
  name,
  prov,
  isDefault,
  testStatus,
  testMessage,
  onSetDefault,
  onTest,
  onDelete,
}: {
  name?: string;
  prov?: ProviderConfig;
  isDefault?: boolean;
  testStatus?: TestStatus;
  testMessage?: string;
  onSetDefault?: () => void;
  onTest?: () => void;
  onDelete?: () => void;
}) {
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({});

  if (!name || !prov) {
    return <Empty icon="cpu" title="选择一个服务商" subtitle="左侧列出所有已配置的服务商，点击查看详情或测试连接。" />;
  }

  return (
    <div className="p-5 h-full overflow-auto">
      <div className="flex items-start gap-3.5 mb-5">
        <div
          className="w-12 h-12 rounded-[10px] bg-sunken border border-border flex items-center justify-center"
          style={{ color: "var(--accent)" }}
        >
          <Icon name="cpu" size={22} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="t-title">{name}</div>
            {isDefault && <Badge tone="accent" icon="check">默认</Badge>}
            {prov.builtin && <Badge tone="neutral">内置</Badge>}
          </div>
          <div className="flex items-center gap-1.5 mt-1 text-[12px] text-muted">
            <span>{providerKindLabel(prov.type)}</span>
            <span>·</span>
            <span className="t-mono">{prov.model ?? "—"}</span>
          </div>
        </div>
        <Button variant="secondary" icon="play" onClick={onTest} disabled={testStatus === "running"}>测试连接</Button>
        {!isDefault && onSetDefault && (
          <Button variant="secondary" icon="check" onClick={onSetDefault}>设为默认</Button>
        )}
      </div>

      {testStatus && testStatus !== "idle" && (
        <div
          className={[
            "px-3 py-2.5 mb-4 rounded-md flex items-center gap-2.5 text-[12px] animate-fade-in",
            testStatus === "ok" ? "bg-status-ok-bg text-status-ok" : testStatus === "err" ? "bg-status-err-bg text-status-err" : "bg-status-running-bg text-status-running",
          ].join(" ")}
        >
          {testStatus === "running" && <Spinner size={12} color="currentColor" />}
          {testStatus === "ok" && <Icon name="check" size={14} />}
          {testStatus === "err" && <Icon name="warn" size={14} />}
          <span className="font-semibold">{testMessage}</span>
        </div>
      )}

      <Card style={{ marginBottom: 14 }} padding={0}>
        <div className="px-4 py-3 border-b border-border-faint">
          <div className="t-caps">端点</div>
        </div>
        <div className="p-4">
          <div className="grid gap-y-2.5 gap-x-4 text-[12.5px]" style={{ gridTemplateColumns: "140px 1fr" }}>
            <span className="t-tiny pt-0.5">类型</span>
            <span>{providerKindLabel(prov.type)}</span>
            <span className="t-tiny pt-0.5">Base URL</span>
            <span className="t-mono">{prov.api_base ?? <span className="text-faint">— 使用内置</span>}</span>
            <span className="t-tiny pt-0.5">模型</span>
            <span className="t-mono">{prov.model ?? "—"}</span>
          </div>
        </div>
      </Card>

      <Card padding={0}>
        <div className="px-4 py-3 border-b border-border-faint flex items-center gap-2">
          <div className="t-caps">凭据</div>
        </div>
        {Object.entries(prov.credentials).length === 0 ? (
          <div className="p-4 text-faint text-[12px]">此 provider 使用系统凭据 (如 ~/.codex/auth.json)。</div>
        ) : (
          Object.entries(prov.credentials).map(([k, c], i) => (
            <div
              key={k}
              className={["grid items-center gap-3 px-4 py-3", i > 0 && "border-t border-border-faint"].filter(Boolean).join(" ")}
              style={{ gridTemplateColumns: "140px 1fr auto auto" }}
            >
              <span className="text-[12.5px] font-semibold">{k}</span>
              <div
                className="flex items-center gap-1.5 px-2.5 h-[30px] bg-sunken border border-border rounded-[5px] font-mono text-[11.5px] text-muted min-w-0 overflow-hidden"
              >
                {c.source === "file" && (
                  <>
                    <span className="flex-1 truncate">
                      {showSecret[k] && typeof c.value === "string"
                        ? c.value
                        : "•".repeat(c.present ? 16 : 0)}
                    </span>
                    <button
                      onClick={() => setShowSecret((s) => ({ ...s, [k]: !s[k] }))}
                      className="bg-transparent border-none cursor-pointer p-0.5 text-faint"
                    >
                      <Icon name={showSecret[k] ? "eyeoff" : "eye"} size={12} />
                    </button>
                  </>
                )}
                {c.source === "env" && <span>${c.env}</span>}
                {c.source === "keychain" && <span>{c.service} / {c.account}</span>}
              </div>
              <SourceChip source={c.source} />
              <Button variant="ghost" size="iconSm" icon="gear" />
            </div>
          ))
        )}
      </Card>

      <div className="mt-5 pt-4 border-t border-border-faint flex justify-end">
        {!prov.builtin && <Button variant="danger" icon="trash" onClick={onDelete}>删除服务商</Button>}
      </div>
    </div>
  );
}
