import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { ImageContextMenu } from "@/components/ui/image-context-menu";
import { openQuickLook } from "@/components/ui/quick-look";
import TiltedCard from "@/components/reactbits/components/TiltedCard";
import { copyText, openPath, revealPath, saveImages } from "@/lib/user-actions";
import { useConfirm } from "@/hooks/use-confirm";
import { isDesktopRuntime, runtimeCopy } from "@/lib/runtime-copy";
import type { Job } from "@/lib/types";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import {
  jobOutputIndexes,
  jobOutputPath,
  jobOutputUrl,
} from "@/lib/job-outputs";
import { imageAssetFromOutput } from "@/lib/image-actions/asset";
import type { ImageAsset } from "@/lib/image-actions/types";
import { PlaceholderImage } from "@/components/screens/shared/placeholder-image";

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
  onRetry?: (jobId: string) => void;
  onSendToEdit?: (job: Job, outputIndex: number) => void;
};

const RERUN_STORAGE_KEY = "gpt2.pendingRerun";
const DETAIL_IMAGE_SIZE = "min(340px, calc(100vw - 88px))";

function fmtBytes(bytes?: number): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="t-caps">{label}</div>
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
  onRetry,
  onSendToEdit,
}: Props) {
  const confirm = useConfirm();
  const [imageFailed, setImageFailed] = useState(false);
  const [thumbFailed, setThumbFailed] = useState<Set<number>>(new Set());
  const copy = runtimeCopy();
  const canShowFileLocation = isDesktopRuntime();

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
          quality: typeof meta.quality === "string" ? meta.quality : undefined,
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
  const outputIndexes = job ? jobOutputIndexes(job) : [];
  const outputCount = outputIndexes.length;
  const activeOutputIndex = outputIndexes.includes(outputIndex)
    ? outputIndex
    : (outputIndexes[0] ?? 0);
  const activePosition = Math.max(0, outputIndexes.indexOf(activeOutputIndex));
  const url = job ? jobOutputUrl(job, activeOutputIndex) : null;
  const path = job ? jobOutputPath(job, activeOutputIndex) : null;

  useEffect(() => {
    setImageFailed(false);
  }, [url]);

  useEffect(() => {
    setThumbFailed(new Set());
  }, [job?.id, outputCount]);

  const md = (job?.metadata ?? {}) as Record<string, unknown>;
  const prompt = ((md.prompt as string | undefined) ?? "").trim();
  const size = (md.size as string | undefined) ?? "—";
  const quality = (md.quality as string | undefined) ?? "auto";
  const format = ((md.format as string | undefined) ?? "png").toUpperCase();
  const provider = job?.provider ?? "—";
  const bytes = job?.outputs?.find(
    (output) => output.index === activeOutputIndex,
  )?.bytes;
  const created = formatDateTime(job?.created_at);
  const updated = formatDateTime(job?.updated_at);
  const letter =
    outputCount > 0 ? String.fromCharCode(65 + activePosition) : "—";

  const goPrev = () => {
    if (outputCount <= 1) return;
    onChangeIndex(
      outputIndexes[(activePosition - 1 + outputCount) % outputCount],
    );
  };
  const goNext = () => {
    if (outputCount <= 1) return;
    onChangeIndex(outputIndexes[(activePosition + 1) % outputCount]);
  };

  // QuickLook owns its own ArrowLeft/ArrowRight handling; the drawer no
  // longer needs a parallel keyboard listener.

  const peerAssets: ImageAsset[] = job
    ? outputIndexes.map((idx) =>
        imageAssetFromOutput({
          jobId: job.id,
          outputIndex: idx,
          src: jobOutputUrl(job, idx) ?? "",
          path: jobOutputPath(job, idx) ?? null,
          prompt: prompt || undefined,
          command: job.command,
          job,
        }),
      )
    : [];
  const activeAsset =
    peerAssets[activePosition] ??
    (job && url
      ? imageAssetFromOutput({
          jobId: job.id,
          outputIndex: activeOutputIndex,
          src: url,
          path: path ?? null,
          prompt: prompt || undefined,
          command: job.command,
          job,
        })
      : null);

  const openZoom = () => {
    if (!activeAsset) return;
    openQuickLook({
      asset: activeAsset,
      peers: peerAssets.length > 1 ? peerAssets : undefined,
      onChange: (next) => onChangeIndex(next.outputIndex),
    });
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
            ? `作品 ${letter} · ${activePosition + 1} / ${outputCount}`
            : "作品详情"
        }
        description={prompt ? prompt.slice(0, 80) : "（无提示词）"}
        width={520}
        footer={
          <div className="flex w-full min-w-0 items-center gap-1.5">
            {canShowFileLocation && (
              <>
                <Tooltip text="复制路径">
                  <Button
                    variant="ghost"
                    size="iconSm"
                    icon="copy"
                    aria-label="复制路径"
                    disabled={!path}
                    onClick={() => {
                      if (path) void copyText(path, "图片路径");
                    }}
                  />
                </Tooltip>
                <Tooltip text="在 Finder 中显示">
                  <Button
                    variant="ghost"
                    size="iconSm"
                    icon="folder"
                    aria-label="在 Finder 中显示"
                    disabled={!path}
                    onClick={() => {
                      if (path) void revealPath(path);
                    }}
                  />
                </Tooltip>
              </>
            )}
            {onRerun && job && (
              <Tooltip text="再来一次（用相同参数预填生成屏）">
                <Button
                  variant="ghost"
                  size="iconSm"
                  icon="reload"
                  aria-label="再来一次"
                  onClick={handleRerun}
                />
              </Tooltip>
            )}
            {onRetry &&
              job &&
              (job.status === "failed" || job.status === "cancelled") && (
                <Tooltip text="重试（原样重新提交）">
                  <Button
                    variant="secondary"
                    size="iconSm"
                    icon="reload"
                    aria-label="重试"
                    onClick={() => onRetry(job.id)}
                  />
                </Tooltip>
              )}
            {onSendToEdit && job && (
              <Tooltip text="发送到编辑（作为参考图）">
                <Button
                  variant="secondary"
                  size="iconSm"
                  icon="edit"
                  aria-label="发送到编辑"
                  disabled={!path && !url}
                  onClick={() => onSendToEdit(job, activeOutputIndex)}
                />
              </Tooltip>
            )}
            <div className="min-w-2 flex-1" />
            {onDelete && job && (
              <Tooltip text="删除任务">
                <Button
                  variant="ghost"
                  size="iconSm"
                  icon="trash"
                  aria-label="删除任务"
                  onClick={async () => {
                    const outputCount = job.outputs?.length ?? 1;
                    const description =
                      outputCount > 1
                        ? `这是包含 ${outputCount} 张图的任务，删除会移除整个任务记录和全部 ${outputCount} 张图，无法分别删除单张。`
                        : "这会删除这张图和它的任务记录。图片文件会移到回收站。";
                    const ok = await confirm({
                      title: "删除任务？",
                      description,
                      confirmText: "删除任务",
                      variant: "danger",
                    });
                    if (!ok) return;
                    onDelete(job.id);
                    onClose();
                  }}
                />
              </Tooltip>
            )}
            <Tooltip text={copy.saveImageLabel}>
              <Button
                variant="primary"
                size="iconSm"
                icon="download"
                aria-label={copy.saveImageLabel}
                disabled={!path}
                onClick={() => {
                  if (path) void saveImages([path], "图片");
                }}
              />
            </Tooltip>
          </div>
        }
      >
        <div className="min-w-0 space-y-5 p-5">
          {/* Big image — TiltedCard for the brand "liquid" hover-tilt feel,
            wrapped in a button so click still escalates to fullscreen zoom. */}
          <div className="relative flex min-w-0 items-center justify-center overflow-hidden">
            {url && !imageFailed && activeAsset ? (
              <ImageContextMenu asset={activeAsset}>
                <button
                  type="button"
                  onClick={openZoom}
                  className="mx-auto block w-full max-w-[340px] cursor-zoom-in rounded-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-55)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--bg)]"
                  aria-label={`查看第 ${letter} 张大图`}
                >
                  <TiltedCard
                    imageSrc={url}
                    altText={`第 ${letter} 张`}
                    containerWidth="100%"
                    containerHeight={DETAIL_IMAGE_SIZE}
                    imageWidth={DETAIL_IMAGE_SIZE}
                    imageHeight={DETAIL_IMAGE_SIZE}
                    rotateAmplitude={8}
                    scaleOnHover={1.04}
                    showMobileWarning={false}
                    showTooltip={false}
                    onImageError={() => setImageFailed(true)}
                  />
                </button>
              </ImageContextMenu>
            ) : (
              <div className="h-[340px] w-full overflow-hidden rounded-lg border border-[color:var(--w-08)] bg-[color:var(--w-02)]">
                <PlaceholderImage
                  seed={activeOutputIndex + 23}
                  variant={`detail-${job?.id ?? "empty"}`}
                />
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
              {outputIndexes.map((outputIndex, i) => {
                const tUrl = jobOutputUrl(job, outputIndex);
                const isActive = outputIndex === activeOutputIndex;
                const thumbAsset = peerAssets[i] ?? activeAsset;
                const button = (
                  <button
                    key={outputIndex}
                    type="button"
                    onClick={() => onChangeIndex(outputIndex)}
                    className={cn(
                      "relative shrink-0 h-12 w-12 rounded overflow-hidden ring-1 transition-all",
                      isActive
                        ? "ring-[color:var(--accent-55)] scale-[1.04]"
                        : "ring-[color:var(--w-10)] opacity-65 hover:opacity-100",
                    )}
                    aria-label={`第 ${i + 1} 张`}
                    title={`第 ${i + 1} 张`}
                  >
                    {tUrl && !thumbFailed.has(outputIndex) ? (
                      <img
                        src={tUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover"
                        draggable={false}
                        onError={() =>
                          setThumbFailed((prev) =>
                            new Set(prev).add(outputIndex),
                          )
                        }
                      />
                    ) : (
                      <PlaceholderImage
                        seed={outputIndex + i + 19}
                        variant={`detail-thumb-${job.id}`}
                      />
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
                return thumbAsset ? (
                  <ImageContextMenu key={outputIndex} asset={thumbAsset}>
                    {button}
                  </ImageContextMenu>
                ) : (
                  button
                );
              })}
            </div>
          )}

          {/* Metadata panel */}
          <section className="surface-panel p-4 space-y-3.5">
            <div>
              <div className="t-caps mb-1.5">提示词</div>
              <div className="break-anywhere whitespace-pre-wrap text-[12.5px] leading-relaxed text-foreground">
                {prompt || "（无提示词）"}
              </div>
            </div>

            <div className="border-t border-[color:var(--w-06)]" />

            <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
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

            <div className="flex min-w-0 items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="t-caps">
                  {canShowFileLocation ? "文件路径" : "存储位置"}
                </div>
                {canShowFileLocation ? (
                  <div
                    className="font-mono text-[11px] text-muted mt-0.5 truncate"
                    title={path ?? undefined}
                  >
                    {path ?? "—"}
                  </div>
                ) : (
                  <div className="text-[12px] text-muted mt-0.5">
                    {copy.resultStorage}
                  </div>
                )}
              </div>
              {canShowFileLocation && (
                <Button
                  variant="ghost"
                  size="iconSm"
                  icon="external"
                  className="shrink-0"
                  disabled={!path}
                  onClick={() => {
                    if (path) void openPath(path);
                  }}
                  title="用默认应用打开"
                  aria-label="用默认应用打开"
                />
              )}
            </div>
          </section>
        </div>
      </Drawer>
    </>
  );
}
