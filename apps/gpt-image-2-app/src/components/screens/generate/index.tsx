import { useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { Sparkles, ListChecks, Image as ImageIcon, X } from "lucide-react";
import GradientText from "@/components/reactbits/text/GradientText";
import ShinyText from "@/components/reactbits/text/ShinyText";
import { GlassSelect } from "@/components/ui/select";
import { useCreateGenerate, useJobs } from "@/hooks/use-jobs";
import { useJobEvents } from "@/hooks/use-job-events";
import {
  errorMessage,
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
  providerSupportsMultipleOutputs,
  requestOutputCount,
} from "@/lib/provider-capabilities";
import {
  effectiveDefaultProvider,
  providerNames as readProviderNames,
} from "@/lib/providers";
import type { ServerConfig } from "@/lib/types";

const SIZE_OPTIONS = [
  { value: "auto", label: "自动" },
  { value: "1024x1024", label: "1:1 · 1K" },
  { value: "1536x1024", label: "16:9 · 1K" },
  { value: "1024x1536", label: "9:16 · 1K" },
  { value: "2048x2048", label: "1:1 · 2K" },
  { value: "3840x2160", label: "16:9 · 4K" },
  { value: "2160x3840", label: "9:16 · 4K" },
];

const QUALITY_CHIP_OPTIONS = [
  { value: "auto", label: "自动" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];

const FORMAT_OPTIONS = [
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG" },
  { value: "webp", label: "WEBP" },
];

const N_OPTIONS = [
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "4", label: "4" },
  { value: "6", label: "6" },
  { value: "8", label: "8" },
  { value: "10", label: "10" },
];

export function GenerateScreen({
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
  const [provider, setProvider] = useState<string>("");
  const [size, setSize] = useState("1024x1024");
  const [format, setFormat] = useState("png");
  const [quality, setQuality] = useState("auto");
  const [n, setN] = useState(1);
  const [jobId, setJobId] = useState<string | null>(null);
  const [pendingOutputCount, setPendingOutputCount] = useState<number | null>(
    null,
  );
  const [runError, setRunError] = useState<string | null>(null);
  const promptId = useId();

  const { running } = useJobEvents(jobId);
  const mutate = useCreateGenerate();
  const { data: jobs = [] } = useJobs();
  const queueCount = jobs.filter(
    (j) => j.status === "queued" || j.status === "running",
  ).length;
  const isSubmitting = mutate.isPending;
  const isTracking = running;
  const isWorking = isSubmitting || isTracking;
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

  const handleRun = async () => {
    if (!provider || isSubmitting) return;
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
    setPendingOutputCount(plannedN);
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
      const count = queued ? plannedN : responseOutputCount(res);
      setJobId(res.job_id);
      const mismatchNotice = queued
        ? null
        : outputCountMismatchMessage(count, plannedN);
      if (queued) {
        toast.success(
          plannedN > 1 ? `已开始生成 ${plannedN} 张` : "已开始生成",
          {
            id: toastId,
            description: `${provider} · ${normalizedSize} · 在「任务」里查看进度`,
            duration: 4_000,
          },
        );
      } else {
        toast.success("生成完成", {
          id: toastId,
          description: mismatchNotice ?? "在「任务」里查看",
        });
      }
    } catch (error) {
      const message = errorMessage(error);
      setRunError(message);
      toast.error("生成失败", { id: toastId, description: message });
    } finally {
      setPendingOutputCount(null);
    }
  };

  const noProviders = providerNames.length === 0;
  const submitDisabled =
    isSubmitting || noProviders || Boolean(parameterError) || !prompt.trim();

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div className="relative h-full w-full px-10 pb-12 pt-4 flex flex-col items-center justify-center">
        {/* Hero */}
        <div className="flex flex-col items-center text-center">
          <div className="flex items-baseline gap-3 text-[44px] sm:text-[52px] font-semibold leading-none tracking-tight">
            <span className="text-foreground">GPT</span>
            <GradientText
              colors={["#a78bfa", "#67e8f9", "#f0abfc", "#a78bfa"]}
              animationSpeed={6}
              className="!mx-0 !rounded-none"
            >
              <span className="px-1">Image</span>
            </GradientText>
            <span className="text-foreground">2</span>
          </div>
          <div className="mt-3">
            <ShinyText
              text="✦ 调用 GPT-image-2，创造无限可能 ✦"
              speed={3}
              color="rgba(245,245,247,.55)"
              shineColor="rgba(245,245,247,1)"
              className="text-[12.5px] tracking-wide"
            />
          </div>
        </div>

        {/* Form panel */}
        <section
          className="surface-panel mt-9 w-full max-w-[640px] p-5"
          aria-label="生成表单"
        >
          {/* tabs */}
          <div className="flex items-center gap-1 -mt-1 mb-3">
            <button
              type="button"
              className="relative px-3 py-1.5 text-[13px] font-semibold text-foreground"
            >
              生成
              <span className="absolute -bottom-px left-2 right-2 h-px bg-white" />
            </button>
            {onOpenEdit && (
              <button
                type="button"
                onClick={onOpenEdit}
                className="px-3 py-1.5 text-[13px] text-muted hover:text-foreground transition-colors"
              >
                编辑
              </button>
            )}
          </div>

          {/* error chip (in-form) */}
          {runError && !isWorking && (
            <div
              role="alert"
              className="mb-3 inline-flex items-center gap-2 rounded-md border border-[rgba(248,113,113,0.3)] px-3 py-1.5 text-[12px]"
              style={{
                background: "rgba(248,113,113,0.10)",
                color: "var(--status-err)",
              }}
            >
              <X size={12} />
              <span className="truncate max-w-[480px]">{runError}</span>
              <button
                type="button"
                onClick={() => setRunError(null)}
                className="opacity-60 hover:opacity-100 ml-2"
                aria-label="关闭错误提示"
              >
                <X size={11} />
              </button>
            </div>
          )}

          {noProviders && !runError && (
            <div
              role="status"
              className="mb-3 inline-flex items-center gap-2 rounded-md border border-[rgba(167,139,250,0.30)] px-3 py-1.5 text-[12px]"
              style={{
                background: "rgba(167,139,250,0.08)",
                color: "var(--text-muted)",
              }}
            >
              <ImageIcon size={12} className="opacity-70" />
              先在「设置 → 凭证」里添加一个 API Key，才能开始生成。
            </div>
          )}

          {/* textarea */}
          <div className="relative">
            <label htmlFor={promptId} className="sr-only">
              生成提示词
            </label>
            <textarea
              id={promptId}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="描述你想要生成的图像…"
              maxLength={4000}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleRun();
              }}
              className="w-full min-h-[110px] resize-none rounded-md px-3.5 py-3 text-[13.5px] leading-[1.55] outline-none transition-colors bg-[rgba(255,255,255,0.04)] border border-border placeholder:text-faint focus:border-[rgba(167,139,250,0.55)] focus:bg-[rgba(167,139,250,0.06)] focus:shadow-[0_0_0_3px_rgba(167,139,250,0.14)]"
            />
            <div className="absolute right-3 bottom-2 text-[10.5px] font-mono text-faint pointer-events-none">
              {prompt.length} / 4000
            </div>
          </div>

          {/* parameter chips + CTA */}
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <GlassSelect
              variant="chip"
              label="尺寸"
              value={size}
              options={SIZE_OPTIONS}
              onValueChange={setSize}
            />
            <GlassSelect
              variant="chip"
              label="质量"
              value={quality}
              options={QUALITY_CHIP_OPTIONS}
              onValueChange={setQuality}
            />
            <GlassSelect
              variant="chip"
              label="格式"
              value={format}
              options={FORMAT_OPTIONS}
              onValueChange={setFormat}
            />
            <GlassSelect
              variant="chip"
              label="数量"
              value={String(n)}
              options={N_OPTIONS}
              onValueChange={(v) => setN(Number(v))}
              disabled={!supportsMultipleOutputs}
            />
            <div className="flex-1" />
            <button
              type="button"
              onClick={handleRun}
              disabled={submitDisabled}
              className="inline-flex items-center justify-center gap-1.5 h-11 px-6 rounded-full text-[14px] font-semibold text-white transition-[background,transform,opacity] hover:opacity-95 active:translate-y-[0.5px] disabled:opacity-45 disabled:cursor-not-allowed"
              style={{
                backgroundImage:
                  "linear-gradient(135deg, rgba(167,139,250,0.95) 0%, rgba(103,232,249,0.92) 100%)",
                border: "1px solid rgba(167,139,250,0.50)",
                boxShadow:
                  "0 8px 24px -8px rgba(167,139,250,0.55), inset 0 1px 0 rgba(255,255,255,0.18)",
              }}
            >
              {isSubmitting ? (
                <>
                  <span
                    className="inline-block h-3.5 w-3.5 rounded-full animate-spin"
                    style={{
                      border: "2px solid rgba(255,255,255,0.4)",
                      borderTopColor: "white",
                    }}
                  />
                  提交中…
                </>
              ) : isTracking && pendingOutputCount ? (
                <>生成中…</>
              ) : (
                <>
                  生成
                  <Sparkles size={15} />
                </>
              )}
            </button>
          </div>
        </section>

        {/* Queue chip */}
        <div className="mt-7 flex items-center gap-2">
          <button
            type="button"
            onClick={() => onOpenHistory?.()}
            className="inline-flex items-center gap-1.5 px-4 h-8 rounded-full text-[12px] text-muted hover:text-foreground transition-colors"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.10)",
            }}
          >
            <ListChecks size={13} className="opacity-80" />
            查看队列 ({queueCount})
          </button>
        </div>
      </div>
    </div>
  );
}
