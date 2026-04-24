import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { SourceChip } from "@/components/ui/source-chip";
import { Icon } from "@/components/icon";
import { api } from "@/lib/api";
import { providerKindLabel } from "@/lib/format";
import { copyText } from "@/lib/user-actions";
import type { ProviderConfig } from "@/lib/types";

type TestStatus = "idle" | "running" | "ok" | "err";

function editRegionModeLabel(prov: ProviderConfig) {
  const mode =
    prov.edit_region_mode ??
    (prov.type === "openai" ? "native-mask" : "reference-hint");
  if (mode === "native-mask") return "精确遮罩";
  if (mode === "reference-hint") return "软选区参考";
  return "不支持局部编辑";
}

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
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [revealing, setRevealing] = useState<Record<string, boolean>>({});
  const [copying, setCopying] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setRevealed({});
    setRevealing({});
    setCopying({});
  }, [name]);

  if (!name || !prov) {
    return (
      <Empty
        icon="cpu"
        title="选择一个凭证"
        subtitle="左侧列出所有已配置的凭证，点击查看详情或测试连接。"
      />
    );
  }

  const fetchSecret = async (key: string) => {
    if (revealed[key]) return revealed[key];
    const result = await api.revealProviderCredential(name, key);
    return result.value;
  };

  const toggleSecret = async (key: string) => {
    if (revealed[key]) {
      setRevealed((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      return;
    }

    setRevealing((current) => ({ ...current, [key]: true }));
    try {
      const value = await fetchSecret(key);
      setRevealed((current) => ({ ...current, [key]: value }));
    } catch (error) {
      toast.error("查看失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setRevealing((current) => ({ ...current, [key]: false }));
    }
  };

  const copySecret = async (key: string) => {
    setCopying((current) => ({ ...current, [key]: true }));
    try {
      const value = await fetchSecret(key);
      await copyText(value, key);
    } catch (error) {
      toast.error("复制失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setCopying((current) => ({ ...current, [key]: false }));
    }
  };

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
            {isDefault && (
              <Badge tone="accent" icon="check">
                默认
              </Badge>
            )}
            {prov.builtin && <Badge tone="neutral">内置</Badge>}
            {prov.disabled && <Badge tone="neutral">不可用</Badge>}
          </div>
          <div className="flex items-center gap-1.5 mt-1 text-[12px] text-muted">
            <span>{providerKindLabel(prov.type)}</span>
            <span>·</span>
            <span className="t-mono">{prov.model ?? "—"}</span>
          </div>
        </div>
        <Button
          variant="secondary"
          icon="play"
          onClick={onTest}
          disabled={testStatus === "running" || prov.disabled}
        >
          测试连接
        </Button>
        {!isDefault && onSetDefault && !prov.disabled && (
          <Button variant="secondary" icon="check" onClick={onSetDefault}>
            设为默认
          </Button>
        )}
      </div>

      {prov.disabled && (
        <div className="mb-4 rounded-md border border-border bg-sunken px-3 py-2.5 text-[12px] leading-relaxed text-muted">
          {prov.disabled_reason ?? "这个凭证在当前运行环境不可用。"}
        </div>
      )}

      {testStatus && testStatus !== "idle" && (
        <div
          className={[
            "px-3 py-2.5 mb-4 rounded-md flex items-center gap-2.5 text-[12px] animate-fade-in",
            testStatus === "ok"
              ? "bg-status-ok-bg text-status-ok"
              : testStatus === "err"
                ? "bg-status-err-bg text-status-err"
                : "bg-status-running-bg text-status-running",
          ].join(" ")}
        >
          {testStatus === "running" && (
            <Spinner size={12} color="currentColor" />
          )}
          {testStatus === "ok" && <Icon name="check" size={14} />}
          {testStatus === "err" && <Icon name="warn" size={14} />}
          <span className="font-semibold">{testMessage}</span>
        </div>
      )}

      <Card style={{ marginBottom: 14 }} padding={0}>
        <div className="px-4 py-3 border-b border-border-faint">
          <div className="t-caps">接入设置</div>
        </div>
        <div className="p-4">
          <div
            className="grid gap-y-2.5 gap-x-4 text-[12.5px]"
            style={{ gridTemplateColumns: "140px 1fr" }}
          >
            <span className="t-tiny pt-0.5">类型</span>
            <span>{providerKindLabel(prov.type)}</span>
            <span className="t-tiny pt-0.5">服务地址</span>
            <span className="t-mono">
              {prov.api_base ?? <span className="text-faint">— 使用内置</span>}
            </span>
            <span className="t-tiny pt-0.5">模型</span>
            <span className="t-mono">{prov.model ?? "—"}</span>
            <span className="t-tiny pt-0.5">多张生成</span>
            <span>
              {prov.supports_n
                ? "接口支持一次返回多张"
                : "App 会自动并行生成多张"}
            </span>
            <span className="t-tiny pt-0.5">局部编辑</span>
            <span>{editRegionModeLabel(prov)}</span>
          </div>
        </div>
      </Card>

      <Card padding={0}>
        <div className="px-4 py-3 border-b border-border-faint flex items-center gap-2">
          <div className="t-caps">凭据</div>
        </div>
        {Object.entries(prov.credentials).length === 0 ? (
          <div className="p-4 text-faint text-[12px]">
            这个凭证使用本机已登录的账号信息。
          </div>
        ) : (
          Object.entries(prov.credentials).map(([k, c], i) => (
            <div
              key={k}
              className={[
                "grid items-center gap-3 px-4 py-3",
                i > 0 && "border-t border-border-faint",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ gridTemplateColumns: "140px minmax(0,1fr) auto" }}
            >
              <span className="text-[12.5px] font-semibold">{k}</span>
              <div className="flex items-center gap-1.5 px-2.5 h-[30px] bg-sunken border border-border rounded-[5px] font-mono text-[11.5px] text-muted min-w-0 overflow-hidden">
                <span className="flex-1 truncate">
                  {revealed[k]
                    ? revealed[k]
                    : c.source === "file"
                      ? c.present
                        ? "••••••••••••••••"
                        : "未设置"
                      : c.source === "env"
                        ? `$${c.env}`
                        : `${c.service} / ${c.account}`}
                </span>
                {c.present && (
                  <>
                    <button
                      type="button"
                      onClick={() => toggleSecret(k)}
                      disabled={revealing[k] || copying[k]}
                      className="bg-transparent border-none cursor-pointer p-0.5 text-faint disabled:cursor-not-allowed disabled:opacity-50"
                      title={revealed[k] ? "隐藏密钥" : "查看密钥"}
                      aria-label={revealed[k] ? "隐藏密钥" : "查看密钥"}
                    >
                      {revealing[k] ? (
                        <Spinner size={12} color="currentColor" />
                      ) : (
                        <Icon name={revealed[k] ? "eyeoff" : "eye"} size={12} />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => copySecret(k)}
                      disabled={revealing[k] || copying[k]}
                      className="bg-transparent border-none cursor-pointer p-0.5 text-faint disabled:cursor-not-allowed disabled:opacity-50"
                      title="复制密钥"
                      aria-label="复制密钥"
                    >
                      {copying[k] ? (
                        <Spinner size={12} color="currentColor" />
                      ) : (
                        <Icon name="copy" size={12} />
                      )}
                    </button>
                  </>
                )}
              </div>
              <SourceChip source={c.source} />
            </div>
          ))
        )}
      </Card>

      <div className="mt-5 pt-4 border-t border-border-faint flex justify-end">
        {!prov.builtin && !prov.disabled && (
          <Button variant="danger" icon="trash" onClick={onDelete}>
            删除凭证
          </Button>
        )}
      </div>
    </div>
  );
}
