import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/icon";
import { AddProviderDialog } from "./add-provider-dialog";
import { ProviderDetail } from "./provider-detail";
import { ProviderRow } from "./provider-row";
import { api } from "@/lib/api";
import {
  useDeleteProvider,
  useSetDefaultProvider,
  useTestProvider,
} from "@/hooks/use-config";
import type { ServerConfig } from "@/lib/types";
import { effectiveDefaultProvider, providerNames } from "@/lib/providers";

type TestStatus = "idle" | "running" | "ok" | "err";

export function ProvidersScreen({ config }: { config?: ServerConfig }) {
  const providers = config?.providers ?? {};
  const names = providerNames(config, { includeDisabled: true });
  const effectiveDefault = effectiveDefaultProvider(config);
  const [selected, setSelected] = useState<string | undefined>(
    effectiveDefault || names[0],
  );
  const [testMap, setTestMap] = useState<
    Record<string, { status: TestStatus; message?: string }>
  >({});
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editingName, setEditingName] = useState<string | undefined>();
  const setDefault = useSetDefaultProvider();
  const deleteProv = useDeleteProvider();
  const test = useTestProvider();

  useEffect(() => {
    // Switch selection when config changes.
    if (!selected && names.length > 0)
      setSelected(effectiveDefault || names[0]);
  }, [effectiveDefault, names, selected]);

  const filteredNames = names.filter(
    (n) => !query || n.toLowerCase().includes(query.toLowerCase()),
  );

  const runTest = async (name: string) => {
    setTestMap((m) => ({ ...m, [name]: { status: "running" } }));
    try {
      const r = await test.mutateAsync(name);
      setTestMap((m) => ({
        ...m,
        [name]: { status: r.ok ? "ok" : "err", message: r.message },
      }));
      if (r.ok)
        toast.success("连接正常", { description: `${name} 可以使用。` });
      if (!r.ok) toast.error("连接失败", { description: r.message });
    } catch (e) {
      setTestMap((m) => ({
        ...m,
        [name]: { status: "err", message: (e as Error).message },
      }));
      toast.error("连接失败", { description: (e as Error).message });
    }
  };

  const makeDefault = async (name: string) => {
    try {
      await setDefault.mutateAsync(name);
      toast.success("默认凭证已更新", {
        description: `之后会优先使用 ${name}。`,
      });
    } catch (error) {
      toast.error("设置失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const removeProvider = async (name: string) => {
    try {
      await deleteProv.mutateAsync(name);
      toast.success("凭证已删除", { description: name });
      setSelected(undefined);
    } catch (error) {
      toast.error("删除失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const currentTest = selected ? testMap[selected] : undefined;

  return (
    <div className="grid h-full grid-cols-[minmax(300px,340px)_minmax(0,1fr)] overflow-hidden xl:grid-cols-[minmax(340px,380px)_minmax(0,1fr)]">
      <div className="border-r border-border bg-raised flex flex-col overflow-hidden">
        <div className="px-3.5 py-3 border-b border-border-faint flex items-center gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索凭证…"
            icon="search"
            size="sm"
            wrapperClassName="flex-1"
          />
          <Button
            variant="solidDark"
            size="sm"
            icon="plus"
            onClick={() => setShowAdd(true)}
          >
            添加
          </Button>
        </div>
        <div className="flex-1 overflow-auto">
          {filteredNames.length === 0 ? (
            <div className="p-6 text-center text-faint text-[12px]">
              尚未添加任何凭证。点击「添加」开始。
            </div>
          ) : (
            filteredNames.map((name) => (
              <ProviderRow
                key={name}
                name={name}
                prov={providers[name]}
                isDefault={name === effectiveDefault}
                selected={name === selected}
                onSelect={() => setSelected(name)}
                onEdit={() => {
                  setSelected(name);
                  setEditingName(name);
                }}
                testStatus={testMap[name]?.status}
              />
            ))
          )}
        </div>
        <div className="px-3.5 py-2.5 border-t border-border-faint text-[11px] text-faint flex items-center gap-1.5">
          <Icon name="folder" size={11} />
          <span className="truncate">
            {api.canUseSystemCredentials
              ? "凭证配置会保存在本机，并和 CLI、Skill 共用。"
              : "API Key 只保存在这个浏览器的本地数据里。"}
          </span>
        </div>
      </div>

      <div className="overflow-hidden">
        <ProviderDetail
          name={selected}
          prov={selected ? providers[selected] : undefined}
          isDefault={selected === effectiveDefault}
          testStatus={currentTest?.status}
          testMessage={currentTest?.message}
          onSetDefault={() => selected && makeDefault(selected)}
          onTest={() => selected && runTest(selected)}
          onDelete={() => {
            if (!selected) return;
            removeProvider(selected);
          }}
        />
      </div>

      <AddProviderDialog
        open={showAdd}
        onOpenChange={setShowAdd}
        existingNames={names}
      />
      <AddProviderDialog
        open={Boolean(editingName)}
        onOpenChange={(open) => {
          if (!open) setEditingName(undefined);
        }}
        existingNames={names}
        mode="edit"
        providerName={editingName}
        provider={editingName ? providers[editingName] : undefined}
      />
    </div>
  );
}
