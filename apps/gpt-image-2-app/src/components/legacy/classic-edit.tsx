import {
  type DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  type MaskExport,
  type MaskMode,
} from "@/components/screens/edit/mask-canvas";
import {
  appendEditMetadata,
  appendNativeMaskPayload,
  appendReferenceImages,
  appendSoftRegionPayload,
} from "@/components/screens/edit/edit-submit-payload";
import {
  MAX_INPUT_IMAGES,
  regionModeLabel,
  type EditMode,
  type RefWithFile,
} from "@/components/screens/edit/shared";
import { useCreateEdit } from "@/hooks/use-jobs";
import { useJobEvents } from "@/hooks/use-job-events";
import {
  isTauriRuntime,
  useGlobalImagePaste,
  useTauriImageDrop,
} from "@/hooks/use-image-ingest";
import { isActiveJobStatus } from "@/lib/api/types";
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
  providerNames as readProviderNames,
} from "@/lib/providers";
import type { ServerConfig } from "@/lib/types";
import { ClassicEditCanvasPanel } from "./classic-edit-canvas-panel";
import { ClassicEditDropLayout } from "./classic-edit-drop-layout";
import { ClassicEditReferencePanel } from "./classic-edit-reference-panel";
import { ClassicEditSettingsPanel } from "./classic-edit-settings-panel";
import { useClassicEditOutputs } from "./use-classic-edit-outputs";
import { useClassicProviderSelection } from "./use-classic-provider-selection";

export function ClassicEditScreen({ config }: { config?: ServerConfig }) {
  const providerNames = useMemo(() => readProviderNames(config), [config]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const refsRef = useRef<RefWithFile[]>([]);
  const dragDepthRef = useRef(0);
  const [editMode, setEditMode] = useState<EditMode>("reference");
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState("");
  const [userSelectedProvider, setUserSelectedProvider] = useState(false);
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
  const [pendingOutputCount, setPendingOutputCount] = useState<number | null>(
    null,
  );
  const [runError, setRunError] = useState<string | null>(null);
  const [runNotice, setRunNotice] = useState<string | null>(null);
  const [isDraggingImages, setIsDraggingImages] = useState(false);

  useClassicProviderSelection({
    config,
    provider,
    setProvider,
    setUserSelectedProvider,
    userSelectedProvider,
  });

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
  const { outputs, resetSelectedOutput, selectedPath, setSelectedOutput } =
    useClassicEditOutputs({
      eventsLength: events.length,
      jobId,
      outputCount,
    });

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

  const addRef = (files: FileList | null, source: ImageFileSource = "picker") => {
    const result = normalizeImageFiles(files, { source });
    addRefFiles(result.files, source, result.ignored);
  };

  useGlobalImagePaste(addRefFiles);
  useTauriImageDrop(addRefFiles, setIsDraggingImages);

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (isTauriRuntime()) {
      event.preventDefault();
      return;
    }
    if (!dataTransferHasImage(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingImages(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (isTauriRuntime()) {
      event.preventDefault();
      return;
    }
    if (!dataTransferHasImage(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (isTauriRuntime()) {
      event.preventDefault();
      return;
    }
    if (!dataTransferHasImage(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingImages(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
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

  const resetRunState = () => {
    setRunError(null);
    setJobId(null);
    setOutputCount(0);
    resetSelectedOutput();
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
        appendNativeMaskPayload({ form, maskPayload, refs, targetRef });
      }
      if (usesSoftRegion) {
        appendSoftRegionPayload({ form, maskPayload, refs });
      }
    } else {
      appendReferenceImages(form, refs);
    }

    appendEditMetadata({
      editMode,
      editRegionMode,
      format,
      form,
      normalizedSize,
      prompt,
      provider,
      quality,
      requestedN,
      targetRef,
      usesRegion,
    });
    const modeText = usesRegion ? regionModeLabel(editRegionMode) : "多图参考";
    const toastId = toast.loading("正在提交任务", {
      description: `${modeText} · ${refs.length} 张图片 · ${provider}`,
    });
    setPendingOutputCount(plannedN);
    try {
      const res = await mutate.mutateAsync(form);
      const queued =
        res.queued ||
        Boolean(res.job && isActiveJobStatus(res.job.status));
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

  const submitDisabled =
    isSubmitting ||
    refs.length === 0 ||
    !provider ||
    !prompt.trim() ||
    Boolean(parameterError) ||
    regionUnavailable;

  return (
    <ClassicEditDropLayout
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <ClassicEditReferencePanel
        addRef={addRef}
        fileInputRef={fileInputRef}
        maskSnapshots={maskSnapshots}
        maxReferenceImages={maxReferenceImages}
        refs={refs}
        removeRef={removeRef}
        selectedRef={selectedRef}
        setSelectedRef={setSelectedRef}
        setTargetRefId={setTargetRefId}
        targetRef={targetRef}
        usesRegion={usesRegion}
      />

      <ClassicEditSettingsPanel
        brushSize={brushSize}
        displayN={displayN}
        editMode={editMode}
        editRegionMode={editRegionMode}
        format={format}
        handleRun={handleRun}
        isSubmitting={isSubmitting}
        maskMode={maskMode}
        n={n}
        outputCountValidation={outputCountValidation}
        prompt={prompt}
        provider={provider}
        providerNames={providerNames}
        quality={quality}
        regionUnavailable={regionUnavailable}
        runError={runError}
        runNotice={runNotice}
        setBrushSize={setBrushSize}
        setClearKey={setClearKey}
        setEditMode={setEditMode}
        setFormat={setFormat}
        setMaskMode={setMaskMode}
        setN={setN}
        setPrompt={setPrompt}
        setProvider={setProvider}
        setQuality={setQuality}
        setRunError={setRunError}
        setRunNotice={setRunNotice}
        setSize={setSize}
        setUserSelectedProvider={setUserSelectedProvider}
        size={size}
        sizeValidation={sizeValidation}
        submitDisabled={submitDisabled}
        supportsMultipleOutputs={supportsMultipleOutputs}
        usesRegion={usesRegion}
      />

      <ClassicEditCanvasPanel
        brushSize={brushSize}
        clearKey={clearKey}
        exportKey={exportKey}
        isDraggingImages={isDraggingImages}
        maskMode={maskMode}
        maskSnapshots={maskSnapshots}
        outputs={outputs}
        selectedPath={selectedPath}
        selectedRefObj={selectedRefObj}
        setMaskSnapshots={setMaskSnapshots}
        setSelectedOutput={setSelectedOutput}
        submit={(payload) => void submit(payload)}
        targetRef={targetRef}
        usesRegion={usesRegion}
      />
    </ClassicEditDropLayout>
  );
}
