import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { StatusDot } from "@/components/ui/status-dot";
import { Icon } from "@/components/icon";
import { PlaceholderImage } from "@/components/screens/shared/placeholder-image";
import { OutputTile } from "@/components/screens/shared/output-tile";
import { formatDuration, formatTime, statusLabel } from "@/lib/format";
import { api } from "@/lib/api";
import { copyText, openPath, revealPath, saveImages } from "@/lib/user-actions";
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
  onCancel,
}: {
  job?: Job;
  onClose: () => void;
  onDelete?: (id: string) => void;
  onCancel?: (id: string) => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const [selectedOutput, setSelectedOutput] = useState(0);
  const previewSrc = job ? api.jobOutputUrl(job, 0) : "";

  useEffect(() => {
    setImageFailed(false);
    setSelectedOutput(0);
  }, [job?.id, previewSrc]);

  if (!job) return <Empty icon="history" title="选择一条记录" subtitle="点击左侧任意作品，查看图片和保存操作。" />;
  const meta = job.metadata as Record<string, unknown>;
  const seed = parseInt(job.id.replace(/\D/g, ""), 10) || 0;
  const prompt = (meta.prompt as string | undefined) ?? job.command;
  const outputPaths = api.jobOutputPaths(job);
  const outputCount = Math.max(outputPaths.length, job.status === "completed" ? 1 : 0);
  const selectedPath = api.jobOutputPath(job, selectedOutput) ?? outputPaths[0] ?? job.output_path;
  const canSave = job.status === "completed" && Boolean(selectedPath);
  const canCancel = job.status === "queued";

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-[18px] py-3.5 border-b border-border-faint flex items-start gap-2.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <Badge tone={badgeTone(job.status)} size="sm">
              <StatusDot status={job.status} />
              {statusLabel(job.status)}
            </Badge>
            {outputPaths.length > 1 && <span className="t-small">{outputPaths.length} 张图片</span>}
          </div>
          <div className="t-h3 leading-snug">{prompt}</div>
        </div>
        <Button variant="ghost" size="iconSm" icon="x" onClick={onClose} />
      </div>

      <div className="flex-1 overflow-auto p-[18px]">
        {job.status === "completed" && outputCount > 1 && (
          <div className="grid grid-cols-2 gap-2.5 mb-3.5">
            {Array.from({ length: outputCount }).map((_, index) => (
              <OutputTile
                key={index}
                output={{
                  index,
                  url: api.jobOutputUrl(job, index),
                  selected: index === selectedOutput,
                  seed: seed + index,
                }}
                onSelect={() => setSelectedOutput(index)}
                onOpen={() => openPath(api.jobOutputPath(job, index))}
                onDownload={() => saveImages([api.jobOutputPath(job, index)], "图片")}
              />
            ))}
          </div>
        )}
        {job.status === "completed" && outputCount <= 1 && (
          <div className="aspect-square rounded-[10px] overflow-hidden border border-border mb-3.5 bg-sunken">
            {previewSrc && !imageFailed ? (
              <img
                src={previewSrc}
                alt="生成图片预览"
                className="w-full h-full object-cover"
                onError={() => setImageFailed(true)}
              />
            ) : (
              <PlaceholderImage seed={seed} />
            )}
          </div>
        )}
        {job.status !== "completed" && (
          <div className="aspect-square rounded-[10px] overflow-hidden border border-border mb-3.5 bg-sunken">
            <PlaceholderImage seed={seed} />
          </div>
        )}

        <div className="grid mb-4 gap-y-2" style={{ gridTemplateColumns: "100px 1fr" }}>
          <span className="t-tiny pt-0.5">服务商</span>
          <span className="text-[12px]">{job.provider}</span>
          {typeof meta.size === "string" && (<><span className="t-tiny pt-0.5">尺寸</span><span className="t-mono text-[12px]">{meta.size}</span></>)}
          {typeof meta.format === "string" && (<><span className="t-tiny pt-0.5">格式</span><span className="t-mono text-[12px]">{meta.format}</span></>)}
          {typeof meta.quality === "string" && (<><span className="t-tiny pt-0.5">质量</span><span className="text-[12px]">{meta.quality as string}</span></>)}
          {typeof meta.duration_ms === "number" && (<><span className="t-tiny pt-0.5">耗时</span><span className="t-mono text-[12px]">{formatDuration(meta.duration_ms as number)}</span></>)}
          <span className="t-tiny pt-0.5">创建时间</span>
          <span className="text-[12px]">{formatTime(job.created_at)}</span>
        </div>

        {job.status === "completed" && selectedPath && (
          <div className="px-2.5 py-2 mb-3.5 bg-sunken border border-border rounded-md flex items-center gap-2">
            <Icon name="folder" size={13} style={{ color: "var(--text-faint)" }} />
            <span className="text-[12px] flex-1 truncate">图片已保存在本次结果文件夹</span>
            <Button variant="ghost" size="sm" icon="folder" onClick={() => revealPath(selectedPath)}>打开</Button>
            <Button variant="ghost" size="iconSm" icon="copy" onClick={() => copyText(selectedPath, "图片位置")} title="复制图片位置" />
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

        <details className="rounded-md border border-border bg-sunken px-3 py-2 text-[12px]">
          <summary className="cursor-pointer select-none font-semibold">高级信息</summary>
          <div className="mt-2 grid gap-y-1.5" style={{ gridTemplateColumns: "86px 1fr" }}>
            <span className="t-tiny">任务 ID</span>
            <span className="t-mono text-[11px] truncate">{job.id}</span>
            <span className="t-tiny">命令</span>
            <span className="t-mono text-[11px]">{job.command}</span>
          </div>
          <pre className="mt-2 mb-0 max-h-52 overflow-auto rounded bg-raised p-2 font-mono text-[10.5px] leading-[1.45] text-muted">
            {JSON.stringify(job, null, 2)}
          </pre>
        </details>
      </div>

      <div className="px-[18px] py-3 border-t border-border-faint flex gap-2">
        {canCancel ? (
          <Button
            variant="secondary"
            icon="x"
            className="flex-1 justify-center"
            onClick={() => onCancel?.(job.id)}
          >
            取消任务
          </Button>
        ) : (
          <Button variant="secondary" icon="download" className="flex-1 justify-center" onClick={() => saveImages([selectedPath], "图片")} disabled={!canSave}>
          保存选中
          </Button>
        )}
        {outputPaths.length > 1 && (
          <Button variant="secondary" icon="download" onClick={() => saveImages(outputPaths, "图片")}>
            保存全部
          </Button>
        )}
        <Button variant="secondary" icon="copy" onClick={() => copyText(prompt, "提示词")}>复制提示词</Button>
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
