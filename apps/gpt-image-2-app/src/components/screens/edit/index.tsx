import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Segmented } from "@/components/ui/segmented";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Icon } from "@/components/icon";
import { EventTimeline } from "@/components/screens/shared/event-timeline";
import { ImageSizeInput, OutputCountInput } from "@/components/screens/shared/image-parameter-inputs";
import { OutputTile } from "@/components/screens/shared/output-tile";
import { MaskCanvas, type MaskMode } from "./mask-canvas";
import { ReferenceImageCard, type RefImage } from "./reference-card";
import { providerKindLabel } from "@/lib/format";
import { useCreateEdit } from "@/hooks/use-jobs";
import { useJobEvents } from "@/hooks/use-job-events";
import { useTweaks } from "@/hooks/use-tweaks";
import { api } from "@/lib/api";
import { completedEvent, errorMessage, failedEvent, outputCountDescription, outputCountMismatchMessage, responseOutputCount, submittedEvent } from "@/lib/job-feedback";
import { BACKGROUND_OPTIONS, normalizeOutputCount, QUALITY_OPTIONS, validateImageSize, validateOutputCount } from "@/lib/image-options";
import { effectiveOutputCount, providerSupportsMultipleOutputs, requestOutputCount } from "@/lib/provider-capabilities";
import { effectiveDefaultProvider, providerNames as readProviderNames } from "@/lib/providers";
import type { JobEvent, ServerConfig } from "@/lib/types";

