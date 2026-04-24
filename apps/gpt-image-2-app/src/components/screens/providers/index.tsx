import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/icon";
import { AddProviderDialog } from "./add-provider-dialog";
import { ProviderDetail } from "./provider-detail";
import { ProviderRow } from "./provider-row";
import { useDeleteProvider, useSetDefaultProvider, useTestProvider } from "@/hooks/use-config";
import type { ServerConfig } from "@/lib/types";
import { effectiveDefaultProvider } from "@/lib/providers";

type TestStatus = "idle" | "running" | "ok" | "err";

export function ProvidersScreen({ config }: { config?: ServerConfig }) {
  const providers = config?.providers ?? {};
  const names = Object.keys(providers);
  const effectiveDefault = effectiveDefaultProvider(config);
  const [selected, setSelected] = useState<string | undefined>(effectiveDefault || names[0]);
  const [testMap, setTestMap] = useState<Record<string, { status: TestStatus; message?: string }>>({});
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const setDefault = useSetDefaultProvider();
  const deleteProv = useDeleteProvider();
  const test = useTestProvider();

  useEffect(() => {
    // Switch selection when config changes.
    if (!selected && names.length > 0) setSelected(effectiveDefault || names[0]);
  }, [effectiveDefault, names, selected]);

  const filteredNames = names.filter((n) => !query || n.toLowerCase().includes(query.toLowerCase()));

  const runTest = async (name: string) => {
    setTestMap((m) => ({ ...m, [name]: { status: "running" } }));
    try {
      const r = await test.mutateAsync(name);
      setTestMap((m) => ({ ...m, [name]: { status: r.ok ? "ok" : "err", message: r.message } }));
    } catch (e) {
      setTestMap((m) => ({ ...m, [name]: { status: "err", message: (e as Error).message } }));
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
            placeholder="搜索服务商…"
            icon="search"
            size="sm"
            wrapperClassName="flex-1"
          />
          <Button variant="solidDark" size="sm" icon="plus" onClick={() => setShowAdd(true)}>添加</Button>
        </div>
        <div className="flex-1 overflow-auto">
          {filteredNames.length === 0 ? (
            <div className="p-6 text-center text-faint text-[12px]">
              尚未配置任何服务商。点击「添加」开始。
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
                testStatus={testMap[name]?.status}
              />
            ))
          )}
        </div>
        <div className="px-3.5 py-2.5 border-t border-border-faint text-[11px] text-faint flex items-center gap-1.5">
          <Icon name="folder" size={11} />
          <span className="t-mono truncate">$CODEX_HOME/gpt-image-2-skill/config.json</span>
        </div>
      </div>

      <div className="overflow-hidden">
        <ProviderDetail
          name={selected}
          prov={selected ? providers[selected] : undefined}
          isDefault={selected === effectiveDefault}
          testStatus={currentTest?.status}
          testMessage={currentTest?.message}
          onSetDefault={() => selected && setDefault.mutate(selected)}
          onTest={() => selected && runTest(selected)}
          onDelete={() => {
            if (!selected) return;
            deleteProv.mutate(selected);
            setSelected(undefined);
          }}
        />
      </div>

      <AddProviderDialog open={showAdd} onOpenChange={setShowAdd} />
    </div>
  );
}
