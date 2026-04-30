import {
  type DragEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  Image as ImageIcon,
  Loader2,
  Plus,
  Settings as SettingsIcon,
  Sparkles,
  Trash2,
} from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { GlassSelect } from "@/components/ui/select";
import { GlassCombobox } from "@/components/ui/combobox";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Icon } from "@/components/icon";
import { OutputTile } from "@/components/screens/shared/output-tile";
import { MaskCanvas, type MaskExport, type MaskMode } from "./mask-canvas";
import { ReferenceImageCard, type RefImage } from "./reference-card";
import { LocalEditOnboarding } from "./local-edit-onboarding";
import ElasticSlider from "@/components/reactbits/components/ElasticSlider";
import { providerKindLabel } from "@/lib/format";
import { useCreateEdit } from "@/hooks/use-jobs";
import { useJobEvents } from "@/hooks/use-job-events";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { api } from "@/lib/api";
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
import { openPath, revealPath, saveImages } from "@/lib/user-actions";
import {
  isTauriRuntime,
  useGlobalImagePaste,
  useTauriImageDrop,
} from "@/hooks/use-image-ingest";
import type { ProviderConfig, ServerConfig } from "@/lib/types";
import { cn } from "@/lib/cn";
import {
  dataTransferHasImage,
  imageFilesFromDataTransfer,
  normalizeImageFiles,
  type ImageFileSource,
} from "@/lib/image-input";

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

const FORMAT_OPTIONS = [
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG" },
  { value: "webp", label: "WEBP" },
];

const COUNT_OPTIONS = OUTPUT_COUNT_OPTIONS.map((n) => ({
  value: String(n),
  label: String(n),
}));

