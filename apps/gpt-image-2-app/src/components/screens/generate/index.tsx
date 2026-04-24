import { useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/empty";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Icon } from "@/components/icon";
import { EventTimeline } from "@/components/screens/shared/event-timeline";
import {
  ImageSizeInput,
  OutputCountInput,
} from "@/components/screens/shared/image-parameter-inputs";
import { OutputTile } from "@/components/screens/shared/output-tile";
import { providerKindLabel } from "@/lib/format";
import { useCreateGenerate } from "@/hooks/use-jobs";
import { useJobEvents } from "@/hooks/use-job-events";
import { useTweaks } from "@/hooks/use-tweaks";
import { api } from "@/lib/api";
import {
  completedEvent,
  errorMessage,
  failedEvent,
  outputCountDescription,
  outputCountMismatchMessage,
  responseOutputCount,
  submittedEvent,
} from "@/lib/job-feedback";
import {
  BACKGROUND_OPTIONS,
  normalizeOutputCount,
  QUALITY_OPTIONS,
  validateImageSize,
  validateOutputCount,
} from "@/lib/image-options";
import {
  effectiveOutputCount,
  providerSupportsMultipleOutputs,
  requestOutputCount,
} from "@/lib/provider-capabilities";
import {
  effectiveDefaultProvider,
  providerNames as readProviderNames,
} from "@/lib/providers";
import { copyText, openPath, revealPath, saveImages } from "@/lib/user-actions";
import type { JobEvent, ServerConfig } from "@/lib/types";

const PRESETS = [
  "等距透视的 3D 小房子, 柔和阴影",
  "胶片质感的街头人像, 35mm, 黄昏光线",
  "产品摄影: 亚光陶瓷杯, 纯白背景",
  "水墨写意山水, 留白, 竖幅",
];

export function GenerateScreen({
  config,
  onOpenEdit,
}: {
  config?: ServerConfig;
  onOpenEdit?: () => void;
}) {
  const { tweaks } = useTweaks();
  const providerNames = useMemo(() => readProviderNames(config), [config]);
  const defaultProvider = effectiveDefaultProvider(config);
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState<string>("");
  const [size, setSize] = useState("1024x1024");
  const [format, setFormat] = useState("png");
  const [quality, setQuality] = useState("auto");
  const [background, setBackground] = useState("auto");
  const [n, setN] = useState(1);
  const [jobId, setJobId] = useState<string | null>(null);
  const [outputCount, setOutputCount] = useState(0);
  const [selectedOutput, setSelectedOutput] = useState(0);
  const [pendingOutputCount, setPendingOutputCount] = useState<number | null>(
    null,
  );
  const [localEvents, setLocalEvents] = useState<JobEvent[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [runNotice, setRunNotice] = useState<string | null>(null);
  const promptId = useId();
  const providerSelectId = useId();

  const { events, running } = useJobEvents(jobId);
  const mutate = useCreateGenerate();
  const isWorking = mutate.isPending || running;
  const providerCfg = provider ? config?.providers[provider] : undefined;
  const supportsMultipleOutputs = providerSupportsMultipleOutputs(
    config,
    provider,
  );
  const sizeValidation = validateImageSize(size);
  const outputCountValidation = validateOutputCount(n);
  const parameterError =
    sizeValidation.message ??
    (supportsMultipleOutputs ? outputCountValidation.message : undefined);
  const safeN = normalizeOutputCount(n);
  const actualN = effectiveOutputCount(config, provider, safeN);
  const displayN =
    isWorking && pendingOutputCount != null ? pendingOutputCount : actualN;

  useEffect(() => {
    if (
      providerNames.length > 0 &&
      (!provider || !config?.providers[provider])
    ) {
      setProvider(defaultProvider || providerNames[0]);
    }
  }, [config?.providers, defaultProvider, provider, providerNames]);

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

  const handleRun = async () => {
    if (!provider || isWorking) return;
    if (parameterError) {
      toast.error("参数无效", { description: parameterError });
      return;
    }
    const normalizedSize = sizeValidation.normalized ?? size;
    const plannedN = effectiveOutputCount(config, provider, safeN);
    const requestedN = requestOutputCount(config, provider, safeN);
    const toastId = toast.loading("正在生成图像", {
      description: `${provider} · ${normalizedSize} · ${quality}`,
    });
    setRunError(null);
    setJobId(null);
    setOutputCount(0);
    setSelectedOutput(0);
    setRunNotice(null);
    setPendingOutputCount(plannedN);
    setLocalEvents([submittedEvent(`已开始生成 ${plannedN} 张候选图。`)]);
    try {
      const res = await mutate.mutateAsync({
        prompt,
        provider,
        size: normalizedSize,
        format,
        quality,
        background,
        n: requestedN,
        metadata: {
          size: normalizedSize,
          format,
          quality,
          background,
          n: plannedN,
        },
      });
      const count = responseOutputCount(res);
      setOutputCount(count);
      setJobId(res.job_id);
      setRunNotice(outputCountMismatchMessage(count, plannedN));
      setLocalEvents([completedEvent(res)]);
      toast.success("生成完成", {
        id: toastId,
        description: outputCountDescription(count, plannedN),
      });
    } catch (error) {
      const message = errorMessage(error);
      setRunError(message);
      setLocalEvents([failedEvent(message)]);
      toast.error("生成失败", { id: toastId, description: message });
    } finally {
      setPendingOutputCount(null);
    }
  };

  const outputs = useMemo(() => {
    if (!jobId || outputCount < 1) return [];
    return Array.from({ length: outputCount }).map((_, index) => ({
      index,
      url: api.outputUrl(jobId, index),
      selected: index === selectedOutput,
    }));
  }, [jobId, outputCount, selectedOutput]);

  const outputPaths = useMemo(() => {
    if (!jobId || outputCount < 1) return [];
    return Array.from({ length: outputCount })
      .map((_, index) => api.outputPath(jobId, index))
      .filter((path): path is string => Boolean(path));
  }, [jobId, outputCount]);
  const selectedPath = jobId
    ? (api.outputPath(jobId, selectedOutput) ?? outputPaths[0])
    : undefined;
  const resultFolder = selectedPath?.replace(/[\\/][^\\/]+$/, "");
  const saveSelected = () => saveImages([selectedPath], "图片");
  const saveAll = () => saveImages(outputPaths, "图片");

  const timelineEvents = events.length > 0 ? events : localEvents;
  const hasOutputs =
    outputs.some((output) => output.url) ||
    events.some((e) => e.type === "output_saved" || e.type === "job.completed");

  return (
    <div className="generate-layout">
      <div className="flex flex-col overflow-auto bg-background gridpaper">
        <div className="p-6 pb-4 max-w-[820px] mx-auto w-full">
          <div className="surface-panel p-4">
            <label htmlFor={promptId} className="sr-only">
              生成提示词
            </label>
            <textarea
              id={promptId}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="描述你想生成的图像…"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleRun();
              }}
              aria-describedby={`${promptId}-counter`}
              maxLength={4000}
              className="w-full min-h-[80px] resize-y bg-transparent border-none outline-none text-[15px] leading-[1.5] text-foreground"
            />
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {onOpenEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon="image"
                  onClick={onOpenEdit}
                >
                  有参考图？去编辑
                </Button>
              )}
              <div className="flex-1 min-w-0" />
              <span
                id={`${promptId}-counter`}
                className="t-tiny font-mono"
                aria-live="polite"
              >
                {prompt.length} / 4000
              </span>
              <Button
                variant="primary"
                size="md"
                icon="sparkle"
                onClick={handleRun}
                kbd="⌘↵"
                disabled={isWorking || !provider || Boolean(parameterError)}
              >
                {isWorking ? "生成中…" : "生成"}
              </Button>
            </div>
          </div>
          <div
            className="mt-2.5 flex flex-wrap items-center gap-1.5"
            role="group"
            aria-label="快速开始提示词"
          >
            <span className="t-tiny pt-1.5" aria-hidden="true">
              快速开始
            </span>
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPrompt(p)}
                className="touch-target min-h-8 rounded-full border border-border bg-raised px-3 py-1 text-[11.5px] text-muted transition-colors hover:border-border-strong hover:text-foreground"
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="px-7 pb-6 pt-4 max-w-[820px] mx-auto w-full flex-1">
          <div className="flex flex-wrap items-center gap-2.5 mb-3">
            <div className="t-h3">
              {isWorking
                ? `生成中 · 请求 ${displayN} 张`
                : hasOutputs
                  ? `候选 · ${outputs.length} 张`
                  : "候选"}
            </div>
            {hasOutputs && (
              <Badge tone="accent" icon="check">
                已选 {String.fromCharCode(65 + selectedOutput)}
              </Badge>
            )}
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

          {runError && !isWorking ? (
            <Empty
              icon="warn"
              title="生成失败"
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
            <Empty
              icon="image"
              title="从一句话开始"
              subtitle="候选会出现在这里，自动保存到本机结果文件夹。选一张满意的，再一键另存到下载目录。"
            />
          ) : (
            <div
              className="grid gap-4"
              style={{
                gridTemplateColumns:
                  displayN <= 2
                    ? "1fr 1fr"
                    : `repeat(${Math.min(displayN, 4)}, 1fr)`,
              }}
            >
              {isWorking &&
                !hasOutputs &&
                Array.from({ length: displayN }).map((_, i) => (
                  <div
                    key={i}
                    className="aspect-square rounded-lg border border-border flex items-center justify-center text-faint font-mono text-[11px] animate-shimmer"
                    style={{
                      background:
                        "linear-gradient(90deg, var(--bg-sunken) 0%, var(--bg-hover) 40%, var(--bg-sunken) 80%)",
                      backgroundSize: "200% 100%",
                    }}
                  >
                    {String.fromCharCode(65 + i)}
                  </div>
                ))}
              {hasOutputs &&
                outputs.map((o) => (
                  <OutputTile
                    key={o.index}
                    output={o}
                    onSelect={() => setSelectedOutput(o.index)}
                    onDownload={() =>
                      saveImages([api.outputPath(jobId!, o.index)], "图片")
                    }
                    onOpen={() => openPath(api.outputPath(jobId!, o.index))}
                  />
                ))}
            </div>
          )}

          {runNotice && !isWorking && (
            <div className="mt-3 rounded-lg border border-[color:var(--warn-border,var(--border))] bg-sunken px-3 py-2 text-[12px] leading-relaxed text-muted">
              {runNotice} 已保留收到的图片；如果需要补齐，可以点「重新生成」。
            </div>
          )}

          {hasOutputs && jobId && (
            <div className="mt-4 px-3 py-2.5 bg-raised border border-border rounded-lg flex items-center gap-2.5">
              <Icon
                name="folder"
                size={14}
                style={{ color: "var(--text-faint)" }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold">
                  本次结果已自动保存
                </div>
                <div className="t-small">
                  可以继续编辑，也可以保存一份到「下载/GPT Image 2」。
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                icon="folder"
                onClick={() => revealPath(selectedPath)}
              >
                打开
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon="copy"
                onClick={() => copyText(resultFolder, "保存位置")}
              >
                复制位置
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-col overflow-hidden border-t border-border bg-raised lg:border-l lg:border-t-0">
        <div className="px-4 py-3.5 border-b border-border-faint">
          <Field label="服务商" id={providerSelectId}>
            <div className="flex items-center gap-1.5 px-2.5 h-9 bg-sunken border border-border rounded-md focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--accent-faint)] transition-colors">
              <Icon
                name="cpu"
                size={14}
                aria-hidden="true"
                style={{ color: "var(--accent)" }}
              />
              <select
                id={providerSelectId}
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                disabled={providerNames.length === 0}
                className="flex-1 bg-transparent border-none outline-none text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-60"
              >
                {providerNames.length === 0 && (
                  <option value="">（无可用 provider）</option>
                )}
                {providerNames.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              {provider === defaultProvider && (
                <Badge tone="neutral" size="sm">
                  默认
                </Badge>
              )}
            </div>
            <div className="mt-1.5 flex gap-1.5 text-[11px] text-muted">
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

          <div className="grid grid-cols-2 gap-2.5">
            <div className="col-span-2">
              <Field label="尺寸" hint="auto 或 16 倍数自定义尺寸">
                <ImageSizeInput value={size} onChange={setSize} />
              </Field>
            </div>
            <Field label="质量">
              <Select
                value={quality}
                onChange={(e) => setQuality(e.target.value)}
                options={QUALITY_OPTIONS}
              />
            </Field>
            <Field label="格式">
              <Select
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                options={["png", "jpeg", "webp"]}
              />
            </Field>
            <Field label="背景">
              <Select
                value={background}
                onChange={(e) => setBackground(e.target.value)}
                options={BACKGROUND_OPTIONS}
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

        <div className="px-4 py-3.5 flex-1 overflow-auto flex flex-col">
          <div className="flex items-center gap-2 mb-2.5">
            <div className="t-h3">进度</div>
            {isWorking && <Spinner size={12} />}
            <div className="flex-1" />
            {timelineEvents.length > 0 && (
              <span className="t-tiny font-mono">
                {timelineEvents.length} 条
              </span>
            )}
          </div>
          <EventTimeline events={timelineEvents} mode={tweaks.timeline} />
        </div>
      </div>
    </div>
  );
}
