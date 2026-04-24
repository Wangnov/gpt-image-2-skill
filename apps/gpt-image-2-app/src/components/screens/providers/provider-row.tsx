import { useState } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { SourceChip } from "@/components/ui/source-chip";
import { Tooltip } from "@/components/ui/tooltip";
import { providerKindLabel } from "@/lib/format";
import type { ProviderConfig } from "@/lib/types";

export function ProviderRow({
  name,
  prov,
  isDefault,
  selected,
  onSelect,
  testStatus,
}: {
  name: string;
  prov: ProviderConfig;
  isDefault?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  testStatus?: "idle" | "running" | "ok" | "err";
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={cn(
        "grid items-center gap-3 px-3.5 py-3 border-b border-border-faint cursor-pointer transition-colors",
        selected ? "bg-pressed" : hover ? "bg-hover" : "bg-transparent"
      )}
      style={{ gridTemplateColumns: "32px 1fr auto auto" }}
    >
      <div
        className="w-[30px] h-[30px] rounded-md bg-sunken border border-border flex items-center justify-center"
        style={{ color: isDefault ? "var(--accent)" : "var(--text-faint)" }}
      >
        <Icon name="cpu" size={15} />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[13.5px] font-semibold">{name}</span>
          {isDefault && <Badge tone="accent" size="sm" icon="check">默认</Badge>}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted">
          <span>{providerKindLabel(prov.type)}</span>
          <span>·</span>
          <span className="t-mono">{prov.model ?? "—"}</span>
          {prov.api_base && (<><span>·</span><span className="t-mono text-faint truncate max-w-[180px]">{prov.api_base}</span></>)}
        </div>
      </div>
      <div className="flex gap-1">
        {Object.entries(prov.credentials).map(([k, c]) => (
          <Tooltip key={k} text={`${k} · ${c.source}`}>
            <span><SourceChip source={c.source} /></span>
          </Tooltip>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        {testStatus === "ok" && <Badge tone="ok" size="sm" icon="check">就绪</Badge>}
        {testStatus === "err" && <Badge tone="err" size="sm" icon="warn">失败</Badge>}
        {testStatus === "running" && (
          <span className="inline-flex items-center gap-1 text-[11px] text-status-running">
            <Spinner size={10} color="var(--status-running)" />
            测试中
          </span>
        )}
        <Button variant="ghost" size="iconSm" icon="dots" onClick={(e) => e.stopPropagation()} />
      </div>
    </div>
  );
}
