import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDuration, formatTime } from "@/lib/format";
import { resultLocationText } from "@/lib/runtime-copy";
import { copyText, revealPath } from "@/lib/user-actions";
import type { Job, OutputUploadRef } from "@/lib/types";
import { storageStatusLabel, uploadStatusTone } from "./job-drawer-utils";

export function JobDrawerMetadata({
  job,
  meta,
}: {
  job: Job;
  meta: Record<string, unknown>;
}) {
  return (
    <div
      className="grid mb-4 gap-y-2"
      style={{ gridTemplateColumns: "100px 1fr" }}
    >
      <span className="t-tiny pt-0.5">凭证</span>
      <span className="text-[12px]">{job.provider}</span>
      {typeof meta.size === "string" && (
        <>
          <span className="t-tiny pt-0.5">尺寸</span>
          <span className="t-mono text-[12px]">{meta.size}</span>
        </>
      )}
      {typeof meta.format === "string" && (
        <>
          <span className="t-tiny pt-0.5">格式</span>
          <span className="t-mono text-[12px]">{meta.format}</span>
        </>
      )}
      {typeof meta.quality === "string" && (
        <>
          <span className="t-tiny pt-0.5">质量</span>
          <span className="text-[12px]">{meta.quality as string}</span>
        </>
      )}
      {typeof meta.duration_ms === "number" && (
        <>
          <span className="t-tiny pt-0.5">耗时</span>
          <span className="t-mono text-[12px]">
            {formatDuration(meta.duration_ms as number)}
          </span>
        </>
      )}
      <span className="t-tiny pt-0.5">创建时间</span>
      <span className="text-[12px]">{formatTime(job.created_at)}</span>
    </div>
  );
}

export function JobDrawerLocation({
  previewPath,
  selectedLabel,
}: {
  previewPath?: string;
  selectedLabel: string;
}) {
  if (!previewPath) return null;
  return (
    <div className="px-2.5 py-2 mb-3.5 bg-sunken border border-border rounded-md flex items-center gap-2">
      <Icon name="folder" size={13} style={{ color: "var(--text-faint)" }} />
      <span className="text-[12px] flex-1 truncate">
        {resultLocationText(selectedLabel)}
      </span>
      {api.canRevealFiles && (
        <>
          <Button
            variant="ghost"
            size="sm"
            icon="folder"
            onClick={() => revealPath(previewPath)}
          >
            打开
          </Button>
          <Button
            variant="ghost"
            size="iconSm"
            icon="copy"
            onClick={() => copyText(previewPath, "图片位置")}
            title="复制图片位置"
          />
        </>
      )}
    </div>
  );
}

export function JobDrawerStorage({
  job,
  selectedUploads,
}: {
  job: Job;
  selectedUploads: OutputUploadRef[];
}) {
  return (
    <section className="mb-3.5 rounded-md border border-border bg-sunken px-3 py-2.5">
      <div className="mb-2 flex items-center gap-2">
        <div className="text-[12px] font-semibold">存储投递</div>
        <span className="t-tiny ml-auto">
          {storageStatusLabel(job.storage_status)}
        </span>
      </div>
      {selectedUploads.length > 0 ? (
        <div className="space-y-1.5">
          {selectedUploads.map((upload) => (
            <div
              key={`${upload.target}:${upload.updated_at ?? upload.status}`}
              className="rounded bg-raised px-2.5 py-2 text-[11.5px]"
            >
              <div className="flex items-center gap-2">
                <span className="font-semibold">{upload.target}</span>
                <span className="t-caps">{upload.target_type}</span>
                <span
                  className={cn(
                    "ml-auto text-[11px] font-semibold",
                    uploadStatusTone(upload.status),
                  )}
                >
                  {upload.status}
                </span>
              </div>
              {upload.url && (
                <div className="mt-1 flex items-center gap-1.5">
                  <a
                    href={upload.url}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-accent"
                    title={upload.url}
                  >
                    {upload.url}
                  </a>
                  <Button
                    variant="ghost"
                    size="iconSm"
                    icon="copy"
                    onClick={() => copyText(upload.url ?? "", "上传 URL")}
                    title="复制上传 URL"
                    aria-label="复制上传 URL"
                  />
                </div>
              )}
              {upload.error && (
                <div className="mt-1 break-anywhere text-[11px] text-status-err">
                  {upload.error}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-[11.5px] text-muted">
          当前候选还没有上传记录。
        </div>
      )}
    </section>
  );
}

export function JobDrawerError({ job }: { job: Job }) {
  if (job.status !== "failed" || !job.error) return null;
  return (
    <div className="px-3 py-2.5 mb-3.5 bg-status-err-bg text-status-err border border-status-err rounded-md text-[12px] flex items-start gap-2">
      <Icon name="warn" size={13} style={{ marginTop: 1 }} />
      <div>
        <div className="font-semibold mb-0.5">错误</div>
        <div>{(job.error as Record<string, unknown>).message as string}</div>
      </div>
    </div>
  );
}

export function JobDrawerPrompt({
  prompt,
  promptCount,
}: {
  prompt: string;
  promptCount: number;
}) {
  return (
    <section className="mb-3.5 rounded-md border border-border bg-sunken px-3 py-2.5">
      <div className="mb-2 flex items-center gap-2">
        <div className="text-[12px] font-semibold">提示词</div>
        {promptCount > 0 && (
          <span className="t-tiny ml-auto">{promptCount} 字</span>
        )}
        <Button
          variant="ghost"
          size="iconSm"
          icon="copy"
          onClick={() => copyText(prompt, "提示词")}
          title="复制提示词"
          aria-label="复制提示词"
        />
      </div>
      <div className="max-h-44 overflow-auto whitespace-pre-wrap break-anywhere rounded bg-raised px-2.5 py-2 text-[12px] leading-[1.55] text-muted">
        {prompt}
      </div>
    </section>
  );
}

export function JobDrawerAdvanced({ job }: { job: Job }) {
  return (
    <details className="rounded-md border border-border bg-sunken px-3 py-2 text-[12px]">
      <summary className="cursor-pointer select-none font-semibold">
        高级信息
      </summary>
      <div
        className="mt-2 grid gap-y-1.5"
        style={{ gridTemplateColumns: "86px 1fr" }}
      >
        <span className="t-tiny">任务 ID</span>
        <span className="t-mono text-[11px] truncate">{job.id}</span>
        <span className="t-tiny">命令</span>
        <span className="t-mono text-[11px]">{job.command}</span>
      </div>
      <pre className="mt-2 mb-0 max-h-52 overflow-auto rounded bg-raised p-2 font-mono text-[10.5px] leading-[1.45] text-muted">
        {JSON.stringify(job, null, 2)}
      </pre>
    </details>
  );
}
