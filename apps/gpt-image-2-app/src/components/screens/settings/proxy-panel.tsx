import { useEffect, useMemo, useState } from "react";
import { Info } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { useUpdateProxy } from "@/hooks/use-config";
import type { ProxyConfig, ProxyMode } from "@/lib/types";
import { PROXY_MODE_OPTIONS } from "./constants";
import { Row, Section } from "./layout";
import {
  cloneProxyConfig,
  parseRecipients,
  prepareProxyConfigForSave,
} from "./settings-utils";

const PROXY_URL_PLACEHOLDER = "socks5h://127.0.0.1:1080";

export function ProxyPanel({ proxy }: { proxy?: ProxyConfig }) {
  const [draft, setDraft] = useState(() => cloneProxyConfig(proxy));
  // The bypass list is edited as free text (one host per line or comma-
  // separated) so typing a separator doesn't get re-flowed mid-edit; it is
  // parsed back into draft.no_proxy on change and again at save time.
  const [noProxyText, setNoProxyText] = useState(() =>
    (proxy?.no_proxy ?? []).join("\n"),
  );
  const updateProxy = useUpdateProxy();

  useEffect(() => {
    setDraft(cloneProxyConfig(proxy));
    setNoProxyText((proxy?.no_proxy ?? []).join("\n"));
  }, [proxy]);

  const isDirty = useMemo(
    () =>
      JSON.stringify(prepareProxyConfigForSave(draft)) !==
      JSON.stringify(cloneProxyConfig(proxy)),
    [draft, proxy],
  );

  const setMode = (mode: ProxyMode) => {
    setDraft((current) => ({ ...current, mode }));
  };

  const setUrl = (url: string) => {
    setDraft((current) => ({ ...current, url }));
  };

  const setNoProxy = (value: string) => {
    setNoProxyText(value);
    setDraft((current) => ({ ...current, no_proxy: parseRecipients(value) }));
  };

  const save = async () => {
    try {
      const saved = await updateProxy.mutateAsync(
        prepareProxyConfigForSave(draft),
      );
      setDraft(cloneProxyConfig(saved.proxy));
      setNoProxyText((saved.proxy?.no_proxy ?? []).join("\n"));
      toast.success("代理设置已保存");
    } catch (error) {
      toast.error("保存代理设置失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-auto p-4 sm:p-5 space-y-4">
      <Section
        title="网络代理"
        description="供应商和 API 请求的全局出站代理；单个凭证可在编辑里另行覆盖。"
      >
        <Row
          title="代理模式"
          description="跟随系统读取环境变量，直连忽略所有代理，自定义则使用下面的地址。"
          control={
            <Segmented<ProxyMode>
              value={draft.mode}
              onChange={setMode}
              ariaLabel="代理模式"
              options={PROXY_MODE_OPTIONS}
            />
          }
        />

        {draft.mode === "custom" && (
          <>
            <Row
              title="代理地址"
              description="scheme://[user:pass@]host:port"
              control={
                <div className="w-full sm:w-[320px]">
                  <Input
                    value={draft.url ?? ""}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder={PROXY_URL_PLACEHOLDER}
                    monospace
                    aria-label="代理地址"
                  />
                </div>
              }
            />
            <Row
              title="绕过代理的主机"
              description="可选。每行一个，或用逗号分隔；命中的主机会直连。"
              control={
                <div className="w-full sm:w-[320px]">
                  <Textarea
                    value={noProxyText}
                    onChange={(event) => setNoProxy(event.target.value)}
                    placeholder={"localhost\n127.0.0.1\n*.example.com"}
                    monospace
                    minHeight={72}
                    aria-label="绕过代理的主机"
                  />
                </div>
              }
            />
            <div className="flex items-start gap-2 px-4 py-3 text-[12px] text-muted sm:px-5">
              <Info size={14} className="mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p>
                  支持 http / https / socks5 / socks5h。推荐
                  <span className="font-mono"> socks5h:// </span>
                  —— 由代理端做 DNS 解析，可避免本机 DNS 污染（国内场景常用）。
                </p>
                <p>
                  含账号密码时填完整
                  <span className="font-mono">
                    {" "}
                    scheme://user:pass@host:port
                  </span>
                  ；出于安全，保存后只回显
                  <span className="font-mono"> scheme://host:port</span>
                  ，重新填写完整地址才会更新密码。
                </p>
              </div>
            </div>
          </>
        )}

        <div className="flex items-center justify-end gap-3 px-4 py-3.5 sm:px-5">
          {isDirty && (
            <span className="text-[12px] text-[color:var(--accent-70)]">
              有未保存的改动
            </span>
          )}
          <Button
            variant="primary"
            onClick={() => void save()}
            disabled={!isDirty || updateProxy.isPending}
          >
            {updateProxy.isPending ? "保存中…" : "保存"}
          </Button>
        </div>
      </Section>
    </div>
  );
}
