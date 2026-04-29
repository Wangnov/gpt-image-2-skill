import { useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { Sparkles, ListChecks, Loader2, Image as ImageIcon, X } from "lucide-react";
import { motion } from "motion/react";
import GradientText from "@/components/reactbits/text/GradientText";
import ShinyText from "@/components/reactbits/text/ShinyText";
import ClickSpark from "@/components/reactbits/components/ClickSpark";
import ElectricBorder from "@/components/reactbits/components/ElectricBorder";
import Masonry, {
  type MasonryItem,
} from "@/components/reactbits/components/Masonry";
import { PlaceholderImage } from "@/components/screens/shared/placeholder-image";
import logoUrl from "@/assets/logo.png";
import { useTweaks } from "@/hooks/use-tweaks";
import { THEME_PRESETS } from "@/lib/theme-presets";
import { GlassSelect } from "@/components/ui/select";
import { GlassCombobox } from "@/components/ui/combobox";
import { useCreateGenerate, useJobs } from "@/hooks/use-jobs";
import { useJobEvents } from "@/hooks/use-job-events";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  errorMessage,
  outputCountMismatchMessage,
  responseOutputCount,
} from "@/lib/job-feedback";
import {
  normalizeOutputCount,
  OUTPUT_COUNT_OPTIONS,
  POPULAR_SIZE_OPTIONS,
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
import type { Job, ServerConfig } from "@/lib/types";

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

const COUNT_OPTIONS = OUTPUT_COUNT_OPTIONS.map((n) => ({
  value: String(n),
  label: String(n),
}));

const PROMPT_TEMPLATES: { label: string; prompt: string }[] = [
  { label: "产品摄影", prompt: "产品摄影：亚光陶瓷杯，纯白背景，柔光，居中构图" },
  { label: "Logo", prompt: "极简几何 logo，渐变填充，矢量风格，纯白背景" },
  { label: "水墨", prompt: "水墨写意山水，留白，竖幅，淡墨远山" },
  { label: "Cosplay", prompt: "电影级 Cosplay 海报，动态姿态，日式美感，大景深" },
  { label: "赛博朋克", prompt: "赛博朋克城市夜景，霓虹灯反射在湿地上，雨后" },
];

function jobPlaceholderSeed(job: Job) {
  return (
    Array.from(job.id).reduce((sum, char) => sum + char.charCodeAt(0), 0) || 1
  );
}

function heightRatioFromSize(size: unknown) {
  if (typeof size !== "string") return 1;
  const match = size.match(/^(\d{2,5})x(\d{2,5})$/i);
  if (!match) return 1;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return 1;
  return height / width;
}

type PendingGalleryTile = {
  kind: "pending";
  jobId: string;
  slotIndex: number;
  seed: number;
};

type CompletedGalleryTile = {
  kind: "completed";
  job: Job;
  url: string | null;
  promptText: string;
};

type GalleryTile = PendingGalleryTile | CompletedGalleryTile;

function RecentWorkTile({
  job,
  url,
  promptText,
  onOpenJob,
}: {
  job: Job;
  url: string | null;
  promptText: string;
  onOpenJob?: (jobId: string) => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [url]);

  return (
    <button
      key={job.id}
      type="button"
      onClick={() => onOpenJob?.(job.id)}
      className="h-full w-full rounded-md overflow-hidden ring-1 ring-[color:var(--w-10)] hover:ring-[color:var(--accent-45)] hover:scale-[1.025] transition-[box-shadow,transform] bg-[color:var(--bg-sunken)] focus-visible:outline-none focus-visible:ring-[color:var(--accent-55)]"
      title={promptText.slice(0, 80)}
      aria-label={`打开作品:${promptText.slice(0, 40)}`}
    >
      {url && !imageFailed ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          draggable={false}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <PlaceholderImage
          seed={jobPlaceholderSeed(job)}
          variant="recent"
        />
      )}
    </button>
  );
}

