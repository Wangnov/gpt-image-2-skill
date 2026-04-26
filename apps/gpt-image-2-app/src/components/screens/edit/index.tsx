import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/ui/tooltip";
import { Icon } from "@/components/icon";
import {
  ImageSizeInput,
  OutputCountInput,
} from "@/components/screens/shared/image-parameter-inputs";
import { OutputTile } from "@/components/screens/shared/output-tile";
import { MaskCanvas, type MaskExport, type MaskMode } from "./mask-canvas";
import { ReferenceImageCard, type RefImage } from "./reference-card";
import { providerKindLabel } from "@/lib/format";
import { useCreateEdit } from "@/hooks/use-jobs";
import { useJobEvents } from "@/hooks/use-job-events";
import { api } from "@/lib/api";
import {
  errorMessage,
  outputCountDescription,
  outputCountMismatchMessage,
  responseOutputCount,
} from "@/lib/job-feedback";
import {
  normalizeOutputCount,
  QUALITY_OPTIONS,
  validateImageSize,
  validateOutputCount,
} from "@/lib/image-options";
import {
  effectiveOutputCount,
  providerEditRegionMode,
  providerSupportsMultipleOutputs,
  requestOutputCount,
} from "@/lib/provider-capabilities";
import {
  effectiveDefaultProvider,
  providerNames as readProviderNames,
} from "@/lib/providers";
import { openPath, revealPath, saveImages } from "@/lib/user-actions";
import type { ProviderConfig, ServerConfig } from "@/lib/types";

type EditMode = "reference" | "region";
type RefWithFile = RefImage & { file: File };
type EditRegionMode = NonNullable<ProviderConfig["edit_region_mode"]>;
const MAX_INPUT_IMAGES = 16;

function blobFile(blob: Blob, name: string) {
  return new File([blob], name, { type: "image/png" });
}

function regionModeLabel(mode: EditRegionMode) {
  if (mode === "native-mask") return "精确遮罩";
  if (mode === "reference-hint") return "软选区参考";
  return "不支持局部编辑";
}

function regionModeHint(mode: EditRegionMode) {
  if (mode === "native-mask") return "遮罩会精确作用在目标图上";
  if (mode === "reference-hint")
    return "会额外发送一张选区标记图；用户上传图片顺序保持不变";
  return "请使用多图参考，或换一个支持局部编辑的凭证";
}

