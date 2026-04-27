import { useState } from "react";
import * as Radix from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { RevealImage } from "@/components/ui/reveal-image";
import TiltedCard from "@/components/reactbits/components/TiltedCard";
import { api } from "@/lib/api";
import {
  copyText,
  openPath,
  revealPath,
  saveImages,
} from "@/lib/user-actions";
import { useConfirm } from "@/hooks/use-confirm";
import type { Job } from "@/lib/types";
import { cn } from "@/lib/cn";

type Props = {
  job: Job | null;
  outputIndex: number;
  onClose: () => void;
  onChangeIndex: (idx: number) => void;
  onDelete?: (jobId: string) => void;
  /** Called when user clicks "再来一次" — parent should switch to the
   *  generate screen, which will pick up the prompt/params from
   *  localStorage and prefill the form. */
  onRerun?: () => void;
};

const RERUN_STORAGE_KEY = "gpt2.pendingRerun";

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
      <div className="t-caps">
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
  onRerun,
}: Props) {
  const confirm = useConfirm();
  const [zoomOpen, setZoomOpen] = useState(false);

  const handleRerun = () => {
    if (!job) return;
    const meta = job.metadata as Record<string, unknown>;
    try {
      localStorage.setItem(
        RERUN_STORAGE_KEY,
        JSON.stringify({
          prompt: typeof meta.prompt === "string" ? meta.prompt : "",
          size: typeof meta.size === "string" ? meta.size : undefined,
          format: typeof meta.format === "string" ? meta.format : undefined,
          quality:
            typeof meta.quality === "string" ? meta.quality : undefined,
          n: typeof meta.n === "number" ? meta.n : undefined,
        }),
      );
    } catch {
      /* ignore — private mode etc. */
    }
    onRerun?.();
    onClose();
  };
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
    <>
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
          {onRerun && job && (
            <Button
              variant="ghost"
              size="sm"
              icon="reload"
              onClick={handleRerun}
              title="用相同的 prompt 和参数预填到生成屏"
            >
              再来一次
            </Button>
          )}
          <div className="flex-1" />
          {onDelete && job && (
            <Button
              variant="ghost"
              size="sm"
              icon="trash"
              onClick={async () => {
                const summary = prompt
                  ? prompt.length > 60
                    ? `${prompt.slice(0, 60)}…`
                    : prompt
                  : "（无提示词）";
                const ok = await confirm({
                  title: "删除整个任务记录",
                  description: (
                    <>
                      将删除任务{" "}
                      <span className="text-foreground font-medium">
                        「{summary}」
                      </span>
                      。图片文件不会被删除。
                    </>
                  ),
                  confirmText: "删除",
                  variant: "danger",
                });
                if (!ok) return;
                onDelete(job.id);
                onClose();
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
        {/* Big image — TiltedCard for the brand "liquid" hover-tilt feel,
            wrapped in a button so click still escalates to fullscreen zoom. */}
        <div className="relative flex items-center justify-center">
          {url ? (
            <button
              type="button"
              onClick={() => setZoomOpen(true)}
              className="block w-full max-w-[340px] cursor-zoom-in rounded-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-55)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--bg)]"
              aria-label={`查看第 ${letter} 张大图`}
            >
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
            </button>
          ) : (
            <div className="flex h-[340px] w-full items-center justify-center rounded-lg border border-[color:var(--w-08)] bg-[color:var(--w-02)] text-[12.5px] text-faint">
              暂无图片预览
            </div>
          )}

          {outputCount > 1 && (
            <>
              <button
                type="button"
                onClick={goPrev}
                aria-label="上一张"
                className="absolute left-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full inline-flex items-center justify-center bg-[color:var(--k-45)] backdrop-blur border border-[color:var(--w-10)] text-foreground/85 hover:text-foreground hover:bg-[color:var(--k-65)] transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                onClick={goNext}
                aria-label="下一张"
                className="absolute right-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full inline-flex items-center justify-center bg-[color:var(--k-45)] backdrop-blur border border-[color:var(--w-10)] text-foreground/85 hover:text-foreground hover:bg-[color:var(--k-65)] transition-colors"
              >
                <ChevronRight size={16} />
              </button>
            </>
          )}
        </div>

        {/* Strip of all outputs (only if more than 1) */}
        {outputCount > 1 && job && (
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-1">
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
                      ? "ring-[color:var(--accent-55)] scale-[1.04]"
                      : "ring-[color:var(--w-10)] opacity-65 hover:opacity-100",
                  )}
                  aria-label={`第 ${i + 1} 张`}
                  title={`第 ${i + 1} 张`}
                >
                  {tUrl ? (
                    <img
                      src={tUrl}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                      draggable={false}
                    />
                  ) : (
                    <div className="h-full w-full bg-[color:var(--w-04)]" />
                  )}
                  <span
                    className="absolute bottom-0 left-0 right-0 h-3.5 flex items-center justify-center text-[8.5px] font-mono text-foreground"
                    style={{
                      background:
                        "linear-gradient(to top, var(--k-70), transparent)",
                    }}
                  >
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
            <div className="t-caps mb-1.5">
              提示词
            </div>
            <div className="text-[12.5px] text-foreground leading-relaxed whitespace-pre-wrap break-words">
              {prompt || "（无提示词）"}
            </div>
          </div>

          <div className="border-t border-[color:var(--w-06)]" />

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

          <div className="border-t border-[color:var(--w-06)]" />

          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <div className="t-caps">
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

    {/* Fullscreen image zoom — opened by clicking the big image. Plain
        Radix Dialog so we can size it 90vw/90vh without the standard
        <Dialog> wrapper's max-width. */}
    <Radix.Root open={zoomOpen} onOpenChange={setZoomOpen}>
      <Radix.Portal>
        <Radix.Overlay
          className="fixed inset-0 z-[60] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
          style={{
            background: "var(--k-70)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}
        />
        <Radix.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-[61] -translate-x-1/2 -translate-y-1/2 max-w-[92vw] max-h-[92vh] outline-none data-[state=open]:animate-in data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:zoom-out-95"
        >
          <Radix.Title className="sr-only">
            {outputCount > 1 ? `作品 ${letter}` : "作品详情"}
          </Radix.Title>
          {url && (
            <RevealImage
              src={url}
              alt={`第 ${letter} 张大图`}
              decoding="async"
              duration={500}
              className="block max-w-[92vw] max-h-[92vh] object-contain rounded-lg shadow-[var(--shadow-floating)]"
            />
          )}
          <Radix.Close asChild>
            <button
              type="button"
              aria-label="关闭"
              className="absolute -top-2 -right-2 h-9 w-9 rounded-full inline-flex items-center justify-center bg-[color:var(--surface-floating)] backdrop-blur border border-[color:var(--surface-floating-border)] text-foreground hover:bg-[color:var(--surface-floating-strong)] transition-colors"
              style={{ boxShadow: "var(--shadow-floating)" }}
            >
              <X size={16} />
            </button>
          </Radix.Close>
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
    </>
  );
}
