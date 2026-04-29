import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Icon } from "@/components/icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { Field } from "@/components/ui/field";
import { GlassCombobox } from "@/components/ui/combobox";
import { GlassSelect } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { OutputTile } from "@/components/screens/shared/output-tile";
import { useCreateGenerate } from "@/hooks/use-jobs";
import { useJobEvents } from "@/hooks/use-job-events";
import { api } from "@/lib/api";
import {
  errorMessage,
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
  providerSupportsMultipleOutputs,
  requestOutputCount,
} from "@/lib/provider-capabilities";
import {
  effectiveDefaultProvider,
  providerNames as readProviderNames,
} from "@/lib/providers";
import { openPath, saveImages } from "@/lib/user-actions";
import type { ServerConfig } from "@/lib/types";

const FORMAT_OPTIONS = [
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG" },
  { value: "webp", label: "WEBP" },
];

const COUNT_OPTIONS = OUTPUT_COUNT_OPTIONS.map((value) => ({
  value: String(value),
  label: String(value),
}));

export function ClassicGenerateScreen({
  config,
  onOpenEdit,
  onOpenHistory,
}: {
  config?: ServerConfig;
  onOpenEdit?: () => void;
  onOpenHistory?: () => void;
}) {
  const providerNames = useMemo(() => readProviderNames(config), [config]);
  const defaultProvider = effectiveDefaultProvider(config);
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState("");
  const [size, setSize] = useState("1024x1024");
  const [format, setFormat] = useState("png");
  const [quality, setQuality] = useState("auto");
  const [n, setN] = useState(1);
  const [jobId, setJobId] = useState<string | null>(null);
  const [outputCount, setOutputCount] = useState(0);
  const [selectedOutput, setSelectedOutput] = useState(0);
  const [runError, setRunError] = useState<string | null>(null);
  const [plannedOutputCount, setPlannedOutputCount] = useState<number | null>(
    null,
  );

  useEffect(() => {
    if (
      providerNames.length > 0 &&
      (!provider || !config?.providers[provider])
    ) {
      setProvider(defaultProvider || providerNames[0]);
    }
  }, [config?.providers, defaultProvider, provider, providerNames]);

  const { events, running } = useJobEvents(jobId);
  const mutate = useCreateGenerate();
  const isSubmitting = mutate.isPending;
  const isWorking = isSubmitting || running;
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
  const displayCount = plannedOutputCount ?? outputCount;

  useEffect(() => {
    if (!supportsMultipleOutputs && n !== 1) {
      setN(1);
    }
  }, [n, supportsMultipleOutputs]);

  const handleRun = async () => {
    if (!provider || isSubmitting) return;
    if (!prompt.trim()) {
      toast.error("请输入提示词");
      return;
    }
    if (parameterError) {
      toast.error("参数无效", { description: parameterError });
      return;
    }

    const normalizedSize = sizeValidation.normalized ?? size;
    const plannedN = effectiveOutputCount(config, provider, safeN);
    const requestedN = requestOutputCount(config, provider, safeN);
    const toastId = toast.loading("正在提交任务", {
      description: `${provider} · ${normalizedSize} · ${quality}`,
    });

    setRunError(null);
    setJobId(null);
    setOutputCount(plannedN);
    setSelectedOutput(0);
    setPlannedOutputCount(plannedN);
    try {
      const res = await mutate.mutateAsync({
        prompt,
        provider,
        size: normalizedSize,
        format,
        quality,
        n: requestedN,
        metadata: {
          size: normalizedSize,
          format,
          quality,
          n: plannedN,
        },
      });
      const queued =
        res.queued ||
        res.job?.status === "queued" ||
        res.job?.status === "running";
      const actualCount = queued ? plannedN : responseOutputCount(res);
      setJobId(res.job_id);
      setOutputCount(Math.max(1, actualCount));
      if (queued) {
        toast.success(plannedN > 1 ? `已开始生成 ${plannedN} 张` : "已开始生成", {
          id: toastId,
          description: "旧工作台里会继续显示占位图，完成后可在任务里查看。",
          duration: 4_000,
        });
      } else {
        toast.success("生成完成", {
          id: toastId,
          description:
            outputCountMismatchMessage(actualCount, plannedN) ??
            "图片已生成并保存。",
        });
      }
    } catch (error) {
      const message = errorMessage(error);
      setRunError(message);
      toast.error("生成失败", { id: toastId, description: message });
    } finally {
      setPlannedOutputCount(null);
    }
  };

  const outputRefreshKey = events.length;
  const outputs = useMemo(() => {
    if (!jobId || outputCount < 1) return [];
    return Array.from({ length: outputCount }).map((_, index) => ({
      index,
      url: api.outputUrl(jobId, index),
      selected: index === selectedOutput,
      seed: index * 31 + outputRefreshKey,
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

  const noProviders = providerNames.length === 0;
  const submitDisabled =
    isSubmitting || noProviders || Boolean(parameterError) || !prompt.trim();

  return (
    <div className="classic-generate h-full min-h-0 overflow-hidden p-3">
      <div className="generate-layout gap-3">
        <section className="surface-panel min-h-0 overflow-hidden p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="t-h3">输出预览</div>
              <div className="t-small">生成结果会按候选顺序保留在这里。</div>
            </div>
            {displayCount > 0 && (
              <Badge tone={isWorking ? "running" : "accent"} size="sm">
                {isWorking ? "进行中" : "本次输出"} · {displayCount} 张
              </Badge>
            )}
          </div>

          <div className="h-[calc(100%-46px)] min-h-0 overflow-auto pr-1">
            {outputs.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
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
              <div className="flex h-full items-center justify-center">
                <Empty
                  icon="generate"
                  title="还没有输出"
                  subtitle="右侧写提示词并提交，经典工作台会把本次结果展示在这里。"
                />
              </div>
            )}
          </div>
        </section>

        <aside className="parameter-shelf surface-panel min-h-0 overflow-hidden">
          <div className="parameter-scroll p-3">
            <div className="mb-3 flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                active
                icon="generate"
              >
                生成
              </Button>
              <Button variant="ghost" size="sm" icon="edit" onClick={onOpenEdit}>
                编辑
              </Button>
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

            {noProviders && (
              <div className="mb-3 rounded-md border border-border bg-sunken px-3 py-2 text-[12px] text-muted">
                先在「设置 → 凭证」里添加一个 API Key，才能开始生成。
              </div>
            )}

            <Field label="提示词">
              <Textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="描述你想生成的图像..."
                minHeight={132}
              />
              <div className="mt-1.5 text-right font-mono text-[11px] text-faint">
                {prompt.length} / 4000
              </div>
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
              <Field
                label="数量"
                error={
                  supportsMultipleOutputs || outputCountValidation.ok
                    ? undefined
                    : outputCountValidation.message
                }
              >
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
          </div>

          <div className="parameter-actions p-3">
            <Button
              variant="primary"
              size="lg"
              icon={isSubmitting ? "reload" : "sparkle"}
              disabled={submitDisabled}
              onClick={handleRun}
              className="w-full justify-center"
            >
              {isSubmitting ? "提交中" : "生成"}
            </Button>
            <div className="mt-2 flex items-center justify-between text-[11px] text-faint">
              <span>{supportsMultipleOutputs ? `计划输出 ${safeN} 张` : "当前凭证只输出 1 张"}</span>
              <button
                type="button"
                onClick={onOpenHistory}
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                <Icon name="history" size={12} />
                任务
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
