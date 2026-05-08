import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { type MaskExport } from "./mask-canvas";
import { EditCanvasStage } from "./edit-canvas-stage";
import { EditFileInput } from "./edit-file-input";
import { EditFooter } from "./edit-footer";
import { EditModeHeader } from "./edit-mode-header";
import {
  appendEditMetadata,
  appendNativeMaskPayload,
  appendReferenceImages,
  appendSoftRegionPayload,
} from "./edit-submit-payload";
import { LocalEditOnboarding } from "./local-edit-onboarding";
import { ReferenceStrip } from "./reference-strip";
import {
  clampZoom,
  regionModeLabel,
  type EditMode,
  type RefWithFile,
} from "./shared";
import { useMaskWorkspace } from "./use-mask-workspace";
import { useEditCapabilities } from "./use-edit-capabilities";
import { useEditDraft } from "./use-edit-draft";
import { useEditOutputs } from "./use-edit-outputs";
import { useReferenceImages } from "./use-reference-images";
import { useCreateEdit } from "@/hooks/use-jobs";
import { useJobEvents } from "@/hooks/use-job-events";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useTweaks } from "@/hooks/use-tweaks";
import { isActiveJobStatus } from "@/lib/api/types";
import {
  errorMessage,
  outputCountDescription,
  outputCountMismatchMessage,
  responseOutputCount,
} from "@/lib/job-feedback";
import { effectiveOutputCount, requestOutputCount } from "@/lib/provider-capabilities";
import {
  providerNames as readProviderNames,
  reconcileProviderSelection,
} from "@/lib/providers";
import { insertPromptAtCursor } from "@/lib/prompt-templates";
import type { ServerConfig } from "@/lib/types";

