import {
  type ClipboardEvent,
  type DragEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { Field } from "@/components/ui/field";
import { GlassCombobox } from "@/components/ui/combobox";
import { GlassSelect } from "@/components/ui/select";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { OutputTile } from "@/components/screens/shared/output-tile";
import {
  MaskCanvas,
  type MaskExport,
  type MaskMode,
} from "@/components/screens/edit/mask-canvas";
import { useCreateEdit } from "@/hooks/use-jobs";
import { useJobEvents } from "@/hooks/use-job-events";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  dataTransferHasImage,
  imageFilesFromDataTransfer,
  normalizeImageFiles,
  type ImageFileSource,
} from "@/lib/image-input";
import {
  errorMessage,
  outputCountDescription,
  outputCountMismatchMessage,
  responseOutputCount,
} from "@/lib/job-feedback";
import {
  normalizeOutputCount,
  OUTPUT_COUNT_OPTIONS,
  POPULAR_SIZE_OPTIONS,
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
import { openPath, saveImages } from "@/lib/user-actions";
import type { ProviderConfig, ServerConfig } from "@/lib/types";

type EditMode = "reference" | "region";
type RefWithFile = {
  id: string;
  name: string;
  url: string;
  file: File;
};
type EditRegionMode = NonNullable<ProviderConfig["edit_region_mode"]>;

const MAX_INPUT_IMAGES = 16;

const FORMAT_OPTIONS = [
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG" },
  { value: "webp", label: "WEBP" },
];

const COUNT_OPTIONS = OUTPUT_COUNT_OPTIONS.map((value) => ({
  value: String(value),
  label: String(value),
}));

function blobFile(blob: Blob, name: string) {
  return new File([blob], name, { type: "image/png" });
}

function regionModeLabel(mode: EditRegionMode) {
  if (mode === "native-mask") return "精确遮罩";
  if (mode === "reference-hint") return "软选区参考";
  return "不支持局部编辑";
}

function regionModeHint(mode: EditRegionMode) {
  if (mode === "native-mask") return "遮罩会精确作用在目标图上。";
  if (mode === "reference-hint")
    return "会额外发送一张选区标记图；用户上传图片顺序保持不变。";
  return "请切换到多图参考，或换一个支持局部编辑的凭证。";
}

function ReferenceTile({
  ref_,
  active,
  role,
  hasMask,
  onSelect,
  onSetTarget,
  onRemove,
}: {
  ref_: RefWithFile;
  active: boolean;
  role?: "target" | "reference";
  hasMask?: boolean;
  onSelect: () => void;
  onSetTarget?: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
        if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          onRemove();
        }
      }}
      className={cn(
        "group relative aspect-square cursor-pointer overflow-hidden rounded-lg border-[1.5px] bg-sunken focus-visible:outline-none",
        active
          ? "border-accent shadow-[0_0_0_3px_var(--accent-faint)]"
          : "border-border hover:border-border-strong",
      )}
    >
      <img
        src={ref_.url}
        alt=""
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover"
        draggable={false}
      />
      <div
        className="image-overlay absolute left-1.5 top-1.5 max-w-[calc(100%-56px)] truncate rounded px-1.5 py-0.5 font-mono text-[10px]"
        title={ref_.name}
      >
        {ref_.name}
      </div>
      {role && (
        <span
          className={cn(
            "absolute right-1.5 top-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold",
            role === "target" ? "" : "image-overlay-soft",
          )}
          style={
            role === "target"
              ? { background: "var(--accent)", color: "var(--accent-on)" }
              : undefined
          }
        >
          {role === "target" ? "目标" : "参考"}
        </span>
      )}
      {hasMask && (
        <span
          className="absolute right-1.5 top-7 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold"
          style={{ background: "var(--accent)", color: "var(--accent-on)" }}
        >
          <Icon name="mask" size={10} />
          遮罩
        </span>
      )}
      {onSetTarget && role !== "target" && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onSetTarget();
          }}
          className="image-overlay absolute bottom-1.5 left-1.5 rounded px-2 py-1 text-[11px] font-semibold opacity-0 transition-opacity group-hover:opacity-100"
        >
          设为目标
        </button>
      )}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
        className="image-overlay absolute bottom-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100"
        aria-label={`删除 ${ref_.name}`}
      >
        <Icon name="x" size={12} />
      </button>
    </div>
  );
}