export function EditScreen({ config }: { config?: ServerConfig }) {
  const reducedMotion = useReducedMotion();
  const providerNames = useMemo(() => readProviderNames(config), [config]);
  const defaultProvider = effectiveDefaultProvider(config);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const refsRef = useRef<RefWithFile[]>([]);
  const dragDepthRef = useRef(0);
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
  const [isDraggingImages, setIsDraggingImages] = useState(false);
  const promptId = useId();
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

  const addRefFiles = useCallback(
    (imageFiles: File[], source: ImageFileSource, ignored = 0) => {
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
        additions
          .slice(available)
          .forEach((ref) => URL.revokeObjectURL(ref.url));
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
    },
    [maxReferenceImages],
  );

  const addRef = (
    files: FileList | null,
    source: ImageFileSource = "picker",
  ) => {
    const result = normalizeImageFiles(files, { source });
    addRefFiles(result.files, source, result.ignored);
  };

  useGlobalImagePaste(addRefFiles);
  useTauriImageDrop(addRefFiles, setIsDraggingImages);

  const handleCanvasDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (isTauriRuntime()) {
      event.preventDefault();
      return;
    }
    if (!dataTransferHasImage(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingImages(true);
  };

  const handleCanvasDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (isTauriRuntime()) {
      event.preventDefault();
      return;
    }
    if (!dataTransferHasImage(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleCanvasDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (isTauriRuntime()) {
      event.preventDefault();
      return;
    }
    if (!dataTransferHasImage(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingImages(false);
  };

  const handleCanvasDrop = (event: DragEvent<HTMLDivElement>) => {
    if (isTauriRuntime()) {
      event.preventDefault();
      return;
    }
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

  const submitDisabled =
    isSubmitting ||
    refs.length === 0 ||
    !provider ||
    Boolean(parameterError) ||
    regionUnavailable;

  return (
    <div className="relative h-full w-full overflow-hidden flex flex-col">
      <LocalEditOnboarding active={usesRegion} />
      {/* TOOLBAR — wraps when narrow, never clips */}
      <header className="shrink-0 px-4 pt-3 pb-2 flex items-center gap-2 flex-wrap">
        <Segmented
          value={editMode}
          onChange={(mode) => {
            setEditMode(mode);
            setRunError(null);
            setRunNotice(null);
          }}
          ariaLabel="编辑模式"
          size="sm"
          options={[
            { value: "reference", label: "多图参考", icon: "image" },
            { value: "region", label: "局部编辑", icon: "mask" },
          ]}
        />

        {/* Refs popover */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                "inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12px] transition-colors",
                "border bg-[color:var(--w-04)] hover:bg-[color:var(--w-07)]",
                referenceCountError
                  ? "border-[color:var(--status-err)] text-[color:var(--status-err)]"
                  : "border-border text-foreground",
              )}
            >
              <ImageIcon size={12} className="opacity-80" />
              <span>参考图</span>
              <span className="font-mono text-faint">
                {refs.length}/{maxReferenceImages}
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[380px]">
            <div className="flex items-center justify-between mb-2.5">
              <div className="text-[12px] font-semibold text-foreground">
                {usesRegion ? "目标图与参考图" : "参考图"}
              </div>
              <span
                className={cn(
                  "text-[10.5px] font-mono",
                  referenceCountError
                    ? "text-[color:var(--status-err)]"
                    : "text-faint",
                )}
              >
                {refs.length}/{maxReferenceImages}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
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
                onClick={() => fileInputRef.current?.click()}
                disabled={refs.length >= maxReferenceImages}
                className="touch-target flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border-[1.5px] border-dashed border-border-strong bg-[color:var(--w-02)] text-muted hover:border-foreground/30 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
              >
                <Plus size={16} />
                <span className="text-[10.5px]">添加</span>
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
              <div className="mt-3 rounded-md border border-border-faint bg-[color:var(--w-04)] px-2.5 py-1.5 text-[11px] leading-relaxed text-muted">
                遮罩只作用在标记为「目标图」的图片上；其他图片只作为风格、人物或物体参考。
              </div>
            )}
          </PopoverContent>
        </Popover>

        <div className="flex-1" />

        {provider && (
          <span
            className="hidden md:inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12px] text-foreground"
            style={{
              background: "var(--w-05)",
              border: "1px solid var(--w-10)",
            }}
            title={providerKindLabel(providerCfg?.type)}
          >
            <Icon name="cpu" size={12} style={{ color: "var(--accent)" }} />
            <span className="truncate max-w-[120px]">{provider}</span>
          </span>
        )}

        {/* Params popover */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12px] text-foreground transition-colors hover:bg-[color:var(--w-07)]"
              style={{
                background: "var(--w-05)",
                border: "1px solid var(--w-10)",
              }}
            >
              <SettingsIcon size={12} />
              参数
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-[340px] space-y-3">
            <div className="t-caps">编辑参数</div>

            <Field label="凭证">
              <GlassSelect
                value={provider}
                onValueChange={setProvider}
                options={providerNames.map((p) => ({ value: p, label: p }))}
                disabled={providerNames.length === 0}
                placeholder="（无可用凭证）"
              />
              <div className="mt-1 flex items-center gap-1.5 text-[11px] text-faint">
                <span
                  className="t-mono truncate max-w-[180px]"
                  title={providerCfg?.model ?? ""}
                >
                  {providerCfg?.model ?? "—"}
                </span>
                <span aria-hidden>·</span>
                <span className="truncate">
                  {providerKindLabel(providerCfg?.type)}
                </span>
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <Field
                label="尺寸"
                hint={!sizeValidation.ok ? sizeValidation.message : undefined}
              >
                <GlassCombobox
                  value={size}
                  onValueChange={setSize}
                  options={POPULAR_SIZE_OPTIONS}
                  placeholder="auto / 1536x1024"
                  invalid={!sizeValidation.ok}
                />
              </Field>
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
              <Field label="数量">
                <GlassCombobox
                  value={String(n)}
                  onValueChange={(v) => setN(Number(v) || 1)}
                  options={COUNT_OPTIONS}
                  disabled={!supportsMultipleOutputs}
                  inputMode="numeric"
                  placeholder="1-10"
                />
              </Field>
            </div>

            {usesRegion && (
              <>
                <div className="pt-2 mt-1 border-t border-[color:var(--w-06)]" />
                <div className="t-caps">遮罩工具</div>
                <div className="space-y-2">
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
                  <div className="flex items-center gap-2.5">
                    <label
                      id={`${brushSliderId}-label`}
                      className="text-[11px] text-muted shrink-0"
                    >
                      笔刷
                    </label>
                    <ElasticSlider
                      id={brushSliderId}
                      value={brushSize}
                      min={8}
                      max={80}
                      step={1}
                      onChange={setBrushSize}
                      ariaLabelledBy={`${brushSliderId}-label`}
                      className="min-w-0 flex-1"
                      valueWidthClassName="w-8"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setClearKey((k) => k + 1)}
                    className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-[11.5px] text-muted hover:text-foreground hover:bg-[color:var(--w-05)] transition-colors"
                  >
                    <Trash2 size={11} /> 清除选区
                  </button>
                </div>
                <div className="rounded-md border border-border-faint bg-[color:var(--w-04)] px-2.5 py-1.5 text-[11px] leading-relaxed text-muted">
                  {regionModeHint(editRegionMode)}
                </div>
              </>
            )}
          </PopoverContent>
        </Popover>

        <button
          type="button"
          onClick={handleRun}
          disabled={submitDisabled}
          className="inline-flex items-center justify-center gap-1.5 h-8 px-4 rounded-full text-[12px] font-semibold text-foreground transition-[background,opacity] hover:opacity-95 active:translate-y-[0.5px] disabled:opacity-45 disabled:cursor-not-allowed"
          style={{
            backgroundImage: "var(--accent-gradient-fill)",
            border: "1px solid var(--accent-50)",
            boxShadow: "var(--shadow-accent-glow)",
          }}
        >
          {isSubmitting ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Sparkles size={12} />
          )}
          {isSubmitting ? "提交中…" : isTracking ? "再提交" : "应用"}
        </button>
      </header>

      {/* CANVAS — full bleed, responsive */}
      <main className="flex-1 min-h-0 px-4 py-2 flex items-center justify-center overflow-hidden">
        <div
          className="surface-panel relative h-full w-full max-w-[min(70vh,820px)] overflow-hidden flex items-center justify-center p-4"
          onDragEnter={handleCanvasDragEnter}
          onDragOver={handleCanvasDragOver}
          onDragLeave={handleCanvasDragLeave}
          onDrop={handleCanvasDrop}
        >
          <motion.div
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-[inherit] border border-dashed",
              "bg-[color:var(--w-08)] backdrop-blur-md transition-[border-color,box-shadow] duration-200 ease-out",
              isDraggingImages
                ? "border-[color:var(--accent)] shadow-[0_0_0_1px_var(--accent-faint),var(--shadow-accent-glow)]"
                : "border-transparent",
            )}
            animate={
              reducedMotion
                ? { opacity: isDraggingImages ? 1 : 0 }
                : {
                    opacity: isDraggingImages ? 1 : 0,
                    scale: isDraggingImages ? 1 : 0.985,
                    y: isDraggingImages ? 0 : 2,
                  }
            }
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <motion.div
              className="flex flex-col items-center gap-2 rounded-xl border border-border-faint bg-[color:var(--w-08)] px-4 py-3 text-center shadow-popover"
              animate={
                reducedMotion
                  ? undefined
                  : { scale: isDraggingImages ? 1.02 : 1 }
              }
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              <ImageIcon size={20} style={{ color: "var(--accent)" }} />
              <div className="text-[13px] font-semibold text-foreground">
                松开添加参考图
              </div>
              <div className="text-[11px] text-muted">
                支持拖拽图片，也支持直接粘贴剪贴板图片
              </div>
            </motion.div>
          </motion.div>
          {usesRegion ? (
            targetRef ? (
              <div
                className="w-full max-h-full"
                style={{ maxWidth: "min(100%, calc(70vh - 64px))" }}
              >
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
              </div>
            ) : (
              <Empty
                icon="mask"
                title="请上传并设定目标图"
                subtitle="拖入图片、粘贴剪贴板图片，或点击上方「参考图」按钮添加。"
              />
            )
          ) : selectedRefObj || refs[0] ? (
            <img
              src={(selectedRefObj ?? refs[0]).url}
              alt={(selectedRefObj ?? refs[0]).name}
              className="max-h-full max-w-full object-contain rounded-md"
            />
          ) : (
            <Empty
              icon="image"
              title="请上传至少一张参考图"
              subtitle="拖入图片、粘贴剪贴板图片，或点击上方「参考图」按钮添加。"
            />
          )}
        </div>
      </main>

      {/* BOTTOM — prompt + outputs strip + error */}
      <footer className="shrink-0 px-4 pb-3 space-y-2">
        {runError && !isWorking && (
          <div className="surface-panel flex items-center gap-2 px-3 py-2 border border-[color:var(--status-err)]/40 animate-fade-up">
            <Icon
              name="warn"
              size={13}
              style={{ color: "var(--status-err)" }}
            />
            <span
              className="text-[12px] flex-1"
              style={{ color: "var(--status-err)" }}
            >
              {runError}
            </span>
            <Button variant="ghost" size="sm" icon="reload" onClick={handleRun}>
              重试
            </Button>
          </div>
        )}

        {runNotice && !isWorking && (
          <div className="surface-panel px-3 py-1.5 text-[11.5px] leading-relaxed text-muted animate-fade-up">
            {runNotice} 已保留收到的图片；如果需要补齐，可以点「应用」重试。
          </div>
        )}

        <div className="surface-panel p-2.5">
          <div className="flex items-center gap-2 mb-1.5">
            <FieldLabel htmlFor={promptId}>
              {usesRegion ? "目标图选区里要变成什么" : "提示词"}
            </FieldLabel>
            <div className="flex-1" />
            <span className="text-[10.5px] font-mono text-faint">
              {prompt.length} / 4000
            </span>
          </div>
          <Textarea
            id={promptId}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            minHeight={56}
            maxLength={4000}
            placeholder={
              usesRegion
                ? "描述目标图选区里要变成什么..."
                : "描述如何参考这些图片进行编辑..."
            }
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey))
                handleRun();
            }}
          />
        </div>

        {(isWorking || hasOutputs) && (
          <div className="surface-panel p-2.5">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[12px] font-semibold text-foreground">
                {isWorking
                  ? `生成中 · ${displayN} 张`
                  : `输出 · ${outputs.length} 张`}
              </span>
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
                      全部
                    </Button>
                  )}
                  {api.canRevealFiles && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="folder"
                      onClick={() => revealPath(selectedPath)}
                    >
                      位置
                    </Button>
                  )}
                </>
              )}
            </div>
            <div className="flex gap-2 overflow-x-auto scrollbar-none pb-1">
              {isWorking &&
                !hasOutputs &&
                Array.from({ length: displayN }).map((_, i) => (
                  <div
                    key={i}
                    className="shrink-0 animate-fade-up"
                    style={{ animationDelay: `${i * 65}ms` }}
                  >
                    <div
                      className="h-20 w-20 rounded-md border border-border bg-[color:var(--w-04)] flex items-center justify-center text-[10px] font-mono text-faint animate-shimmer"
                      style={{
                        background: "var(--skeleton-gradient-soft)",
                        backgroundSize: "200% 100%",
                      }}
                    >
                      {String.fromCharCode(65 + i)}
                    </div>
                  </div>
                ))}
              {hasOutputs &&
                outputs.map((output) => (
                  <div
                    key={output.index}
                    className="shrink-0 w-20 animate-fade-up"
                    style={{ animationDelay: `${output.index * 45}ms` }}
                  >
                    <OutputTile
                      output={output}
                      onSelect={() => setSelectedOutput(output.index)}
                      onDownload={() =>
                        saveImages(
                          [api.outputPath(jobId!, output.index)],
                          "图片",
                        )
                      }
                      onOpen={() =>
                        openPath(api.outputPath(jobId!, output.index))
                      }
                    />
                  </div>
                ))}
            </div>
          </div>
        )}
      </footer>
    </div>
  );
}
