import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { useUpsertProvider } from "@/hooks/use-config";
import type { CredentialSource, ProviderKind } from "@/lib/types";

export function AddProviderDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ProviderKind>("openai-compatible");
  const [apiBase, setApiBase] = useState("https://example.com/v1");
  const [model, setModel] = useState("gpt-image-2");
  const [keySource, setKeySource] = useState<CredentialSource>("file");
  const [apiKey, setApiKey] = useState("");
  const [envName, setEnvName] = useState("OPENAI_API_KEY");
  const [keychainAccount, setKeychainAccount] = useState("");
  const [codexAccountId, setCodexAccountId] = useState("");
  const [codexAccessToken, setCodexAccessToken] = useState("");
  const [codexRefreshToken, setCodexRefreshToken] = useState("");

  const upsert = useUpsertProvider();

  const reset = () => {
    setName("");
    setKind("openai-compatible");
    setApiBase("https://example.com/v1");
    setModel("gpt-image-2");
    setKeySource("file");
    setApiKey("");
    setEnvName("OPENAI_API_KEY");
    setKeychainAccount("");
    setCodexAccountId("");
    setCodexAccessToken("");
    setCodexRefreshToken("");
  };

  const submit = async () => {
    if (!name) return;
    await upsert.mutateAsync({
      name,
      cfg: {
        type: kind,
        api_base: kind === "codex" ? undefined : apiBase || undefined,
        model: model || undefined,
        credentials:
          kind === "codex"
            ? {
                ...(codexAccountId ? { account_id: { source: "file" as const, value: codexAccountId } } : {}),
                ...(codexAccessToken ? { access_token: { source: "file" as const, value: codexAccessToken } } : {}),
                ...(codexRefreshToken ? { refresh_token: { source: "file" as const, value: codexRefreshToken } } : {}),
              }
            : {
                api_key:
                  keySource === "file"
                    ? { source: "file", value: apiKey }
                    : keySource === "env"
                      ? { source: "env", env: envName }
                      : { source: "keychain", value: apiKey, account: keychainAccount || undefined },
              },
        set_default: true,
      },
    });
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="添加服务商" width={520}>
      <Field label="名称" hint="config.json 里的键">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如 my-image-api" autoFocus />
      </Field>
      <Field label="类型">
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: "openai-compatible", label: "OpenAI 兼容" },
            { value: "openai", label: "OpenAI 官方" },
            { value: "codex", label: "Codex" },
          ]}
        />
      </Field>
      {kind !== "codex" && (
        <Field label="Base URL">
          <Input value={apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder="https://example.com/v1" monospace />
        </Field>
      )}
      <Field label="模型">
        <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-image-2" monospace />
      </Field>
      {kind === "codex" && (
        <>
          <Field label="ChatGPT Account ID">
            <Input value={codexAccountId} onChange={(e) => setCodexAccountId(e.target.value)} placeholder="account-id，可留空使用 auth.json" monospace />
          </Field>
          <Field label="Access Token">
            <Input value={codexAccessToken} onChange={(e) => setCodexAccessToken(e.target.value)} placeholder="eyJ…" type="password" monospace />
          </Field>
          <Field label="Refresh Token">
            <Input value={codexRefreshToken} onChange={(e) => setCodexRefreshToken(e.target.value)} placeholder="可选" type="password" monospace />
          </Field>
        </>
      )}
      {kind !== "codex" && (
        <>
          <Field label="API Key 来源">
            <Segmented
              value={keySource}
              onChange={(v) => setKeySource(v as CredentialSource)}
              options={[
                { value: "file", label: "file", icon: "filedot" },
                { value: "env", label: "env", icon: "envkey" },
                { value: "keychain", label: "keychain", icon: "keychain" },
              ]}
            />
          </Field>
          {keySource === "file" && (
            <Field label="API Key">
              <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…" type="password" monospace />
            </Field>
          )}
          {keySource === "env" && (
            <Field label="环境变量名">
              <Input value={envName} onChange={(e) => setEnvName(e.target.value)} placeholder="OPENAI_API_KEY" monospace />
            </Field>
          )}
          {keySource === "keychain" && (
            <>
              <Field label="Keychain Account">
                <Input value={keychainAccount} onChange={(e) => setKeychainAccount(e.target.value)} placeholder={`providers/${name || "my-provider"}/api_key`} monospace />
              </Field>
              <Field label="API Key">
                <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…" type="password" monospace />
              </Field>
            </>
          )}
        </>
      )}
      <div className="flex justify-end gap-2 mt-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
        <Button variant="primary" icon="plus" onClick={submit} disabled={upsert.isPending || !name}>
          {upsert.isPending ? "保存中…" : "添加并设为默认"}
        </Button>
      </div>
    </Dialog>
  );
}
