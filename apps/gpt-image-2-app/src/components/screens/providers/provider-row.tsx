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
  onEdit,
  testStatus,
}: {
  name: string;
  prov: ProviderConfig;
  isDefault?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  onEdit?: () => void;
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
        selected ? "bg-pressed" : hover ? "bg-hover" : "bg-transparent",
      )}
      style={{ gridTemplateColumns: "32px minmax(0, 1fr) auto" }}
    >
      <div
        className="w-[30px] h-[30px] rounded-md bg-sunken border border-border flex items-center justify-center"
        style={{ color: isDefault ? "var(--accent)" : "var(--text-faint)" }}
      >
        <Icon name="cpu" size={15} />
      </div>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[13.5px] font-semibold">{name}</span>
          {isDefault && (
            <Badge tone="accent" size="sm" icon="check">
              默认
            </Badge>
          )}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-[11px] text-muted">
          <span className="shrink-0">{providerKindLabel(prov.type)}</span>
          <span>·</span>
          <span className="t-mono shrink-0">{prov.model ?? "—"}</span>
          {prov.api_base && (
            <>
              <span>·</span>
              <span className="t-mono min-w-0 truncate text-faint">
                {prov.api_base}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <div className="hidden gap-1 xl:flex">
          {Object.entries(prov.credentials)
            .slice(0, 2)
            .map(([k, c]) => (
              <Tooltip key={k} text={`${k} · ${c.source}`}>
                <span>
                  <SourceChip source={c.source} />
                </span>
              </Tooltip>
            ))}
        </div>
        {testStatus === "ok" && (
          <Badge tone="ok" size="sm" icon="check">
            就绪
          </Badge>
        )}
        {testStatus === "err" && (
          <Badge tone="err" size="sm" icon="warn">
            失败
          </Badge>
        )}
        {testStatus === "running" && (
          <span className="inline-flex items-center gap-1 text-[11px] text-status-running">
            <Spinner size={10} color="var(--status-running)" />
            测试中
          </span>
        )}
        <Button
          variant="ghost"
          size="iconSm"
          icon="dots"
          onClick={(e) => {
            e.stopPropagation();
            onEdit?.();
          }}
          title="编辑凭证"
          aria-label={`编辑凭证 ${name}`}
        />
      </div>
    </div>
  );
}