function PendingWorkTile({
  seed,
  slotIndex,
  accentHex,
}: {
  seed: number;
  slotIndex: number;
  accentHex: string;
}) {
  return (
    <div className="relative h-full w-full" aria-label="生成中">
      <ElectricBorder
        color={accentHex}
        speed={1.1}
        chaos={0.55}
        borderRadius={6}
        className="absolute inset-0"
      >
        <div className="relative h-full w-full overflow-hidden rounded-md bg-[color:var(--bg-sunken)]">
          <PlaceholderImage
            seed={seed}
            variant={`pending-${slotIndex}`}
            style={{ opacity: 0.58 }}
          />
          <div
            className="absolute inset-0 animate-shimmer"
            style={{
              background: "var(--skeleton-gradient-soft)",
              backgroundSize: "200% 100%",
              mixBlendMode: "screen",
            }}
          />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
            <Loader2
              size={18}
              className="animate-spin text-[color:var(--accent)]"
            />
            <span className="text-[10px] text-faint">生成中…</span>
          </div>
        </div>
      </ElectricBorder>
    </div>
  );
}

export function GenerateScreen({
  config,
  onOpenEdit,
  onOpenHistory,
  onOpenJob,
}: {
  config?: ServerConfig;
  onOpenEdit?: () => void;
  onOpenHistory?: () => void;
  onOpenJob?: (jobId: string) => void;
}) {
  const providerNames = useMemo(() => readProviderNames(config), [config]);
  const defaultProvider = effectiveDefaultProvider(config);
  // Read the active theme's accent hex so ElectricBorder + ClickSpark
  // (both of which need a real CSS color value, not a var() reference)
  // tint to whatever preset is active.
  const { tweaks } = useTweaks();
  const accentHex = THEME_PRESETS[tweaks.themePreset].accentSolid;
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
  // Increments on every successful click of the generate CTA. Used as a
  // remount key for the brand-accent ripple span inside the button so the
  // ripple animation replays on each press.
  const [pulseKey, setPulseKey] = useState(0);
  const promptId = useId();

  const { running } = useJobEvents(jobId);
  const mutate = useCreateGenerate();
  const { data: jobs = [] } = useJobs();
  const queueCount = jobs.filter(
    (j) => j.status === "queued" || j.status === "running",
  ).length;
  const recentPrompts = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const job of jobs) {
      const p = (job.metadata as Record<string, unknown>)?.prompt as
        | string
        | undefined;
      if (!p) continue;
      const trimmed = p.trim();
      if (trimmed.length < 4 || seen.has(trimmed)) continue;
      seen.add(trimmed);
      result.push(trimmed);
      if (result.length >= 3) break;
    }
    return result;
  }, [jobs]);
  // Pick up "rerun" payload written by the detail drawer when the user
  // clicks 「再来一次」. Drains the slot on read so the prefill happens
  // exactly once per click.
  useEffect(() => {
    try {
      const raw = localStorage.getItem("gpt2.pendingRerun");
      if (!raw) return;
      const data = JSON.parse(raw) as Record<string, unknown>;
      if (typeof data.prompt === "string") setPrompt(data.prompt);
      if (typeof data.size === "string") setSize(data.size);
      if (typeof data.format === "string") setFormat(data.format);
      if (typeof data.quality === "string") setQuality(data.quality);
      if (typeof data.n === "number") setN(data.n);
      localStorage.removeItem("gpt2.pendingRerun");
      toast.message("已预填上一次的提示词", {
        description: "改一下再点「生成」就能跑变体。",
        duration: 4_000,
      });
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Pending placeholders are derived from the global jobs cache so they
  // (a) survive screen switches, (b) accumulate when the user fires off
  // multiple submissions in a row, and (c) stay in sync with the real
  // queued/running state on the server. Each in-flight job expands into
  // metadata.n slots so a "n=4" submission shows 4 placeholders at once.
  const pendingPlaceholders = useMemo(() => {
    return jobs
      .filter((j) => j.status === "queued" || j.status === "running")
      .flatMap((job) => {
        const meta = (job.metadata ?? {}) as Record<string, unknown>;
        const n = typeof meta.n === "number" && meta.n > 0 ? meta.n : 1;
        return Array.from({ length: n }, (_, i) => ({
          jobId: job.id,
          slotIndex: i,
          seed: jobPlaceholderSeed(job) + i * 13,
          heightRatio: heightRatioFromSize(meta.size),
        }));
      });
  }, [jobs]);
  // Cap total gallery tiles at 12 so new placeholders push the oldest
  // completed thumbnails out instead of bumping rows off-screen.
  const GALLERY_MAX = 12;
  const recentCompleted = useMemo(() => {
    return jobs
      .filter(
        (j) =>
          j.status === "completed" &&
          ((j.outputs?.length ?? 0) > 0 || Boolean(j.output_path)),
      )
      .slice(0, Math.max(0, GALLERY_MAX - pendingPlaceholders.length));
  }, [jobs, pendingPlaceholders.length]);
  const galleryItems = useMemo<MasonryItem<GalleryTile>[]>(() => {
    const pendingItems: MasonryItem<GalleryTile>[] = pendingPlaceholders.map(
      (placeholder) => ({
        id: `pending-${placeholder.jobId}-${placeholder.slotIndex}`,
        heightRatio: placeholder.heightRatio,
        data: {
          kind: "pending",
          jobId: placeholder.jobId,
          slotIndex: placeholder.slotIndex,
          seed: placeholder.seed,
        },
      }),
    );
    const completedItems: MasonryItem<GalleryTile>[] = recentCompleted.map(
      (job) => {
        let url: string | null = null;
        try {
          url = api.jobOutputUrl(job, 0) || null;
        } catch {
          url = null;
        }
        const meta = (job.metadata ?? {}) as Record<string, unknown>;
        const promptText = (meta.prompt as string | undefined) ?? "";
        return {
          id: `completed-${job.id}`,
          heightRatio: heightRatioFromSize(meta.size),
          data: {
            kind: "completed",
            job,
            url,
            promptText,
          },
        };
      },
    );

    return [...pendingItems, ...completedItems];
  }, [pendingPlaceholders, recentCompleted]);
  // Split layout activates on lg+ viewports once the user has any
  // completed work OR anything in flight — form on the left, gallery
  // on the right, hero spanning above. New users / empty history fall
  // back to the hero-centered single-column layout.
  const hasSplit =
    recentCompleted.length > 0 || pendingPlaceholders.length > 0;
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
      <div
        className={cn(
          "scrollbar-none relative h-full w-full overflow-y-auto",
          // Default (no history yet, OR narrow viewport): hero-centered
          // single-column stack — same feel as the original onboarding hero.
          "px-4 pb-8 pt-3 sm:px-10 sm:pb-12 sm:pt-4 flex flex-col items-center justify-start",
          !hasSplit && "sm:justify-center",
          // Split mode (lg+ AND has completed work): hero spans top, form
          // pinned to the left column, gallery on the right. Closes the
          // prompt → result loop on a single screen.
          hasSplit &&
            "lg:grid lg:grid-cols-[minmax(440px,520px)_1fr] lg:gap-x-10 lg:gap-y-6 lg:items-start lg:content-start lg:max-w-[1440px] lg:mx-auto lg:px-12 lg:pt-10 lg:pb-10 lg:justify-items-stretch",
        )}
      >
        {/* Hero — spans both columns in split mode so the form/gallery
            split sits beneath a single banner. Keep the steady state free
            of CSS filters so text stays pixel-sharp over animated glass. */}
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className={cn(
            "flex flex-col items-center text-center",
            hasSplit && "mb-1 lg:col-span-2 lg:mb-2",
          )}
        >
          <img
            src={logoUrl}
            alt=""
            aria-hidden="true"
            className={cn(
              "mb-3 h-16 w-16 object-contain drop-shadow-[0_0_22px_var(--accent-30)]",
              hasSplit &&
                "mb-1 h-10 w-10 sm:mb-2 sm:h-12 sm:w-12 lg:mb-3 lg:h-14 lg:w-14",
            )}
          />
          <div
            className={cn(
              "t-display flex items-baseline gap-3",
              hasSplit && "gap-2 text-[34px] sm:text-[44px] lg:text-[64px]",
            )}
          >
            <span className="text-foreground">GPT</span>
            <GradientText
              colors={[
                "var(--accent)",
                "var(--accent-2)",
                "var(--accent-3)",
                "var(--accent)",
              ]}
              animationSpeed={8}
              yoyo={false}
              pauseOnHover
              className="!mx-0 !rounded-none [filter:drop-shadow(0_0_18px_var(--accent-30))]"
            >
              <span className="px-1 [letter-spacing:inherit]">Image</span>
            </GradientText>
            <span className="text-foreground">2</span>
          </div>
          <div
            className={cn(
              "mt-3 inline-flex items-center gap-2",
              hasSplit && "mt-2",
            )}
          >
            <Sparkles
              size={11}
              className="opacity-50 text-foreground animate-pulse-subtle"
              aria-hidden
            />
            <ShinyText
              text="将设计交给每一个人"
              speed={3}
              color="rgba(245,245,247,.55)"
              shineColor="rgba(245,245,247,1)"
              className="text-[12.5px] tracking-wide"
            />
            <Sparkles
              size={11}
              className="opacity-50 text-foreground animate-pulse-subtle"
              aria-hidden
            />
          </div>
        </motion.div>

        {/* Form panel */}
        <section
          className={cn(
            "surface-panel mt-3 w-full max-w-[640px] p-4 sm:mt-9 sm:p-5",
            // Split mode: pin to left column, drop top margin (the grid
            // gap takes over), drop the centering max-width.
            hasSplit && "lg:col-start-1 lg:mt-0 lg:max-w-none",
          )}
          aria-label="生成表单"
        >
          {/* tabs */}
          <div className="flex items-center gap-1 -mt-1 mb-3">
            <button
              type="button"
              className="relative px-3 py-1.5 text-[13px] font-semibold text-foreground"
            >
              生成
              <span className="absolute -bottom-px left-2 right-2 h-px bg-foreground" />
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
              className="mb-3 inline-flex items-center gap-2 rounded-md border border-[color:var(--status-err-30)] px-3 py-1.5 text-[12px]"
              style={{
                background: "var(--status-err-10)",
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
              className="mb-3 inline-flex items-center gap-2 rounded-md border border-[color:var(--accent-30)] px-3 py-1.5 text-[12px]"
              style={{
                background: "var(--accent-08)",
                color: "var(--text-muted)",
              }}
            >
              <ImageIcon size={12} className="opacity-70" />
              先在「设置 → 凭证」里添加一个 API Key，才能开始生成。
            </div>
          )}

          {/* Cold-start chips — only when textarea is empty.
              Pulls 3 recent unique prompts from job history + a static
              template list, so first-time users have a starting point and
              repeat users can re-fire a previous prompt with one click. */}
          {!prompt.trim() && (
            <div className="mb-2.5 flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-1 [mask-image:linear-gradient(to_right,black_calc(100%-32px),transparent)] [-webkit-mask-image:linear-gradient(to_right,black_calc(100%-32px),transparent)]">
              {recentPrompts.length > 0 && (
                <>
                  <span className="t-caps shrink-0 mr-1">最近</span>
                  {recentPrompts.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPrompt(p)}
                      className="shrink-0 max-w-[200px] inline-flex items-center h-7 px-3 rounded-full text-[12px] text-muted hover:text-foreground bg-[color:var(--w-04)] hover:bg-[color:var(--w-06)] border border-border transition-colors"
                      title={p}
                    >
                      {/* truncate must wrap a block child — applying it
                          directly on inline-flex container drops the ellipsis
                          (text gets hard-clipped instead). */}
                      <span className="block truncate">{p}</span>
                    </button>
                  ))}
                  <span className="mx-2 h-3.5 w-px bg-border-faint shrink-0" />
                </>
              )}
              <span className="t-caps shrink-0 mr-1">模板</span>
              {PROMPT_TEMPLATES.map((t) => (
                <button
                  key={t.label}
                  type="button"
                  onClick={() => setPrompt(t.prompt)}
                  className="shrink-0 inline-flex items-center gap-1 h-7 px-3 rounded-full text-[12px] text-muted hover:text-foreground bg-[color:var(--accent-08)] hover:bg-[color:var(--accent-14)] border border-[color:var(--accent-30)] transition-colors"
                  title={t.prompt}
                >
                  <Sparkles
                    size={11}
                    className="opacity-60 text-[color:var(--accent)]"
                  />
                  {t.label}
                </button>
              ))}
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
              className="w-full min-h-[110px] resize-none rounded-md px-3.5 py-3 text-[13.5px] leading-[1.55] outline-none transition-colors bg-[color:var(--w-04)] border border-border placeholder:text-faint focus:border-[color:var(--accent-55)] focus:bg-[color:var(--accent-06)] focus:shadow-[0_0_0_3px_var(--accent-14)]"
            />
            <div className="absolute right-3 bottom-2 text-[10.5px] font-mono text-faint pointer-events-none">
              {prompt.length} / 4000
            </div>
          </div>

          {/* parameter chips + CTA */}
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-[minmax(146px,1.35fr)_minmax(92px,.8fr)_minmax(92px,.8fr)_minmax(82px,.68fr)_minmax(104px,auto)] sm:items-center">
            <GlassCombobox
              variant="chip"
              label="尺寸"
              value={size}
              options={POPULAR_SIZE_OPTIONS}
              onValueChange={setSize}
              placeholder="WxH"
              className="col-span-2 w-full min-w-0 sm:col-span-1"
              invalid={!sizeValidation.ok}
            />
            <GlassSelect
              variant="chip"
              label="质量"
              value={quality}
              options={QUALITY_CHIP_OPTIONS}
              onValueChange={setQuality}
              className="w-full min-w-0 justify-between"
            />
            <GlassSelect
              variant="chip"
              label="格式"
              value={format}
              options={FORMAT_OPTIONS}
              onValueChange={setFormat}
              className="w-full min-w-0 justify-between"
            />
            <GlassCombobox
              variant="chip"
              label="数量"
              value={String(n)}
              options={COUNT_OPTIONS}
              onValueChange={(v) => setN(Number(v) || 1)}
              disabled={!supportsMultipleOutputs}
              inputMode="numeric"
              placeholder="1-10"
              className="w-full min-w-0"
            />
            <ClickSpark
              sparkColor={accentHex}
              sparkCount={10}
              sparkRadius={22}
              sparkSize={8}
              duration={500}
              className="w-full"
            >
            <button
              type="button"
              onClick={() => {
                setPulseKey((n) => n + 1);
                handleRun();
              }}
              disabled={submitDisabled}
              className="relative overflow-hidden inline-flex w-full items-center justify-center gap-1.5 h-11 px-4 rounded-full text-[14px] font-semibold text-foreground transition-[background,transform,opacity] hover:opacity-95 active:translate-y-[0.5px] disabled:opacity-45 disabled:cursor-not-allowed"
              style={{
                backgroundImage: "var(--accent-gradient-fill)",
                border: "1px solid var(--accent-50)",
                boxShadow: "var(--shadow-accent-glow)",
              }}
            >
              {/* Brand-accent ripple from center on each press. The
                  remount-on-key trick replays the animation every click.
                  pointer-events-none so the ripple never blocks the next
                  click; aria-hidden because it's purely decorative. */}
              {pulseKey > 0 && (
                <span
                  key={pulseKey}
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-full animate-accent-pulse-out"
                  style={{
                    background:
                      "radial-gradient(circle at center, var(--accent-55), transparent 70%)",
                  }}
                />
              )}
              {isSubmitting ? (
                <>
                  <span
                    className="inline-block h-3.5 w-3.5 rounded-full animate-spin"
                    style={{
                      border: "2px solid var(--w-40)",
                      borderTopColor: "var(--text)",
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
            </ClickSpark>
          </div>
        </section>

        {/* Inline result gallery — closes the prompt → result loop on the
            same screen. Renders whenever there's anything to show
            (completed work OR in-flight placeholders) so the user sees
            their submission immediately, not after the API returns. */}
        {(recentCompleted.length > 0 || pendingPlaceholders.length > 0) && (
          <section
            aria-label="最近的作品"
            className={cn(
              "mt-6 w-full max-w-[640px]",
              // Split mode: right column, top-aligned with the form,
              // wider visual since the column is the larger of the two.
              hasSplit && "lg:col-start-2 lg:row-start-2 lg:mt-0 lg:max-w-none lg:self-start",
            )}
          >
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="t-caps">最近的作品</span>
              {onOpenHistory && (
                <button
                  type="button"
                  onClick={() => onOpenHistory()}
                  className="text-[11px] text-muted hover:text-foreground transition-colors"
                >
                  查看全部 ›
                </button>
              )}
            </div>
            <Masonry
              items={galleryItems}
              gap={10}
              minColumnWidth={126}
              maxColumns={4}
              animateFrom="bottom"
              className="min-h-[260px]"
              renderItem={({ data }) =>
                data.kind === "pending" ? (
                  <PendingWorkTile
                    seed={data.seed}
                    slotIndex={data.slotIndex}
                    accentHex={accentHex}
                  />
                ) : (
                  <RecentWorkTile
                    job={data.job}
                    url={data.url}
                    promptText={data.promptText}
                    onOpenJob={onOpenJob}
                  />
                )
              }
            />
          </section>
        )}

        {/* Queue chip — spans both columns in split mode and centers
            itself; in default mode it's part of the centered stack. */}
        <div
          className={cn(
            "mt-7 flex items-center gap-2",
            hasSplit && "lg:col-span-2 lg:justify-self-center lg:mt-4",
          )}
        >
          <button
            type="button"
            onClick={() => onOpenHistory?.()}
            className="inline-flex items-center gap-1.5 px-4 h-8 rounded-full text-[12px] text-muted hover:text-foreground transition-colors"
            style={{
              background: "var(--w-04)",
              border: "1px solid var(--w-10)",
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