export function ClassicEditScreen({ config }: { config?: ServerConfig }) {
  const providerNames = useMemo(() => readProviderNames(config), [config]);
  const defaultProvider = effectiveDefaultProvider(config);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const refsRef = useRef<RefWithFile[]>([]);
  const dragDepthRef = useRef(0);
  const [editMode, setEditMode] = useState<EditMode>("reference");
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState("");
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
  const [isDraggingImages, setIsDraggingImages] = useState(false);

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

  useEffect(() => {
    refsRef.current = refs;
  }, [refs]);

  useEffect(() => {
    return () => {
      refsRef.current.forEach((ref) => URL.revokeObjectURL(ref.url));
    };
  }, []);

  const { events, running } = useJobEvents(jobId);
  const mutate = useCreateEdit();
  const isSubmitting = exportKey != null || mutate.isPending;
  const isTracking = running;
  const isWorking = isSubmitting || isTracking;
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

  const addRefFiles = (
    imageFiles: File[],
    source: ImageFileSource,
    ignored = 0,
  ) => {
    if (ignored > 0) {
      toast.warning("已忽略非图片文件", {
        description: `跳过 ${ignored} 个不支持的文件。`,
      });
    }
    if (imageFiles.length === 0) {
      if (ignored > 0) {
        toast.error("没有可添加的图片", {
          description: "请拖入、粘贴或选择图片文件。",
        });
      }
      return;
    }

    const additions = imageFiles.map((file, index) => ({
      id: `r-${Date.now()}-${index}`,
      name: file.name,
      url: URL.createObjectURL(file),
      file,
    }));
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
      if (source === "drop") {
        toast.success(`已添加 ${accepted.length} 张参考图`, {
          description: "来自拖拽上传。",
        });
      }
      if (source === "paste") {
        toast.success(`已添加 ${accepted.length} 张参考图`, {
          description: "来自剪贴板。",
        });
      }
      setSelectedRef((current) => current ?? accepted[0].id);
      setTargetRefId((current) => current ?? accepted[0].id);
      return [...prev, ...accepted];
    });
  };

  const addRef = (files: FileList | null, source: ImageFileSource = "picker") => {
    const result = normalizeImageFiles(files, { source });
    addRefFiles(result.files, source, result.ignored);
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const result = imageFilesFromDataTransfer(event.clipboardData, "paste");
    if (result.files.length === 0 && result.ignored === 0) return;
    event.preventDefault();
    addRefFiles(result.files, "paste", result.ignored);
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!dataTransferHasImage(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingImages(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!dataTransferHasImage(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!dataTransferHasImage(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingImages(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!dataTransferHasImage(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingImages(false);
    const result = imageFilesFromDataTransfer(event.dataTransfer, "drop");
    addRefFiles(result.files, "drop", result.ignored);
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

  const resetRunState = () => {
    setRunError(null);
    setJobId(null);
    setOutputCount(0);
    setSelectedOutput(0);
    setRunNotice(null);
  };

  const handleRun = () => {
    if (!provider || refs.length === 0 || isSubmitting) return;
    if (!prompt.trim()) {
      toast.error("请输入编辑提示词");
      return;
    }
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
      setOutputCount(Math.max(1, count));
      setJobId(res.job_id);
      setRunNotice(queued ? null : outputCountMismatchMessage(count, plannedN));
      if (queued) {
        toast.success(plannedN > 1 ? `已开始编辑 ${plannedN} 张` : "已开始编辑", {
          id: toastId,
          description: `${modeText} · ${provider} · 完成后通知你`,
          duration: 4_000,
        });
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
      seed: index * 43 + outputRefreshKey,
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

  const submitDisabled =
    isSubmitting ||
    refs.length === 0 ||
    !provider ||
    !prompt.trim() ||
    Boolean(parameterError) ||
    regionUnavailable;

  return (
    <div
      className="edit-layout h-full"
      onPaste={handlePaste}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <section className="edit-refs surface-panel flex min-h-0 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-border-faint px-3 py-2.5">
          <div>
            <div className="t-h3">参考图</div>
            <div className="t-small">
              {refs.length}/{maxReferenceImages} · 可拖拽或粘贴
            </div>
          </div>
          <Button
            variant="ghost"
            size="iconSm"
            icon="plus"
            onClick={() => fileInputRef.current?.click()}
            disabled={refs.length >= maxReferenceImages}
            aria-label="添加参考图"
          />
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
        </header>

        <div className="min-h-0 flex-1 overflow-auto p-3">
          {refs.length === 0 ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-full min-h-[220px] w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong bg-[color:var(--w-02)] p-4 text-center text-muted hover:border-foreground/30 hover:text-foreground"
            >
              <Icon name="upload" size={22} />
              <span className="text-[13px] font-semibold">添加参考图</span>
              <span className="max-w-[220px] text-[11.5px]">
                拖进这里，或直接粘贴剪贴板图片。
              </span>
            </button>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {refs.map((ref) => (
                <ReferenceTile
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
                  hasMask={Boolean(maskSnapshots[ref.id])}
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
            </div>
          )}
        </div>
      </section>

      <section className="edit-settings surface-panel min-h-0 overflow-auto p-3">
        <div className="mb-3 flex items-center gap-2">
          <Segmented
            value={editMode}
            onChange={(mode) => {
              setEditMode(mode);
              setRunError(null);
              setRunNotice(null);
            }}
            size="sm"
            ariaLabel="编辑模式"
            options={[
              { value: "reference", label: "多图参考", icon: "image" },
              { value: "region", label: "局部编辑", icon: "mask" },
            ]}
          />
        </div>

        {runError && (
          <div
            role="alert"
            className="mb-3 rounded-md border px-3 py-2 text-[12px] leading-relaxed"
            style={{
              borderColor: "var(--status-err-30)",
              background: "var(--status-err-10)",
              color: "var(--status-err)",
            }}
          >
            {runError}
          </div>
        )}
        {runNotice && (
          <div className="mb-3 rounded-md border border-border bg-sunken px-3 py-2 text-[12px] text-muted">
            {runNotice}
          </div>
        )}

        <Field label="提示词">
          <Textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="描述如何编辑这些图片..."
            minHeight={96}
          />
        </Field>

        <Field label="凭证">
          <GlassSelect
            value={provider}
            onValueChange={setProvider}
            options={providerNames.map((name) => ({
              value: name,
              label: name,
            }))}
            disabled={providerNames.length === 0}
            placeholder="（无可用凭证）"
          />
        </Field>

        <Field label="尺寸" error={!sizeValidation.ok ? sizeValidation.message : undefined}>
          <GlassCombobox
            value={size}
            onValueChange={setSize}
            options={POPULAR_SIZE_OPTIONS}
            placeholder="auto / 1536x1024"
            invalid={!sizeValidation.ok}
          />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="质量">
            <GlassSelect
              value={quality}
              onValueChange={setQuality}
              options={QUALITY_OPTIONS}
            />
          </Field>
          <Field label="格式">
            <GlassSelect
              value={format}
              onValueChange={setFormat}
              options={FORMAT_OPTIONS}
            />
          </Field>
          <Field label="数量" error={!outputCountValidation.ok ? outputCountValidation.message : undefined}>
            <GlassCombobox
              value={String(n)}
              onValueChange={(value) => setN(Number(value) || 1)}
              options={COUNT_OPTIONS}
              disabled={!supportsMultipleOutputs}
              inputMode="numeric"
              placeholder="1-10"
            />
          </Field>
        </div>

        {usesRegion && (
          <div className="mb-3 rounded-md border border-border bg-sunken p-2.5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="t-caps">遮罩</div>
              <span className="text-[11px] text-faint">
                {regionModeLabel(editRegionMode)}
              </span>
            </div>
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
            <label className="mt-2 flex items-center gap-2 text-[11px] text-muted">
              <span className="shrink-0">笔刷</span>
              <input
                type="range"
                min={8}
                max={80}
                value={brushSize}
                onChange={(event) => setBrushSize(Number(event.target.value))}
                className="min-w-0 flex-1 accent-[color:var(--accent)]"
              />
              <span className="w-8 text-right font-mono">{brushSize}</span>
            </label>
            <div className="mt-2 text-[11px] leading-relaxed text-muted">
              {regionModeHint(editRegionMode)}
            </div>
            <Button
              variant="ghost"
              size="sm"
              icon="trash"
              onClick={() => setClearKey((key) => key + 1)}
              className="mt-2"
            >
              清除选区
            </Button>
          </div>
        )}

        <Button
          variant="primary"
          size="lg"
          icon={isSubmitting ? "reload" : "sparkle"}
          disabled={submitDisabled}
          onClick={handleRun}
          className="w-full justify-center"
        >
          {isSubmitting ? "提交中" : "应用编辑"}
        </Button>
        <div className="mt-2 text-[11px] text-faint">
          {supportsMultipleOutputs ? `计划输出 ${displayN} 张` : "当前凭证只输出 1 张"}
        </div>
      </section>

      <section className="edit-canvas surface-panel relative flex min-h-0 flex-col overflow-hidden">
        {isDraggingImages && (
          <div className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-lg border border-dashed border-[color:var(--accent)] bg-[color:var(--accent-10)] text-[13px] font-semibold text-foreground">
            松开即可添加参考图
          </div>
        )}
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
          {usesRegion && targetRef ? (
            <div className="w-full max-w-[780px]">
              <MaskCanvas
                imageUrl={targetRef.url}
                seed={11}
                brushSize={brushSize}
                mode={maskMode}
                snapshot={maskSnapshots[targetRef.id]}
                snapshotKey={targetRef.id}
                onSnapshotChange={(snapshot) => {
                  setMaskSnapshots((prev) => {
                    const next = { ...prev };
                    if (snapshot) next[targetRef.id] = snapshot;
                    else delete next[targetRef.id];
                    return next;
                  });
                }}
                exportKey={exportKey ?? undefined}
                onExport={(payload) => void submit(payload)}
                clearKey={clearKey}
              />
            </div>
          ) : selectedRefObj ? (
            <div className="max-h-full max-w-full overflow-hidden rounded-lg border border-border bg-sunken">
              <img
                src={selectedRefObj.url}
                alt=""
                className="max-h-[62vh] max-w-full object-contain"
                draggable={false}
              />
            </div>
          ) : (
            <Empty
              icon="image"
              title="等待参考图"
              subtitle="拖拽、粘贴或点击左侧按钮添加图片。"
            />
          )}
        </div>

        <div className="border-t border-border-faint p-3">
          {outputs.length > 0 ? (
            <div className="grid grid-cols-4 gap-2 xl:grid-cols-6">
              {outputs.map((output) => (
                <OutputTile
                  key={output.index}
                  output={output}
                  onSelect={() => setSelectedOutput(output.index)}
                  onDownload={() => saveImages([selectedPath], "图片")}
                  onOpen={
                    selectedPath ? () => void openPath(selectedPath) : undefined
                  }
                />
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[12px] text-faint">
              <Icon name="history" size={13} />
              输出会显示在这里，任务也会同步进入任务页。
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