export function EditScreen({ config }: { config?: ServerConfig }) {
  const { tweaks } = useTweaks();
  const providerNames = useMemo(() => readProviderNames(config), [config]);
  const defaultProvider = effectiveDefaultProvider(config);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [prompt, setPrompt] = useState(
    "把背景换成黄昏海边，保留主体人物的面部和衣着细节。"
  );
  const [provider, setProvider] = useState<string>("");
  const [size, setSize] = useState("1024x1024");
  const [format, setFormat] = useState("png");
  const [quality, setQuality] = useState("auto");
  const [background, setBackground] = useState("auto");
  const [n, setN] = useState(4);
  const [refs, setRefs] = useState<(RefImage & { file: File })[]>([]);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [brushSize, setBrushSize] = useState(28);
  const [maskMode, setMaskMode] = useState<MaskMode>("paint");
  const [clearKey, setClearKey] = useState(0);
  const [exportKey, setExportKey] = useState<number | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [outputCount, setOutputCount] = useState(0);
  const [pendingOutputCount, setPendingOutputCount] = useState<number | null>(null);
  const [localEvents, setLocalEvents] = useState<JobEvent[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [runNotice, setRunNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedRef && refs.length > 0) setSelectedRef(refs[0].id);
  }, [refs, selectedRef]);

  useEffect(() => {
    if (providerNames.length > 0 && (!provider || !config?.providers[provider])) {
      setProvider(defaultProvider || providerNames[0]);
    }
  }, [config?.providers, defaultProvider, provider, providerNames]);

  const { events, running } = useJobEvents(jobId);
  const mutate = useCreateEdit();
  const isWorking = exportKey != null || mutate.isPending || running;
  const providerCfg = provider ? config?.providers[provider] : undefined;
  const supportsMultipleOutputs = providerSupportsMultipleOutputs(config, provider);
  const sizeValidation = validateImageSize(size);
  const outputCountValidation = validateOutputCount(n);
  const parameterError = sizeValidation.message ?? (supportsMultipleOutputs ? outputCountValidation.message : undefined);
  const safeN = normalizeOutputCount(n);
  const actualN = effectiveOutputCount(config, provider, safeN);
  const displayN = isWorking && pendingOutputCount != null ? pendingOutputCount : actualN;

  const addRef = (files: FileList | null) => {
    if (!files) return;
    const next = [...refs];
    Array.from(files).forEach((file, i) => {
      const id = `r-${Date.now()}-${i}`;
      next.push({ id, name: file.name, url: URL.createObjectURL(file), file });
    });
    setRefs(next);
  };

  const selectedRefObj = refs.find((r) => r.id === selectedRef);

  useEffect(() => {
    if (!supportsMultipleOutputs && n !== 1) {
      setN(1);
    }
  }, [n, supportsMultipleOutputs]);

  useEffect(() => {
    if (background === "transparent") {
      setBackground("auto");
    }
  }, [background]);

  const handleRun = () => {
    if (!provider || refs.length === 0 || isWorking) return;
    if (parameterError) {
      toast.error("参数无效", { description: parameterError });
      return;
    }
    setRunError(null);
    setJobId(null);
    setOutputCount(0);
    setRunNotice(null);
    setLocalEvents([submittedEvent("正在导出遮罩并准备上传参考图。")]);
    // We need to export the mask first (async via toBlob).
    setExportKey(Date.now());
  };

  // Kick off submission once the mask blob is ready.
  const submit = async (maskBlob: Blob | null) => {
    const form = new FormData();
    const normalizedSize = sizeValidation.normalized ?? size;
    const plannedN = effectiveOutputCount(config, provider, safeN);
    const requestedN = requestOutputCount(config, provider, safeN);
    const meta = { prompt, provider, size: normalizedSize, format, quality, background, n: requestedN };
    form.append("meta", JSON.stringify(meta));
    refs.forEach((r, i) => form.append(`ref_${String(i).padStart(2, "0")}`, r.file, r.name));
    if (maskBlob) form.append("mask", maskBlob, "mask.png");
    const toastId = toast.loading("正在编辑图像", {
      description: `${refs.length} 张参考图 · ${provider}`,
    });
    setPendingOutputCount(plannedN);
    try {
      const res = await mutate.mutateAsync(form);
      const count = responseOutputCount(res);
      setOutputCount(count);
      setJobId(res.job_id);
      setRunNotice(outputCountMismatchMessage(count, plannedN));
      setLocalEvents([completedEvent(res)]);
      toast.success("编辑完成", {
        id: toastId,
        description: outputCountDescription(count, plannedN),
      });
    } catch (error) {
      const message = errorMessage(error);
      setRunError(message);
      setLocalEvents([failedEvent(message)]);
      toast.error("编辑失败", { id: toastId, description: message });
    } finally {
      setPendingOutputCount(null);
      setExportKey(null);
    }
  };

  const outputs = useMemo(() => {
    if (!jobId || outputCount < 1) return [];
    return Array.from({ length: outputCount }).map((_, index) => ({
      index,
      url: api.outputUrl(jobId, index),
      selected: index === 0,
    }));
  }, [jobId, outputCount]);
  const timelineEvents = events.length > 0 ? events : localEvents;
  const hasOutputs = outputs.some((output) => output.url) || events.some((e) => e.type === "job.completed" || e.type === "output_saved");

  return (
    <div
      className="grid h-full grid-cols-[220px_minmax(260px,1fr)_260px] overflow-hidden xl:grid-cols-[248px_minmax(320px,1fr)_300px]"
    >
      <div className="flex flex-col border-r border-border bg-raised overflow-auto">
        <div className="p-4 border-b border-border-faint">
          <div className="flex items-center justify-between mb-2.5">
            <div className="t-h3">参考图</div>
            <span className="t-tiny font-mono">{refs.length}/6</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {refs.map((r) => (
              <ReferenceImageCard
                key={r.id}
                ref_={r}
                active={r.id === selectedRef}
                onSelect={() => setSelectedRef(r.id)}
                onRemove={() =>
                  setRefs((prev) => {
                    const next = prev.filter((x) => x.id !== r.id);
                    if (r.id === selectedRef) setSelectedRef(next[0]?.id ?? null);
                    return next;
                  })
                }
              />
            ))}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="aspect-square rounded-lg border-[1.5px] border-dashed border-border-strong bg-sunken flex flex-col items-center justify-center gap-1 text-muted"
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
              onChange={(e) => {
                addRef(e.target.files);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            />
          </div>
        </div>

        <div className="p-4 border-b border-border-faint">
          <FieldLabel hint={selectedRefObj ? "绘制遮罩" : "请先选择参考图"}>
            遮罩 · 将只替换遮罩区域
          </FieldLabel>
          <div className="flex items-center gap-1.5 mt-1.5 mb-2.5">
            <Segmented
              value={maskMode}
              onChange={setMaskMode}
              size="sm"
              options={[
                { value: "paint", label: "绘制", icon: "brush" },
                { value: "erase", label: "擦除", icon: "eraser" },
              ]}
            />
            <div className="flex-1" />
            <Button variant="ghost" size="sm" icon="trash" onClick={() => setClearKey((k) => k + 1)} title="清除遮罩" />
          </div>
          <div className="flex items-center gap-2 mb-1">
            <span className="t-tiny min-w-[28px]">笔刷</span>
            <input
              type="range"
              min={8}
              max={80}
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              className="flex-1"
              style={{ accentColor: "var(--accent)" }}
            />
            <span className="t-mono text-faint min-w-5 text-right">{brushSize}</span>
          </div>
        </div>

        <div className="p-4 flex-1">
          <FieldLabel
            hint={
              <span className="flex items-center gap-1">
                <span className="kbd">⌘</span>
                <span className="kbd">↵</span>
              </span>
            }
          >
            提示词
          </FieldLabel>
          <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} minHeight={120} placeholder="描述你希望的修改…" />
          <div className="flex items-center gap-1.5 mt-2 text-[11px] text-faint">
            <Icon name="info" size={11} />
            提示词越具体，遮罩区域保留越准确。
          </div>
        </div>
      </div>

      <div className="flex flex-col overflow-auto bg-background gridpaper">
        <div className="px-6 pt-5 pb-3 flex items-center gap-2.5">
          <Segmented
            value="mask"
            onChange={() => {}}
            options={[
              { value: "mask", label: "遮罩编辑器", icon: "mask" },
              { value: "compare", label: "对比原图", icon: "diff" },
            ]}
          />
          <div className="flex-1" />
          <span className="t-mono t-small">{selectedRefObj?.name ?? "—"}</span>
        </div>

        <div className="px-6 flex justify-center">
          <div style={{ width: "min(100%, clamp(280px, calc(100vh - 340px), 520px))" }}>
            {selectedRefObj ? (
              <MaskCanvas
                imageUrl={selectedRefObj.url}
                seed={0}
                brushSize={brushSize}
                mode={maskMode}
                clearKey={clearKey}
                exportKey={exportKey ?? undefined}
                onExport={(blob) => { submit(blob); }}
              />
            ) : (
              <div className="aspect-square rounded-[10px] border border-border bg-sunken flex items-center justify-center text-faint text-[12px]">
                请上传至少一张参考图
              </div>
            )}
          </div>
        </div>

        <div className="px-6 pt-5 pb-2 flex items-center gap-2.5">
          <div className="t-h3">输出 · {isWorking ? `请求 ${displayN} 个候选生成中` : hasOutputs ? `${outputs.length} 个候选` : "尚未生成"}</div>
          <div className="flex-1" />
          {hasOutputs && (
            <>
              <Button variant="ghost" size="sm" icon="download">保存已选</Button>
              <Button variant="ghost" size="sm" icon="reload">重新生成</Button>
            </>
          )}
        </div>

        <div className="px-6 pb-6">
          {runError && !isWorking ? (
            <Card padding={0} style={{ overflow: "hidden" }}>
              <Empty
                icon="warn"
                title="编辑失败"
                subtitle={runError}
                action={<Button variant="secondary" size="sm" icon="reload" onClick={handleRun}>重试</Button>}
              />
            </Card>
          ) : !hasOutputs && !isWorking ? (
            <Card padding={0} style={{ overflow: "hidden" }}>
              <Empty icon="image" title="还没有输出" subtitle="检查左侧参考图与遮罩，写好提示词，点击右侧「开始编辑」即可生成。" />
            </Card>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {isWorking && !hasOutputs &&
                Array.from({ length: displayN }).map((_, i) => (
                  <div
                    key={i}
                    className="aspect-square rounded-lg border border-border flex items-center justify-center text-faint font-mono text-[11px] animate-shimmer"
                    style={{
                      background: "linear-gradient(90deg, var(--bg-sunken) 0%, var(--bg-hover) 40%, var(--bg-sunken) 80%)",
                      backgroundSize: "200% 100%",
                    }}
                  >
                    生成中 · {String.fromCharCode(65 + i)}
                  </div>
                ))}
              {hasOutputs && outputs.map((o) => <OutputTile key={o.index} output={o} />)}
            </div>
          )}
          {runNotice && !isWorking && (
            <div className="mt-3 rounded-lg border border-[color:var(--warn-border,var(--border))] bg-sunken px-3 py-2 text-[12px] leading-relaxed text-muted">
              {runNotice} 后台如果显示生成了更多图片，说明兼容层没有把所有图片序列化回 OpenAI 响应。
            </div>
          )}
        </div>
      </div>

      <div className="border-l border-border bg-raised flex flex-col overflow-hidden">
        <div className="px-4 py-3.5 border-b border-border-faint">
          <Field label="服务商">
            <div className="flex items-center gap-1.5 px-2.5 h-9 bg-sunken border border-border rounded-md">
              <Icon name="cpu" size={14} style={{ color: "var(--accent)" }} />
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="flex-1 bg-transparent border-none outline-none text-[13px] font-medium"
              >
                {providerNames.length === 0 && <option value="">（无可用 provider）</option>}
                {providerNames.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              {provider === defaultProvider && <Badge tone="neutral" size="sm">默认</Badge>}
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted">
              <span className="t-mono">{providerCfg?.model ?? "—"}</span>
              <span>·</span>
              <span>{providerKindLabel(providerCfg?.type)}</span>
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-2.5">
            <div className="col-span-2">
              <Field label="尺寸" hint="auto 或 16 倍数自定义尺寸">
                <ImageSizeInput value={size} onChange={setSize} />
              </Field>
            </div>
            <Field label="质量">
              <Select value={quality} onChange={(e) => setQuality(e.target.value)} options={QUALITY_OPTIONS} />
            </Field>
            <Field label="格式">
              <Select value={format} onChange={(e) => setFormat(e.target.value)} options={["png", "jpeg", "webp"]} />
            </Field>
            <Field label="背景">
              <Select value={background} onChange={(e) => setBackground(e.target.value)} options={BACKGROUND_OPTIONS} />
            </Field>
          </div>

          <Field
            label="输出数量"
            hint={supportsMultipleOutputs ? "请求数量，实际以 provider 返回为准" : "此 provider 固定单张"}
          >
            {supportsMultipleOutputs ? (
              <OutputCountInput value={n} onChange={setN} />
            ) : (
              <div className="flex h-9 items-center justify-between rounded-md border border-border bg-sunken px-2.5 text-[12px]">
                <span className="font-semibold">1</span>
                <span className="text-faint">Codex 单张输出</span>
              </div>
            )}
          </Field>
        </div>

        <div className="px-4 py-3.5 border-b border-border-faint">
          <Button
            variant="primary"
            size="lg"
            icon="sparkle"
            onClick={handleRun}
            disabled={isWorking || refs.length === 0 || !provider || Boolean(parameterError)}
            kbd="⌘↵"
            className="w-full justify-center"
          >
            {isWorking ? "编辑中…" : "开始编辑"}
          </Button>
          <div className="flex justify-between mt-2 text-[11px] text-faint">
            <span>{refs.length} 张参考图</span>
            <span className="t-mono">{displayN}×{size.split("x")[0]}px</span>
          </div>
        </div>

        <div className="px-4 py-3.5 flex-1 overflow-auto flex flex-col">
          <div className="flex items-center gap-2 mb-2.5">
            <div className="t-h3">事件时间线</div>
            {isWorking && <Spinner size={12} />}
            <div className="flex-1" />
            {timelineEvents.length > 0 && <span className="t-tiny font-mono">{timelineEvents.length} 条</span>}
          </div>
          <EventTimeline events={timelineEvents} mode={tweaks.timeline} />
        </div>
      </div>
    </div>
  );
}
