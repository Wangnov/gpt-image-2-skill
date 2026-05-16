import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { ImageContextMenu } from "@/components/ui/image-context-menu";
import { openQuickLook } from "@/components/ui/quick-look";
import TiltedCard from "@/components/reactbits/components/TiltedCard";
import {
  copyText,
  openPath,
  revealPath,
  saveJobOutputImage,
} from "@/lib/user-actions";
import { useConfirm } from "@/hooks/use-confirm";
import { isDesktopRuntime, runtimeCopy } from "@/lib/runtime-copy";
import type { Job, JobEvent } from "@/lib/types";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import { api } from "@/lib/api";
import {
  jobOutputIndexes,
  jobOutputPath,
  jobOutputUrl,
} from "@/lib/job-outputs";
import { imageAssetFromOutput } from "@/lib/image-actions/asset";
import type { ImageAsset } from "@/lib/image-actions/types";
import { PlaceholderImage } from "@/components/screens/shared/placeholder-image";
import {
  generationSlots,
  jobCanShowRecoveryAction,
  jobRecoveryAction,
  outputLabel,
} from "./shared";

type Props = {
  job: Job | null;
  events?: JobEvent[];
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

function cacheBustedUrl(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}rehydrated=${Date.now()}`;
}

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

function slotStatusLabel(status: string) {
  if (status === "completed") return "已生成";
  if (status === "failed") return "失败";
  return "缺失";
}

function eventTypeLabel(type: string) {
  if (type === "job.queued") return "已排队";
  if (type === "job.running") return "开始执行";
  if (type === "job.output_ready") return "输出完成";
  if (type === "job.storage") return "上传结果";
  if (type === "job.partial_failed") return "部分失败";
  if (type === "job.failed") return "失败";
  if (type === "job.cancelled") return "已取消";
  if (type === "job.notifications") return "通知已发送";
  if (type === "job.completed") return "已完成";
  return type;
}

export function JobImageDetailDrawer({
  job,
  events = [],
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
  const [rehydratedUrls, setRehydratedUrls] = useState<Map<number, string>>(
    new Map(),
  );
  const [rehydrateAttempted, setRehydrateAttempted] = useState<Set<number>>(
    new Set(),
  );
  const copy = runtimeCopy();
  const canShowFileLocation = isDesktopRuntime();
  const recoveryOptions = {
    supportsLocalRecovery: api.canUsePersistentResultLibrary,
  };
  const recovery = job ? jobRecoveryAction(job, recoveryOptions) : null;

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
  const displayUrl = rehydratedUrls.get(activeOutputIndex) ?? url;
  const path = job ? jobOutputPath(job, activeOutputIndex) : null;

  useEffect(() => {
    setImageFailed(false);
  }, [displayUrl]);

  useEffect(() => {
    setThumbFailed(new Set());
    setRehydratedUrls(new Map());
    setRehydrateAttempted(new Set());
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
  const letter = outputCount > 0 ? outputLabel(activeOutputIndex) : "—";
  const slots = job ? generationSlots(job) : [];
  const receivedResponse =
    recoverabilityFromJob(job) === "recoverable.local_response_cached" ||
    slots.some((slot) => slot.raw_response_present);
  const timeline = events
    .slice()
    .sort((a, b) => a.seq - b.seq)
    .slice(-12);

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

  const outputUrlFor = (idx: number) =>
    rehydratedUrls.get(idx) ?? (job ? jobOutputUrl(job, idx) : null);

  const peerAssets: ImageAsset[] = job
    ? outputIndexes.map((idx) =>
        imageAssetFromOutput({
          jobId: job.id,
          outputIndex: idx,
          src: outputUrlFor(idx) ?? "",
          path: jobOutputPath(job, idx) ?? null,
          prompt: prompt || undefined,
          command: job.command,
          job,
        }),
      )
    : [];
  const activeAsset =
    peerAssets[activePosition] ??
    (job && displayUrl
      ? imageAssetFromOutput({
          jobId: job.id,
          outputIndex: activeOutputIndex,
          src: displayUrl,
          path: path ?? null,
          prompt: prompt || undefined,
          command: job.command,
          job,
        })
      : null);

  const recoverOutput = (targetOutputIndex: number, markFailed: () => void) => {
    if (!job || rehydrateAttempted.has(targetOutputIndex)) {
      markFailed();
      return;
    }
    setRehydrateAttempted((prev) => new Set(prev).add(targetOutputIndex));
    void api
      .ensureJobOutputCached(job.id, targetOutputIndex)
      .then((cachedPath) => {
        if (!cachedPath) {
          markFailed();
          return;
        }
        const cachedUrl = api.fileUrl(cachedPath);
        if (!cachedUrl) {
          markFailed();
          return;
        }
        setRehydratedUrls((prev) =>
          new Map(prev).set(targetOutputIndex, cacheBustedUrl(cachedUrl)),
        );
        setThumbFailed((prev) => {
          const next = new Set(prev);
          next.delete(targetOutputIndex);
          return next;
        });
        if (targetOutputIndex === activeOutputIndex) setImageFailed(false);
      })
      .catch(markFailed);
  };

  const recoverVisibleOutput = () => {
    recoverOutput(activeOutputIndex, () => setImageFailed(true));
  };

  const recoverThumbnailOutput = (targetOutputIndex: number) => {
    recoverOutput(targetOutputIndex, () =>
      setThumbFailed((prev) => new Set(prev).add(targetOutputIndex)),
    );
  };

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
              jobCanShowRecoveryAction(job, recoveryOptions) &&
              recovery && (
                <Tooltip text={recovery.title}>
                  <Button
                    variant="secondary"
                    size="iconSm"
                    icon="reload"
                    aria-label={recovery.label}
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
                        ? `这是包含 ${outputCount} 张图的任务，删除会移除本地任务记录和全部 ${outputCount} 张图；远端 Origin/Archive 不会被删除，且无法分别删除单张。`
                        : "这会删除本地任务记录和这张图；远端 Origin/Archive 不会被删除。桌面端本地文件会先移到回收站。";
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
                disabled={!job || (!path && !url)}
                onClick={() => {
                  if (job) void saveJobOutputImage(job.id, activeOutputIndex);
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
            {displayUrl && !imageFailed && activeAsset ? (
              <ImageContextMenu asset={activeAsset}>
                <button
                  type="button"
                  onClick={openZoom}
                  className="mx-auto block w-full max-w-[340px] cursor-zoom-in rounded-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-55)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--bg)]"
                  aria-label={`查看第 ${letter} 张大图`}
                >
                  <TiltedCard
                    imageSrc={displayUrl}
                    altText={`第 ${letter} 张`}
                    containerWidth="100%"
                    containerHeight={DETAIL_IMAGE_SIZE}
                    imageWidth={DETAIL_IMAGE_SIZE}
                    imageHeight={DETAIL_IMAGE_SIZE}
                    rotateAmplitude={8}
                    scaleOnHover={1.04}
                    showMobileWarning={false}
                    showTooltip={false}
                    onImageError={recoverVisibleOutput}
                  />
                </button>
              </ImageContextMenu>
            ) : (
              <div className="h-[340px] w-full overflow-hidden rounded-lg border border-[color:var(--w-08)] bg-[color:var(--w-02)]">
                <PlaceholderImage
                  seed={activeOutputIndex + 23}
                  variant={`detail-${job?.id ?? "empty"}`}
                  label={displayUrl && imageFailed ? "远端不可用" : undefined}
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
                const tUrl = outputUrlFor(outputIndex);
                const isActive = outputIndex === activeOutputIndex;
                const thumbAsset = peerAssets[i] ?? activeAsset;
                const label = outputLabel(outputIndex);
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
                    aria-label={`第 ${label} 张`}
                    title={`第 ${label} 张`}
                  >
                    {tUrl && !thumbFailed.has(outputIndex) ? (
                      <img
                        src={tUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover"
                        draggable={false}
                        onError={() => recoverThumbnailOutput(outputIndex)}
                      />
                    ) : (
                      <PlaceholderImage
                        seed={outputIndex + i + 19}
                        variant={`detail-thumb-${job.id}`}
                        label={
                          tUrl && thumbFailed.has(outputIndex)
                            ? "远端不可用"
                            : undefined
                        }
                      />
                    )}
                    <span
                      className="absolute bottom-0 left-0 right-0 h-3.5 flex items-center justify-center text-[8.5px] font-mono text-foreground"
                      style={{
                        background:
                          "linear-gradient(to top, var(--k-70), transparent)",
                      }}
                    >
                      {label}
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

          {(slots.length > 0 || recovery || timeline.length > 0) && (
            <section className="surface-panel p-4 space-y-3.5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="t-caps">恢复状态</div>
                  <div className="mt-1 text-[12px] text-muted">
                    响应完整接收：{receivedResponse ? "是" : "否 / 不确定"}
                  </div>
                </div>
                {recovery &&
                  job &&
                  jobCanShowRecoveryAction(job, recoveryOptions) && (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="reload"
                    title={recovery.title}
                    onClick={() => onRetry?.(job.id)}
                  >
                    {recovery.label}
                  </Button>
                )}
              </div>

              {slots.length > 0 && (
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  {slots.map((slot) => (
                    <div
                      key={slot.index}
                      className="rounded-md border border-[color:var(--w-08)] bg-[color:var(--w-03)] px-2.5 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] text-faint">
                          {outputLabel(slot.index)}
                        </span>
                        <span
                          className={cn(
                            "text-[11px] font-medium",
                            slot.status === "completed"
                              ? "text-[color:var(--status-ok-soft)]"
                              : "text-[color:var(--status-err)]",
                          )}
                        >
                          {slotStatusLabel(slot.status)}
                        </span>
                      </div>
                      <div className="mt-1 truncate text-[11px] text-muted">
                        {slot.error || slot.recoverability || "—"}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {timeline.length > 0 && (
                <div className="space-y-1.5">
                  <div className="t-caps">时间线</div>
                  <div className="space-y-1.5">
                    {timeline.map((event) => (
                      <div
                        key={`${event.seq}-${event.type}`}
                        className="flex min-w-0 items-center gap-2 text-[12px]"
                      >
                        <span className="w-8 shrink-0 font-mono text-[11px] text-faint">
                          #{event.seq}
                        </span>
                        <span className="shrink-0 text-foreground">
                          {eventTypeLabel(event.type)}
                        </span>
                        {typeof event.data?.status === "string" && (
                          <span className="truncate text-muted">
                            {event.data.status}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      </Drawer>
    </>
  );
}

function recoverabilityFromJob(job: Job | null) {
  return String(job?.metadata?.recoverability ?? "");
}
