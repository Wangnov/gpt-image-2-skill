import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { useUpsertProvider } from "@/hooks/use-config";
import type {
  CredentialSource,
  ProviderConfig,
  ProviderKind,
} from "@/lib/types";

type EditRegionMode = NonNullable<ProviderConfig["edit_region_mode"]>;

function defaultEditRegionMode(kind: ProviderKind): EditRegionMode {
  if (kind === "openai") return "native-mask";
  if (kind === "codex") return "reference-hint";
  return "reference-hint";
}

export function AddProviderDialog({
  open,
  onOpenChange,
  existingNames,
  mode = "add",
  providerName,
  provider,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  existingNames: string[];
  mode?: "add" | "edit";
  providerName?: string;
  provider?: ProviderConfig;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ProviderKind>("openai-compatible");
  const [apiBase, setApiBase] = useState("https://example.com/v1");
  const [model, setModel] = useState("gpt-image-2");
  const [supportsN, setSupportsN] = useState(false);
  const [editRegionMode, setEditRegionMode] =
    useState<EditRegionMode>("reference-hint");
  const [keySource, setKeySource] = useState<CredentialSource>("file");
  const [apiKey, setApiKey] = useState("");
  const [envName, setEnvName] = useState("OPENAI_API_KEY");
  const [keychainAccount, setKeychainAccount] = useState("");
  const [codexAccountId, setCodexAccountId] = useState("");
  const [codexAccessToken, setCodexAccessToken] = useState("");
  const [codexRefreshToken, setCodexRefreshToken] = useState("");

  const upsert = useUpsertProvider();
  const editing = mode === "edit" && Boolean(providerName && provider);
  const trimmedName = name.trim();
  const existingNamesForCheck = useMemo(
    () =>
      editing
        ? existingNames.filter(
            (existing) =>
              existing.toLowerCase() !== providerName?.toLowerCase(),
          )
        : existingNames,
    [editing, existingNames, providerName],
  );
  const nameTaken =
    !editing &&
    (["auto", "openai", "codex"].includes(trimmedName.toLowerCase()) ||
      existingNamesForCheck.some(
        (existing) => existing.toLowerCase() === trimmedName.toLowerCase(),
      ));

  const reset = () => {
    setName("");
    setKind("openai-compatible");
    setApiBase("https://example.com/v1");
    setModel("gpt-image-2");
    setSupportsN(false);
    setEditRegionMode("reference-hint");
    setKeySource("file");
    setApiKey("");
    setEnvName("OPENAI_API_KEY");
    setKeychainAccount("");
    setCodexAccountId("");
    setCodexAccessToken("");
    setCodexRefreshToken("");
  };

  useEffect(() => {
    if (!open) return;
    if (!editing || !providerName || !provider) {
      reset();
      return;
    }

    setName(providerName);
    setKind(provider.type);
    setApiBase(provider.api_base ?? "https://example.com/v1");
    setModel(provider.model ?? "gpt-image-2");
    setSupportsN(Boolean(provider.supports_n));
    setEditRegionMode(
      provider.edit_region_mode ?? defaultEditRegionMode(provider.type),
    );

    const apiKeyCredential = provider.credentials.api_key;
    setKeySource(apiKeyCredential?.source ?? "file");
    setApiKey("");
    setEnvName(apiKeyCredential?.env ?? "OPENAI_API_KEY");
    setKeychainAccount(apiKeyCredential?.account ?? "");

    setCodexAccountId("");
    setCodexAccessToken("");
    setCodexRefreshToken("");
  }, [editing, open, provider, providerName]);

  const fileCredential = (value: string) =>
    value ? { source: "file" as const, value } : { source: "file" as const };

  const keychainCredential = (value: string) =>
    value
      ? {
          source: "keychain" as const,
          value,
          account: keychainAccount || undefined,
        }
      : { source: "keychain" as const, account: keychainAccount || undefined };

  const submit = async () => {
    if (!trimmedName) return;
    if (nameTaken) {
      toast.error("凭证已存在", {
        description: "已配置的凭证不能被覆盖，请换一个名称。",
      });
      return;
    }
    try {
      await upsert.mutateAsync({
        name: trimmedName,
        cfg: {
          type: kind,
          api_base: kind === "codex" ? undefined : apiBase || undefined,
          model: model || undefined,
          supports_n: kind === "codex" ? false : supportsN,
          edit_region_mode: editRegionMode,
          credentials:
            kind === "codex"
              ? {
                  ...(codexAccountId
                    ? {
                        account_id: {
                          source: "file" as const,
                          value: codexAccountId,
                        },
                      }
                    : editing && provider?.credentials.account_id
                      ? { account_id: fileCredential("") }
                      : {}),
                  ...(codexAccessToken
                    ? {
                        access_token: {
                          source: "file" as const,
                          value: codexAccessToken,
                        },
                      }
                    : editing && provider?.credentials.access_token
                      ? { access_token: fileCredential("") }
                      : {}),
                  ...(codexRefreshToken
                    ? {
                        refresh_token: {
                          source: "file" as const,
                          value: codexRefreshToken,
                        },
                      }
                    : editing && provider?.credentials.refresh_token
                      ? { refresh_token: fileCredential("") }
                      : {}),
                }
              : {
                  api_key:
                    keySource === "file"
                      ? fileCredential(apiKey)
                      : keySource === "env"
                        ? { source: "env", env: envName }
                        : keychainCredential(apiKey),
                },
          set_default: !editing,
          allow_overwrite: editing,
        },
      });
      toast.success(editing ? "凭证已更新" : "凭证已添加", {
        description: editing
          ? `${trimmedName} 的配置已保存。`
          : `${trimmedName} 已设为默认凭证。`,
      });
      reset();
      onOpenChange(false);
    } catch (error) {
      toast.error(editing ? "保存失败" : "添加失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "编辑凭证" : "添加凭证"}
      width={560}
      maxHeight={640}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            variant="primary"
            icon="plus"
            onClick={submit}
            disabled={upsert.isPending || !trimmedName || nameTaken}
          >
            {upsert.isPending
              ? "保存中…"
              : editing
                ? "保存修改"
                : "添加并设为默认"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3.5">
        <Field
          label="名称"
          hint={
            nameTaken
              ? "这个名称已存在，已配置的凭证不能覆盖。"
              : "会显示在凭证列表里"
          }
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如 my-image-api"
            autoFocus
            disabled={editing}
          />
        </Field>
        <Field label="类型">
          <Segmented
            value={kind}
            onChange={(next) => {
              setKind(next);
              setSupportsN(next === "openai");
              setEditRegionMode(defaultEditRegionMode(next));
            }}
            ariaLabel="凭证类型"
            className="w-full overflow-x-auto scrollbar-none"
            options={[
              { value: "openai-compatible", label: "OpenAI 兼容" },
              { value: "openai", label: "OpenAI 官方" },
              { value: "codex", label: "Codex" },
            ]}
          />
        </Field>
        {kind !== "codex" && (
          <Field label="服务地址">
            <Input
              value={apiBase}
              onChange={(e) => setApiBase(e.target.value)}
              placeholder="https://example.com/v1"
              monospace
            />
          </Field>
        )}
        <Field label="模型">
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="gpt-image-2"
            monospace
          />
        </Field>
        <Field
          label="批量策略"
          hint={
            kind === "codex"
              ? "Codex 会由 App 自动并行生成多张"
              : "不确定时选「App 自动并行」最稳"
          }
        >
          {kind === "codex" ? (
            <div className="flex h-8 items-center justify-between rounded-md border border-border bg-sunken px-2.5 text-[12px]">
              <span className="font-semibold">App 自动并行</span>
              <span className="text-faint">适合批量生成</span>
            </div>
          ) : (
            <Segmented
              value={supportsN ? "yes" : "no"}
              onChange={(value) => setSupportsN(value === "yes")}
              ariaLabel="批量策略"
              options={[
                { value: "no", label: "App 自动并行" },
                { value: "yes", label: "接口一次返回多张" },
              ]}
            />
          )}
        </Field>
        <Field
          label="局部编辑"
          hint={
            kind === "openai"
              ? "OpenAI 官方可使用精确遮罩"
              : "不确定时选「软选区参考」最稳"
          }
        >
          {kind === "codex" ? (
            <div className="flex h-8 items-center justify-between rounded-md border border-border bg-sunken px-2.5 text-[12px]">
              <span className="font-semibold">软选区参考</span>
              <span className="text-faint">适合当前 Codex 通道</span>
            </div>
          ) : (
            <Segmented
              value={editRegionMode}
              onChange={setEditRegionMode}
              ariaLabel="局部编辑模式"
              className="w-full overflow-x-auto scrollbar-none"
              options={[
                { value: "reference-hint", label: "软选区参考" },
                { value: "native-mask", label: "精确遮罩" },
                { value: "none", label: "不支持" },
              ]}
            />
          )}
        </Field>
      </div>
      {kind === "codex" && (
        <div className="mt-1 grid gap-3.5">
          <Field
            label="账号 ID"
            hint={editing ? "留空会保留原值。" : undefined}
          >
            <Input
              value={codexAccountId}
              onChange={(e) => setCodexAccountId(e.target.value)}
              placeholder="可留空，使用本机已登录账号"
              monospace
            />
          </Field>
          <Field
            label="Access Token"
            hint={editing ? "留空会保留原值。" : undefined}
          >
            <Input
              value={codexAccessToken}
              onChange={(e) => setCodexAccessToken(e.target.value)}
              placeholder="eyJ…"
              type="password"
              monospace
            />
          </Field>
          <Field
            label="Refresh Token"
            hint={editing ? "留空会保留原值。" : undefined}
          >
            <Input
              value={codexRefreshToken}
              onChange={(e) => setCodexRefreshToken(e.target.value)}
              placeholder="可选"
              type="password"
              monospace
            />
          </Field>
        </div>
      )}
      {kind !== "codex" && (
        <div className="mt-1 grid gap-3.5">
          <Field label="密钥保存方式">
            <Segmented
              value={keySource}
              onChange={(v) => setKeySource(v as CredentialSource)}
              ariaLabel="密钥保存方式"
              className="w-full overflow-x-auto scrollbar-none"
              options={[
                { value: "file", label: "配置文件", icon: "filedot" },
                { value: "env", label: "环境变量", icon: "envkey" },
                { value: "keychain", label: "钥匙串", icon: "keychain" },
              ]}
            />
          </Field>
          {keySource === "file" && (
            <Field
              label="API Key"
              hint={editing ? "留空会保留原密钥。" : undefined}
            >
              <Input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-…"
                type="password"
                monospace
              />
            </Field>
          )}
          {keySource === "env" && (
            <Field label="环境变量名">
              <Input
                value={envName}
                onChange={(e) => setEnvName(e.target.value)}
                placeholder="OPENAI_API_KEY"
                monospace
              />
            </Field>
          )}
          {keySource === "keychain" && (
            <>
              <Field label="钥匙串条目">
                <Input
                  value={keychainAccount}
                  onChange={(e) => setKeychainAccount(e.target.value)}
                  placeholder={`providers/${name || "my-provider"}/api_key`}
                  monospace
                />
              </Field>
              <Field
                label="API Key"
                hint={editing ? "留空会保留钥匙串里的原密钥。" : undefined}
              >
                <Input
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-…"
                  type="password"
                  monospace
                />
              </Field>
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}