export function EditScreen({
  config,
  active = true,
}: {
  config?: ServerConfig;
  active?: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const { tweaks } = useTweaks();
  const providerNames = useMemo(() => readProviderNames(config), [config]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
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
  const [exportKey, setExportKey] = useState<number | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [outputCount, setOutputCount] = useState(0);
  const [pendingOutputCount, setPendingOutputCount] = useState<number | null>(
    null,
  );
  const [runError, setRunError] = useState<string | null>(null);
  const [runNotice, setRunNotice] = useState<string | null>(null);
  const [isDraggingImages, setIsDraggingImages] = useState(false);
  const promptId = useId();
  const insertPromptTemplate = useCallback(
    (text: string) => {
      const textarea = promptTextareaRef.current;
      const result = insertPromptAtCursor(
        prompt,
        text,
        textarea?.selectionStart,
        textarea?.selectionEnd,
      );
      setPrompt(result.value);
      window.requestAnimationFrame(() => {
        textarea?.focus();
        textarea?.setSelectionRange(result.cursor, result.cursor);
      });
    },
    [prompt],
  );

  useEffect(() => {
    const nextProvider = reconcileProviderSelection(config, provider);
    if (provider !== nextProvider) setProvider(nextProvider);
  }, [config, provider]);

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
  const {
    actualN,
    editRegionMode,
    maxReferenceImages,
    outputCountValidation,
    parameterError,
    referenceCountError,
    regionUnavailable,
    safeN,
    sizeValidation,
    submitDisabled,
    supportsMultipleOutputs,
    usesNativeMask,
    usesRegion,
    usesSoftRegion,
  } = useEditCapabilities({
    config,
    editMode,
    isSubmitting,
    n,
    provider,
    refsLength: refs.length,
    size,
  });
  const displayN =
    isWorking && pendingOutputCount != null ? pendingOutputCount : actualN;
  const selectedRefObj = refs.find((ref) => ref.id === selectedRef);
  const targetRef = refs.find((ref) => ref.id === targetRefId) ?? refs[0];
  const {
    brushSize,
    canvasViewportRef,
    clearKey,
    fitCanvasToViewport,
    handleMaskImageSize,
    maskHistory,
    maskMode,
    maskTool,
    maskToolbarHostRef,
    maskToolbarRef,
    maskToolbarScale,
    panMode,
    panPinned,
    redoKey,
    setBrushSize,
    setClearKey,
    setMaskHistory,
    setMaskTool,
    setPanPinned,
    setZoom,
    triggerMaskRedo,
    triggerMaskUndo,
    undoKey,
    zoom,
  } = useMaskWorkspace({
    active,
    targetRefId: targetRef?.id,
    usesRegion,
  });

  useEffect(() => {
    if (!supportsMultipleOutputs && n !== 1) {
      setN(1);
    }
  }, [n, supportsMultipleOutputs]);

  useEditDraft({
    brushSize,
    editMode,
    format,
    maskMode,
    maskTool,
    maskSnapshots,
    n,
    persist: tweaks.persistCreativeDrafts,
    prompt,
    provider,
    quality,
    refs,
    selectedRef,
    setBrushSize,
    setEditMode,
    setFormat,
    setMaskSnapshots,
    setMaskTool,
    setN,
    setPrompt,
    setProvider,
    setQuality,
    setRefs,
    setSelectedRef,
    setSize,
    setTargetRefId,
    size,
    targetRefId,
  });

  const {
    addRef,
    handleCanvasDragEnter,
    handleCanvasDragOver,
    handleCanvasDragLeave,
    handleCanvasDrop,
    removeRef,
  } = useReferenceImages({
    refs,
    setRefs,
    refsRef,
    dragDepthRef,
    maxReferenceImages,
    selectedRef,
    setSelectedRef,
    targetRefId,
    setTargetRefId,
    setPrompt,
    setMaskSnapshots,
    setIsDraggingImages,
  });

  const resetRunState = () => {
    setRunError(null);
    setJobId(null);
    setOutputCount(0);
    resetSelectedOutput();
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

  const {
    copy,
    hasOutputs,
    outputs,
    outputsDrawerOpen,
    saveAll,
    saveSelected,
    selectedPath,
    resetSelectedOutput,
    setOutputsDrawerOpen,
    setSelectedOutput,
    showOutputsLauncher,
  } = useEditOutputs({
    eventsLength: events.length,
    isWorking,
    jobId,
    outputCount,
  });

  return (
    <div className="relative h-full w-full overflow-hidden flex flex-col">
      <LocalEditOnboarding active={usesRegion} />
      <EditModeHeader
        editMode={editMode}
        onChange={(mode) => {
            setEditMode(mode);
            setRunError(null);
            setRunNotice(null);
        }}
      />

      <EditFileInput addRef={addRef} fileInputRef={fileInputRef} />

      <ReferenceStrip
        refs={refs}
        selectedRef={selectedRef}
        setSelectedRef={setSelectedRef}
        targetRefId={targetRefId}
        setTargetRefId={setTargetRefId}
        targetRef={targetRef}
        usesRegion={usesRegion}
        maskSnapshots={maskSnapshots}
        maxReferenceImages={maxReferenceImages}
        referenceCountError={referenceCountError}
        fileInputRef={fileInputRef}
        removeRef={removeRef}
        reducedMotion={reducedMotion}
      />

      <EditCanvasStage
        usesRegion={usesRegion}
        targetRef={targetRef}
        selectedRefObj={selectedRefObj}
        refs={refs}
        fileInputRef={fileInputRef}
        isDraggingImages={isDraggingImages}
        reducedMotion={reducedMotion}
        onDragEnter={handleCanvasDragEnter}
        onDragOver={handleCanvasDragOver}
        onDragLeave={handleCanvasDragLeave}
        onDrop={handleCanvasDrop}
        maskToolbarHostRef={maskToolbarHostRef}
        maskToolbarRef={maskToolbarRef}
        maskToolbarScale={maskToolbarScale}
        maskTool={maskTool}
        setMaskTool={setMaskTool}
        brushSize={brushSize}
        setBrushSize={setBrushSize}
        maskHistory={maskHistory}
        onMaskHistoryChange={setMaskHistory}
        triggerMaskUndo={triggerMaskUndo}
        triggerMaskRedo={triggerMaskRedo}
        setClearKey={setClearKey}
        fitCanvasToViewport={fitCanvasToViewport}
        zoom={zoom}
        setZoom={setZoom}
        panPinned={panPinned}
        setPanPinned={setPanPinned}
        canvasViewportRef={canvasViewportRef}
        maskMode={maskMode}
        clearKey={clearKey}
        undoKey={undoKey}
        redoKey={redoKey}
        maskSnapshots={maskSnapshots}
        setMaskSnapshots={setMaskSnapshots}
        exportKey={exportKey}
        onExport={(payload) => {
          void submit(payload);
        }}
        panMode={panMode}
        handleMaskImageSize={handleMaskImageSize}
      />

      <EditFooter
        runError={runError}
        runNotice={runNotice}
        isWorking={isWorking}
        handleRun={handleRun}
        showOutputsLauncher={showOutputsLauncher}
        outputsDrawerOpen={outputsDrawerOpen}
        setOutputsDrawerOpen={setOutputsDrawerOpen}
        displayN={displayN}
        outputs={outputs}
        hasOutputs={hasOutputs}
        copy={copy}
        saveSelected={saveSelected}
        saveAll={saveAll}
        selectedPath={selectedPath}
        jobId={jobId}
        prompt={prompt}
        setSelectedOutput={setSelectedOutput}
        promptId={promptId}
        usesRegion={usesRegion}
        insertPromptTemplate={insertPromptTemplate}
        promptTextareaRef={promptTextareaRef}
        setPrompt={setPrompt}
        size={size}
        setSize={setSize}
        sizeValidation={sizeValidation}
        quality={quality}
        setQuality={setQuality}
        format={format}
        setFormat={setFormat}
        n={n}
        setN={setN}
        supportsMultipleOutputs={supportsMultipleOutputs}
        outputCountValidation={outputCountValidation}
        submitDisabled={submitDisabled}
        isSubmitting={isSubmitting}
        isTracking={isTracking}
      />
    </div>
  );
}
