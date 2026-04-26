import { ChevronLeft, ChevronRight } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import TiltedCard from "@/components/reactbits/components/TiltedCard";
import { api } from "@/lib/api";
import {
  copyText,
  openPath,
  revealPath,
  saveImages,
} from "@/lib/user-actions";
import type { Job } from "@/lib/types";
import { cn } from "@/lib/cn";

type Props = {
  job: Job | null;
  outputIndex: number;
  onClose: () => void;
  onChangeIndex: (idx: number) => void;
  onDelete?: (jobId: string) => void;
};

function fmtBytes(bytes?: number): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function fmtDateTime(s?: string): string {
  if (!s) return "—";
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return s;
  }
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] font-semibold tracking-wider uppercase text-faint">
        {label}
      </div>
      <div
        className="font-mono text-[12px] text-foreground mt-0.5 truncate"
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

export function JobImageDetailDrawer({
  job,
  outputIndex,
  onClose,
  onChangeIndex,
  onDelete,
}: Props) {
  const open = Boolean(job);
  const outputCount = job?.outputs?.length ?? 0;
  const url = job ? (api.outputUrl(job.id, outputIndex) ?? null) : null;
  const path = job ? (api.outputPath(job.id, outputIndex) ?? null) : null;

  const md = (job?.metadata ?? {}) as Record<string, unknown>;
  const prompt = ((md.prompt as string | undefined) ?? "").trim();
  const size = (md.size as string | undefined) ?? "—";
  const quality = (md.quality as string | undefined) ?? "auto";
  const format = ((md.format as string | undefined) ?? "png").toUpperCase();
  const provider = job?.provider ?? "—";
  const bytes = job?.outputs?.[outputIndex]?.bytes;
  const created = fmtDateTime(job?.created_at);
  const updated = fmtDateTime(job?.updated_at);
  const letter = outputCount > 0 ? String.fromCharCode(65 + outputIndex) : "—";

  const goPrev = () => {
    if (outputCount <= 1) return;
    onChangeIndex((outputIndex - 1 + outputCount) % outputCount);
  };
  const goNext = () => {
    if (outputCount <= 1) return;
    onChangeIndex((outputIndex + 1) % outputCount);
  };

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={
        outputCount > 1
          ? `作品 ${letter} · ${outputIndex + 1} / ${outputCount}`
          : "作品详情"
      }
      description={prompt ? prompt.slice(0, 80) : "（无提示词）"}
      width={520}
      footer={
        <div className="flex w-full items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon="copy"
            disabled={!path}
            onClick={() => {
              if (path) void copyText(path, "图片路径");
            }}
          >
            复制路径
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon="folder"
            disabled={!path}
            onClick={() => {
              if (path) void revealPath(path);
            }}
          >
            打开位置
          </Button>
          <div className="flex-1" />
          {onDelete && job && (
            <Button
              variant="ghost"
              size="sm"
              icon="trash"
              onClick={() => {
                if (
                  window.confirm("删除整个任务记录？图片文件不会被删除。")
                ) {
                  onDelete(job.id);
                  onClose();
                }
              }}
            >
              删除
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            icon="download"
            disabled={!path}
            onClick={() => {
              if (path) void saveImages([path], "图片");
            }}
          >
            保存到下载
          </Button>
        </div>
      }
    >
      <div className="p-5 space-y-5">
        {/* Big image with prev / next overlay */}
        <div className="relative flex items-center justify-center">
          {url ? (
            <TiltedCard
              imageSrc={url}
              altText={`第 ${letter} 张`}
              containerWidth="100%"
              containerHeight="340px"
              imageWidth="340px"
              imageHeight="340px"
              rotateAmplitude={8}
              scaleOnHover={1.04}
              showMobileWarning={false}
              showTooltip={false}
            />
          ) : (
            <div className="flex h-[340px] w-full items-center justify-center rounded-lg border border-white/[.08] bg-[rgba(255,255,255,0.02)] text-[12.5px] text-faint">
              暂无图片预览
            </div>
          )}

          {outputCount > 1 && (
            <>
              <button
                type="button"
                onClick={goPrev}
                aria-label="上一张"
                className="absolute left-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full inline-flex items-center justify-center bg-black/45 backdrop-blur border border-white/[.10] text-white/85 hover:text-white hover:bg-black/65 transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                onClick={goNext}
                aria-label="下一张"
                className="absolute right-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full inline-flex items-center justify-center bg-black/45 backdrop-blur border border-white/[.10] text-white/85 hover:text-white hover:bg-black/65 transition-colors"
              >
                <ChevronRight size={16} />
              </button>
            </>
          )}
        </div>

        {/* Strip of all outputs (only if more than 1) */}
        {outputCount > 1 && job && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {job.outputs.map((_, i) => {
              const tUrl = api.outputUrl(job.id, i);
              const isActive = i === outputIndex;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => onChangeIndex(i)}
                  className={cn(
                    "relative shrink-0 h-12 w-12 rounded overflow-hidden ring-1 transition-all",
                    isActive
                      ? "ring-[rgba(167,139,250,0.55)] scale-[1.04]"
                      : "ring-white/[.10] opacity-65 hover:opacity-100",
                  )}
                  aria-label={`第 ${i + 1} 张`}
                  title={`第 ${i + 1} 张`}
                >
                  {tUrl ? (
                    <img
                      src={tUrl}
                      alt=""
                      className="h-full w-full object-cover"
                      draggable={false}
                    />
                  ) : (
                    <div className="h-full w-full bg-[rgba(255,255,255,0.04)]" />
                  )}
                  <span className="absolute bottom-0 left-0 right-0 h-3.5 flex items-center justify-center text-[8.5px] font-mono bg-gradient-to-t from-black/70 to-transparent text-white">
                    {String.fromCharCode(65 + i)}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Metadata panel */}
        <section className="surface-panel p-4 space-y-3.5">
          <div>
            <div className="text-[10.5px] font-semibold tracking-wider uppercase text-faint mb-1.5">
              提示词
            </div>
            <div className="text-[12.5px] text-foreground leading-relaxed whitespace-pre-wrap break-words">
              {prompt || "（无提示词）"}
            </div>
          </div>

          <div className="border-t border-white/[0.06]" />

          <div className="grid grid-cols-2 gap-3">
            <Detail label="尺寸" value={size} />
            <Detail label="质量" value={quality} />
            <Detail label="格式" value={format} />
            <Detail label="文件大小" value={fmtBytes(bytes)} />
            <Detail label="凭证" value={provider} />
            <Detail label="任务命令" value={job?.command ?? "—"} />
            <Detail label="创建时间" value={created} />
            <Detail label="更新时间" value={updated} />
          </div>

          <div className="border-t border-white/[0.06]" />

          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <div className="text-[10.5px] font-semibold tracking-wider uppercase text-faint">
                文件路径
              </div>
              <div
                className="font-mono text-[11px] text-muted mt-0.5 truncate"
                title={path ?? undefined}
              >
                {path ?? "—"}
              </div>
            </div>
            <Button
              variant="ghost"
              size="iconSm"
              icon="external"
              disabled={!path}
              onClick={() => {
                if (path) void openPath(path);
              }}
              title="用默认应用打开"
              aria-label="用默认应用打开"
            />
          </div>
        </section>
      </div>
    </Drawer>
  );
}