export function EditScreen({ config }: { config?: ServerConfig }) {
  const providerNames = useMemo(() => readProviderNames(config), [config]);
  const defaultProvider = effectiveDefaultProvider(config);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const refsRef = useRef<RefWithFile[]>([]);
  const [editMode, setEditMode] = useState<EditMode>("reference");
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState<string>("");
  const [size, setSize] = useState("1024x1024");
  const [format, setFormat] = useState("png");
  const [quality, setQuality] = useState("auto");
  const [n, setN] = useState(1);
  const [refs, setRefs] = useState<RefWithFile[]>([]);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [targetRefId, setTargetRefId] = useState<string | null>(null);
  const [maskSnapshots, setMaskSnapshots] = useState<Record<string, string>>(
    {},
  );
  const [brushSize, setBrushSize] = useState(28);
  const [maskMode, setMaskMode] = useState<MaskMode>("paint");
  const [clearKey, setClearKey] = useState(0);
  const [exportKey, setExportKey] = useState<number | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [outputCount, setOutputCount] = useState(0);
  const [selectedOutput, setSelectedOutput] = useState(0);
  const [pendingOutputCount, setPendingOutputCount] = useState<number | null>(
    null,
  );
  const [runError, setRunError] = useState<string | null>(null);
  const [runNotice, setRunNotice] = useState<string | null>(null);
  const promptId = useId();
  const providerSelectId = useId();
  const brushSliderId = useId();

  useEffect(() => {
    if (
      providerNames.length > 0 &&
      (!provider || !config?.providers[provider])
    ) {
      setProvider(defaultProvider || providerNames[0]);
    }
  }, [config?.providers, defaultProvider, provider, providerNames]);

  useEffect(() => {
    if (refs.length === 0) {
      setSelectedRef(null);
      setTargetRefId(null);
      return;
    }
    if (!selectedRef || !refs.some((ref) => ref.id === selectedRef)) {
      setSelectedRef(refs[0].id);
    }
    if (!targetRefId || !refs.some((ref) => ref.id === targetRefId)) {
      setTargetRefId(refs[0].id);
    }
  }, [refs, selectedRef, targetRefId]);

  const { events, running } = useJobEvents(jobId);
  const mutate = useCreateEdit();
  const isSubmitting = exportKey != null || mutate.isPending;
  const isTracking = running;
  const isWorking = isSubmitting || isTracking;
  const providerCfg = provider ? config?.providers[provider] : undefined;
  const supportsMultipleOutputs = providerSupportsMultipleOutputs(
    config,
    provider,
  );
  const editRegionMode = providerEditRegionMode(config, provider);
  const usesRegion = editMode === "region";
  const usesNativeMask = usesRegion && editRegionMode === "native-mask";
  const usesSoftRegion = usesRegion && editRegionMode === "reference-hint";
  const regionUnavailable = usesRegion && editRegionMode === "none";
  const maxReferenceImages = MAX_INPUT_IMAGES - (usesSoftRegion ? 1 : 0);
  const referenceCountError =
    refs.length > maxReferenceImages
      ? `最多上传 ${maxReferenceImages} 张参考图。`
      : undefined;
  const sizeValidation = validateImageSize(size);
  const outputCountValidation = validateOutputCount(n);
  const parameterError =
    referenceCountError ??
    sizeValidation.message ??
    (supportsMultipleOutputs ? outputCountValidation.message : undefined);
  const safeN = normalizeOutputCount(n);
  const actualN = effectiveOutputCount(config, provider, safeN);
  const displayN =
    isWorking && pendingOutputCount != null ? pendingOutputCount : actualN;
  const selectedRefObj = refs.find((ref) => ref.id === selectedRef);
  const targetRef = refs.find((ref) => ref.id === targetRefId) ?? refs[0];

  useEffect(() => {
    if (!supportsMultipleOutputs && n !== 1) {
      setN(1);
    }
  }, [n, supportsMultipleOutputs]);

  const addRef = (files: FileList | null) => {
    if (!files) return;
    const additions = Array.from(files).map((file, index) => ({
      id: `r-${Date.now()}-${index}`,
      name: file.name,
      url: URL.createObjectURL(file),
      file,
    }));
    if (additions.length === 0) return;
    setRefs((prev) => {
      const available = Math.max(0, maxReferenceImages - prev.length);
      if (available === 0) {
        additions.forEach((ref) => URL.revokeObjectURL(ref.url));
        toast.error("参考图已达上限", {
          description: `最多上传 ${maxReferenceImages} 张。`,
        });
        return prev;
      }
      const accepted = additions.slice(0, available);
      additions.slice(available).forEach((ref) => URL.revokeObjectURL(ref.url));
      if (accepted.length < additions.length) {
        toast.warning("已按上限添加参考图", {
          description: `最多上传 ${maxReferenceImages} 张。`,
        });
      }
      setSelectedRef((current) => current ?? accepted[0].id);
      setTargetRefId((current) => current ?? accepted[0].id);
      return [...prev, ...accepted];
    });
  };

  const removeRef = (id: string) => {
    setRefs((prev) => {
      const removed = prev.find((ref) => ref.id === id);
      if (removed) URL.revokeObjectURL(removed.url);
      const next = prev.filter((ref) => ref.id !== id);
      if (id === selectedRef) setSelectedRef(next[0]?.id ?? null);
      if (id === targetRefId) setTargetRefId(next[0]?.id ?? null);
      setMaskSnapshots((snapshots) => {
        const { [id]: _removed, ...rest } = snapshots;
        return rest;
      });
      return next;
    });
  };

  useEffect(() => {
    refsRef.current = refs;
  }, [refs]);

  useEffect(() => {
    return () => {
      refsRef.current.forEach((ref) => URL.revokeObjectURL(ref.url));
    };
  }, []);

  const resetRunState = () => {
    setRunError(null);
    setJobId(null);
    setOutputCount(0);
    setSelectedOutput(0);
    setRunNotice(null);
  };

  const handleRun = () => {
    if (!provider || refs.length === 0 || isSubmitting) return;
    if (parameterError) {
      toast.error("参数无效", { description: parameterError });
      return;
    }
    if (regionUnavailable) {
      toast.error("当前凭证不支持局部编辑", {
        description: "请切换到「多图参考」，或换一个支持局部编辑的凭证。",
      });
      return;
    }
    if (usesRegion && !targetRef) {
      toast.error("请先选择目标图", { description: "遮罩会作用在目标图上。" });
      return;
    }

    if (usesRegion) {
      resetRunState();
      setExportKey(Date.now());
      return;
    }

    resetRunState();
    void submit(null);
  };

  const submit = async (maskPayload: MaskExport | null) => {
    const form = new FormData();
    const normalizedSize = sizeValidation.normalized ?? size;
    const plannedN = effectiveOutputCount(config, provider, safeN);
    const requestedN = requestOutputCount(config, provider, safeN);
    const meta = {
      prompt,
      provider,
      size: normalizedSize,
      format,
      quality,
      n: requestedN,
      edit_mode: editMode,
      edit_region_mode: usesRegion ? editRegionMode : "none",
      target_name: usesRegion ? targetRef?.name : undefined,
    };

    if (usesRegion) {
      if (!maskPayload) {
        setExportKey(null);
        setRunError("遮罩导出失败，请重新涂抹一次。");
        toast.error("遮罩导出失败", { description: "请重新涂抹一次。" });
        return;
      }
      if (!maskPayload.hasSelection) {
        setExportKey(null);
        setRunError("请先涂抹要修改的区域。");
        toast.error("还没有选区", {
          description: "请在目标图上涂抹要修改的区域。",
        });
        return;
      }
      if (!targetRef) {
        setExportKey(null);
        return;
      }
      if (usesNativeMask) {
        form.append("ref_00", blobFile(maskPayload.targetImage, "target.png"));
        refs
          .filter((ref) => ref.id !== targetRef.id)
          .forEach((ref, index) => {
            form.append(
              `ref_${String(index + 1).padStart(2, "0")}`,
              ref.file,
              ref.name,
            );
          });
        form.append("mask", blobFile(maskPayload.nativeMask, "mask.png"));
      }
      if (usesSoftRegion) {
        refs.forEach((ref, index) => {
          form.append(
            `ref_${String(index).padStart(2, "0")}`,
            ref.file,
            ref.name,
          );
        });
        form.append(
          "selection_hint",
          blobFile(maskPayload.selectionHint, "selection-hint.png"),
        );
      }
    } else {
      refs.forEach((ref, index) => {
        form.append(
          `ref_${String(index).padStart(2, "0")}`,
          ref.file,
          ref.name,
        );
      });
    }

    form.append("meta", JSON.stringify(meta));
    const modeText = usesRegion ? regionModeLabel(editRegionMode) : "多图参考";
    const toastId = toast.loading("正在提交任务", {
      description: `${modeText} · ${refs.length} 张图片 · ${provider}`,
    });
    setPendingOutputCount(plannedN);
    try {
      const res = await mutate.mutateAsync(form);
      const queued =
        res.queued ||
        res.job?.status === "queued" ||
        res.job?.status === "running";
      const count = queued ? plannedN : responseOutputCount(res);
      setOutputCount(count);
      setJobId(res.job_id);
      setRunNotice(queued ? null : outputCountMismatchMessage(count, plannedN));
      if (queued) {
        toast.success(
          plannedN > 1 ? `已开始编辑 ${plannedN} 张` : "已开始编辑",
          {
            id: toastId,
            description: `${modeText} · ${provider} · 完成后通知你`,
            duration: 4_000,
          },
        );
      } else {
        toast.success("编辑完成", {
          id: toastId,
          description: outputCountDescription(count, plannedN),
        });
      }
    } catch (error) {
      const message = errorMessage(error);
      setRunError(message);
      toast.error("编辑失败", { id: toastId, description: message });
    } finally {
      setPendingOutputCount(null);
      setExportKey(null);
    }
  };

  const outputRefreshKey = events.length;
  const outputs = useMemo(() => {
    if (!jobId || outputCount < 1) return [];
    return Array.from({ length: outputCount }).map((_, index) => ({
      index,
      url: api.outputUrl(jobId, index),
      selected: index === selectedOutput,
    }));
  }, [jobId, outputCount, selectedOutput, outputRefreshKey]);
  const outputPaths = useMemo(() => {
    if (!jobId || outputCount < 1) return [];
    return Array.from({ length: outputCount })
      .map((_, index) => api.outputPath(jobId, index))
      .filter((path): path is string => Boolean(path));
  }, [jobId, outputCount, outputRefreshKey]);
  const selectedPath = jobId
    ? (api.outputPath(jobId, selectedOutput) ?? outputPaths[0])
    : undefined;
  const saveSelected = () => saveImages([selectedPath], "图片");
  const saveAll = () => saveImages(outputPaths, "图片");
  const hasOutputs =
    outputs.some((output) => output.url) || outputPaths.length > 0;
  const outputSubtitle = usesRegion
    ? "设为目标图并涂抹要修改的区域，再点击右侧开始。"
    : "上传一张或多张参考图，写清楚希望如何融合或改动。";

  return (
    <div className="edit-layout">
      <div className="edit-refs surface-panel flex flex-col overflow-auto">
        <div className="border-b border-border-faint p-4">
          <div className="mb-2.5 flex items-center justify-between">
            <div className="t-h3">
              {usesRegion ? "目标图与参考图" : "参考图"}
            </div>
            <span
              className={
                referenceCountError
                  ? "t-tiny font-mono text-status-err"
                  : "t-tiny font-mono"
              }
            >
              已上传 {refs.length}/{maxReferenceImages}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {refs.map((ref) => (
              <ReferenceImageCard
                key={ref.id}
                ref_={ref}
                active={ref.id === selectedRef}
                role={
                  usesRegion
                    ? ref.id === targetRef?.id
                      ? "target"
                      : "reference"
                    : undefined
                }
                onSelect={() => setSelectedRef(ref.id)}
                onSetTarget={
                  usesRegion
                    ? () => {
                        setTargetRefId(ref.id);
                        setSelectedRef(ref.id);
                      }
                    : undefined
                }
                onRemove={() => removeRef(ref.id)}
              />
            ))}
            <button
              type="button"
              onClick={() => {
                if (refs.length >= maxReferenceImages) return;
                fileInputRef.current?.click();
              }}
              disabled={refs.length >= maxReferenceImages}
              className="touch-target flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border-[1.5px] border-dashed border-border-strong bg-sunken text-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon name="plus" size={18} />
              <span className="text-[11px]">添加</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                addRef(event.target.files);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            />
          </div>
          {usesRegion && (
            <div className="mt-3 rounded-lg border border-border bg-sunken px-3 py-2 text-[11.5px] leading-relaxed text-muted">
              遮罩只作用在标记为「目标图」的图片上；其他图片只作为风格、人物或物体参考。
            </div>
          )}
        </div>

        {usesRegion ? (
          <div className="border-b border-border-faint p-4">
            <FieldLabel hint={targetRef ? "涂抹目标图" : "请先上传目标图"}>
              <span className="inline-flex items-center gap-1.5">
                局部选区
                <Tooltip text="拖动指针涂抹；键盘可用方向键移动，空格绘制，Delete 清除">
                  <button
                    type="button"
                    aria-label="查看局部选区操作提示"
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border bg-raised text-faint transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--accent)]"
                  >
                    <Icon name="info" size={11} aria-hidden="true" />
                  </button>
                </Tooltip>
              </span>
            </FieldLabel>
            <div className="mb-2.5 mt-1.5 flex items-center gap-1.5">
              <Segmented
                value={maskMode}
                onChange={setMaskMode}
                size="sm"
                ariaLabel="涂抹模式"
                options={[
                  { value: "paint", label: "绘制", icon: "brush" },
                  { value: "erase", label: "擦除", icon: "eraser" },
                ]}
              />
              <div className="flex-1" />
              <Button
                variant="ghost"
                size="sm"
                icon="trash"
                onClick={() => setClearKey((key) => key + 1)}
                title="清除选区"
                aria-label="清除选区"
              />
            </div>
            <div className="mb-1 flex items-center gap-2">
              <label htmlFor={brushSliderId} className="t-tiny min-w-[28px]">
                笔刷
              </label>
              <input
                id={brushSliderId}
                type="range"
                min={8}
                max={80}
                value={brushSize}
                onChange={(event) => setBrushSize(Number(event.target.value))}
                aria-valuemin={8}
                aria-valuemax={80}
                aria-valuenow={brushSize}
                aria-valuetext={`${brushSize} 像素`}
                className="flex-1"
                style={{ accentColor: "var(--accent)" }}
              />
              <span
                className="t-mono min-w-5 text-right text-faint"
                aria-hidden="true"
              >
                {brushSize}
              </span>
            </div>
            <div className="mt-2 rounded-lg border border-border bg-sunken px-3 py-2 text-[11.5px] leading-relaxed text-muted">
              {regionModeHint(editRegionMode)}
            </div>
          </div>
        ) : null}

        <div className="flex-1 p-4">
          <FieldLabel
            htmlFor={promptId}
            hint={
              <span className="flex items-center gap-1" aria-hidden="true">
                <span className="kbd">⌘</span>
                <span className="kbd">↵</span>
              </span>
            }
          >
            提示词
          </FieldLabel>
          <Textarea
            id={promptId}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            minHeight={120}
            maxLength={4000}
            placeholder={
              usesRegion
                ? "描述目标图选区里要变成什么..."
                : "描述如何参考这些图片进行编辑..."
            }
          />
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-faint">
            <Icon name="info" size={11} aria-hidden="true" />
            {usesRegion
              ? "越具体，选区外越容易保持稳定。"
              : "可以说明哪张图负责人物、风格、背景或物体。"}
          </div>
        </div>
      </div>

      <div className="edit-canvas surface-panel flex flex-col overflow-auto">
        <div className="flex items-center gap-2.5 px-6 pb-3 pt-5">
          <Segmented
            value={editMode}
            onChange={(mode) => {
              setEditMode(mode);
              setRunError(null);
              setRunNotice(null);
            }}
            ariaLabel="编辑模式"
            options={[
              { value: "reference", label: "多图参考", icon: "image" },
              { value: "region", label: "局部编辑", icon: "mask" },
            ]}
          />
          <div className="flex-1" />
          <span className="t-mono t-small">
            {usesRegion
              ? (targetRef?.name ?? "未选择目标图")
              : (selectedRefObj?.name ?? refs[0]?.name ?? "—")}
          </span>
        </div>

        <div className="flex justify-center px-6">
          <div
            style={{
              width: "min(100%, clamp(280px, calc(100vh - 340px), 520px))",
            }}
          >
            {usesRegion ? (
              targetRef ? (
                <MaskCanvas
                  imageUrl={targetRef.url}
                  seed={0}
                  brushSize={brushSize}
                  mode={maskMode}
                  clearKey={clearKey}
                  snapshot={maskSnapshots[targetRef.id]}
                  snapshotKey={targetRef.id}
                  onSnapshotChange={(snapshot) => {
                    setMaskSnapshots((current) => {
                      if (snapshot)
                        return { ...current, [targetRef.id]: snapshot };
                      const { [targetRef.id]: _removed, ...rest } = current;
                      return rest;
                    });
                  }}
                  exportKey={exportKey ?? undefined}
                  onExport={(payload) => {
                    void submit(payload);
                  }}
                />
              ) : (
                <div className="flex aspect-square items-center justify-center rounded-[10px] border border-border bg-sunken text-[12px] text-faint">
                  请上传并设定目标图
                </div>
              )
            ) : selectedRefObj || refs[0] ? (
              <div className="relative aspect-square overflow-hidden rounded-[10px] border border-border bg-sunken">
                <img
                  src={(selectedRefObj ?? refs[0]).url}
                  alt={(selectedRefObj ?? refs[0]).name}
                  className="h-full w-full object-contain"
                />
              </div>
            ) : (
              <div className="flex aspect-square items-center justify-center rounded-[10px] border border-border bg-sunken text-[12px] text-faint">
                请上传至少一张参考图
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 px-6 pb-2 pt-5">
          <div className="t-h3">
            {isWorking
              ? `输出 · 请求 ${displayN} 张`
              : hasOutputs
                ? `输出 · ${outputs.length} 张`
                : "输出 · 尚未生成"}
          </div>
          <div className="flex-1" />
          {hasOutputs && (
            <>
              <Button
                variant="ghost"
                size="sm"
                icon="download"
                onClick={saveSelected}
              >
                保存选中
              </Button>
              {outputs.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon="download"
                  onClick={saveAll}
                >
                  保存全部
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                icon="folder"
                onClick={() => revealPath(selectedPath)}
              >
                打开文件夹
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon="reload"
                onClick={handleRun}
              >
                重新生成
              </Button>
            </>
          )}
        </div>

        <div className="px-6 pb-6">
          {runError && !isWorking ? (
            <Empty
              icon="warn"
              title="编辑失败"
              subtitle={runError}
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  icon="reload"
                  onClick={handleRun}
                >
                  重试
                </Button>
              }
            />
          ) : !hasOutputs && !isWorking ? (
            <Empty icon="image" title="还没有输出" subtitle={outputSubtitle} />
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {isWorking &&
                !hasOutputs &&
                Array.from({ length: displayN }).map((_, index) => (
                  <div
                    key={index}
                    className="flex aspect-square items-center justify-center rounded-lg border border-border text-[11px] font-mono text-faint animate-shimmer"
                    style={{
                      background:
                        "linear-gradient(90deg, var(--bg-sunken) 0%, var(--bg-hover) 40%, var(--bg-sunken) 80%)",
                      backgroundSize: "200% 100%",
                    }}
                  >
                    生成中 · {String.fromCharCode(65 + index)}
                  </div>
                ))}
              {hasOutputs &&
                outputs.map((output) => (
                  <OutputTile
                    key={output.index}
                    output={output}
                    onSelect={() => setSelectedOutput(output.index)}
                    onDownload={() =>
                      saveImages([api.outputPath(jobId!, output.index)], "图片")
                    }
                    onOpen={() =>
                      openPath(api.outputPath(jobId!, output.index))
                    }
                  />
                ))}
            </div>
          )}
          {runNotice && !isWorking && (
            <div className="mt-3 rounded-lg border border-[color:var(--warn-border,var(--border))] bg-sunken px-3 py-2 text-[12px] leading-relaxed text-muted">
              {runNotice} 已保留收到的图片；如果需要补齐，可以点「重新生成」。
            </div>
          )}
        </div>
      </div>

      <div className="edit-settings surface-panel parameter-shelf">
        <div className="parameter-scroll px-4 py-3.5">
          <Field label="凭证" id={providerSelectId}>
            <div className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-sunken px-2.5 focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--accent-faint)] transition-colors">
              <Icon
                name="cpu"
                size={14}
                aria-hidden="true"
                style={{ color: "var(--accent)" }}
              />
              <select
                id={providerSelectId}
                value={provider}
                onChange={(event) => setProvider(event.target.value)}
                disabled={providerNames.length === 0}
                className="flex-1 border-none bg-transparent text-[13px] font-medium outline-none disabled:cursor-not-allowed disabled:opacity-60"
              >
                {providerNames.length === 0 && (
                  <option value="">（无可用凭证）</option>
                )}
                {providerNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              {provider === defaultProvider && (
                <Badge tone="neutral" size="sm">
                  默认
                </Badge>
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted">
              <span
                className="t-mono truncate max-w-[160px]"
                title={providerCfg?.model ?? ""}
              >
                {providerCfg?.model ?? "—"}
              </span>
              <span aria-hidden="true">·</span>
              <span className="truncate">
                {providerKindLabel(providerCfg?.type)}
              </span>
            </div>
          </Field>

          {usesRegion && (
            <div className="mb-3 rounded-lg border border-border bg-sunken px-3 py-2 text-[11.5px] leading-relaxed text-muted">
              <div className="font-semibold text-foreground">
                {regionModeLabel(editRegionMode)}
              </div>
              <div>{regionModeHint(editRegionMode)}</div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2.5">
            <div className="col-span-2">
              <Field label="尺寸" hint="auto 或 16 倍数自定义尺寸">
                <ImageSizeInput value={size} onChange={setSize} />
              </Field>
            </div>
            <Field label="质量">
              <Select
                value={quality}
                onValueChange={setQuality}
                options={QUALITY_OPTIONS}
              />
            </Field>
            <Field label="格式">
              <Select
                value={format}
                onValueChange={setFormat}
                options={["png", "jpeg", "webp"]}
              />
            </Field>
          </div>

          <Field
            label="输出数量"
            hint={
              supportsMultipleOutputs
                ? "可以一次生成多张候选"
                : "这个服务一次只返回一张"
            }
          >
            {supportsMultipleOutputs ? (
              <OutputCountInput value={n} onChange={setN} />
            ) : (
              <div className="flex h-9 items-center justify-between rounded-md border border-border bg-sunken px-2.5 text-[12px]">
                <span className="font-semibold">1</span>
                <span className="text-faint">会自动单张生成</span>
              </div>
            )}
          </Field>
        </div>

        <div className="parameter-actions px-4 py-3.5">
          <Button
            variant="primary"
            size="lg"
            icon="sparkle"
            onClick={handleRun}
            disabled={
              isSubmitting ||
              refs.length === 0 ||
              !provider ||
              Boolean(parameterError) ||
              regionUnavailable
            }
            kbd="⌘↵"
            className="w-full justify-center"
          >
            {isSubmitting
              ? "提交中..."
              : isTracking
                ? usesRegion
                  ? "再提交局部编辑"
                  : "再提交参考编辑"
                : usesRegion
                  ? "开始局部编辑"
                  : "开始参考编辑"}
          </Button>
          <div className="mt-2 flex justify-between text-[11px] text-faint">
            <span>
              {usesRegion
                ? `目标图 + ${Math.max(0, refs.length - 1)} 张参考`
                : `${refs.length} 张参考图`}
            </span>
            <span className="t-mono">{displayN} 张</span>
          </div>
        </div>
      </div>
    </div>
  );
}
