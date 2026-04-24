import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { StatusDot } from "@/components/ui/status-dot";
import { Icon } from "@/components/icon";
import { PlaceholderImage } from "@/components/screens/shared/placeholder-image";
import { formatDuration, formatTime, statusLabel } from "@/lib/format";
import { api } from "@/lib/api";
import type { Job } from "@/lib/types";

function badgeTone(status: Job["status"]) {
  if (status === "completed") return "ok" as const;
  if (status === "failed" || status === "cancelled") return "err" as const;
  if (status === "running") return "running" as const;
  return "queued" as const;
}

export function JobMetadataDrawer({
  job,
  onClose,
  onDelete,
}: {
  job?: Job;
  onClose: () => void;
  onDelete?: (id: string) => void;
}) {
  if (!job) return <Empty icon="history" title="选择任务" subtitle="点击任意一行查看元数据和输出。" />;
  const meta = job.metadata as Record<string, unknown>;
  const seed = parseInt(job.id.replace(/\D/g, ""), 10) || 0;
  const prompt = (meta.prompt as string | undefined) ?? job.command;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-[18px] py-3.5 border-b border-border-faint flex items-start gap-2.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="t-mono t-small text-faint">{job.id}</span>
            <Badge tone={badgeTone(job.status)} size="sm">
              <StatusDot status={job.status} />
              {statusLabel(job.status)}
            </Badge>
          </div>
          <div className="t-h3 leading-snug">{prompt}</div>
        </div>
        <Button variant="ghost" size="iconSm" icon="x" onClick={onClose} />
      </div>

      <div className="flex-1 overflow-auto p-[18px]">
        {job.status === "completed" && (
          <div className="aspect-square rounded-[10px] overflow-hidden border border-border mb-3.5 bg-sunken">
            <img
              src={api.outputUrl(job.id, 0)}
              alt=""
              className="w-full h-full object-cover"
              onError={(e) => {
                const parent = e.currentTarget.parentElement!;
                e.currentTarget.remove();
                parent.innerHTML = "";
                const svgEl = document.createElement("div");
                svgEl.style.width = "100%";
                svgEl.style.height = "100%";
                parent.appendChild(svgEl);
              }}
            />
          </div>
        )}
        {job.status !== "completed" && (
          <div className="aspect-square rounded-[10px] overflow-hidden border border-border mb-3.5 bg-sunken">
            <PlaceholderImage seed={seed} />
          </div>
        )}

        <div className="grid mb-4 gap-y-2" style={{ gridTemplateColumns: "100px 1fr" }}>
          <span className="t-tiny pt-0.5">命令</span>
          <span className="t-mono text-[12px]">{job.command}</span>
          <span className="t-tiny pt-0.5">服务商</span>
          <span className="text-[12px]">{job.provider}</span>
          {typeof meta.size === "string" && (<><span className="t-tiny pt-0.5">尺寸</span><span className="t-mono text-[12px]">{meta.size}</span></>)}
          {typeof meta.format === "string" && (<><span className="t-tiny pt-0.5">格式</span><span className="t-mono text-[12px]">{meta.format}</span></>)}
          {typeof meta.quality === "string" && (<><span className="t-tiny pt-0.5">质量</span><span className="text-[12px]">{meta.quality as string}</span></>)}
          {typeof meta.duration_ms === "number" && (<><span className="t-tiny pt-0.5">耗时</span><span className="t-mono text-[12px]">{formatDuration(meta.duration_ms as number)}</span></>)}
          <span className="t-tiny pt-0.5">创建时间</span>
          <span className="text-[12px]">{formatTime(job.created_at)}</span>
        </div>

        {job.output_path && (
          <div className="px-2.5 py-2 mb-3.5 bg-sunken border border-border rounded-md flex items-center gap-2">
            <Icon name="folder" size={13} style={{ color: "var(--text-faint)" }} />
            <span className="t-mono text-[11px] flex-1 truncate">{job.output_path}</span>
            <Button variant="ghost" size="iconSm" icon="copy" onClick={() => navigator.clipboard.writeText(job.output_path!)} title="复制路径" />
          </div>
        )}

        {job.status === "failed" && job.error && (
          <div className="px-3 py-2.5 mb-3.5 bg-status-err-bg text-status-err border border-status-err rounded-md text-[12px] flex items-start gap-2">
            <Icon name="warn" size={13} style={{ marginTop: 1 }} />
            <div>
              <div className="font-semibold mb-0.5">错误</div>
              <div>{(job.error as Record<string, unknown>).message as string}</div>
            </div>
          </div>
        )}

        <div className="t-caps mb-2">原始元数据</div>
        <pre className="m-0 px-3 py-2.5 bg-sunken border border-border rounded-md font-mono text-[11px] text-muted overflow-auto leading-[1.5]">
          {JSON.stringify(job, null, 2)}
        </pre>
      </div>

      <div className="px-[18px] py-3 border-t border-border-faint flex gap-2">
        <Button variant="secondary" icon="reload" className="flex-1 justify-center">重新运行</Button>
        <Button variant="secondary" icon="copy">复制 CLI</Button>
        {onDelete && (
          <Button
            variant="danger"
            icon="trash"
            onClick={() => onDelete(job.id)}
          />
        )}
      </div>
    </div>
  );
}
