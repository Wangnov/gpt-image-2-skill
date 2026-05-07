import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  Sparkles,
  ListChecks,
  Loader2,
  Image as ImageIcon,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import GradientText from "@/components/reactbits/text/GradientText";
import ShinyText from "@/components/reactbits/text/ShinyText";
import ClickSpark from "@/components/reactbits/components/ClickSpark";
import Masonry, {
  type MasonryItem,
} from "@/components/reactbits/components/Masonry";
import { Icon } from "@/components/icon";
import { PlaceholderImage } from "@/components/screens/shared/placeholder-image";
import { PromptTemplatePicker } from "@/components/screens/shared/prompt-template-picker";
import { CreationParamsBar } from "@/components/screens/shared/creation-params-bar";
import logoUrl from "@/assets/logo.png";
import { useTweaks } from "@/hooks/use-tweaks";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { THEME_PRESETS } from "@/lib/theme-presets";
import { loadGenerateDraft, saveGenerateDraft } from "@/lib/drafts";
import { useCreateGenerate, useJobs } from "@/hooks/use-jobs";
import { useJobEvents } from "@/hooks/use-job-events";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  jobOutputIndexes,
  jobOutputPath,
  jobOutputUrl,
} from "@/lib/job-outputs";
import { sendImageToEdit } from "@/lib/job-navigation";
import { insertPromptAtCursor } from "@/lib/prompt-templates";
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
  outputIndex: number;
  path: string | null;
  url: string | null;
  promptText: string;
};

type GalleryTile = PendingGalleryTile | CompletedGalleryTile;

function RecentWorkTile({
  job,
  outputIndex,
  path,
  url,
  promptText,
  onOpenJob,
  onSendToEdit,
}: {
  job: Job;
  outputIndex: number;
  path: string | null;
  url: string | null;
  promptText: string;
  onOpenJob?: (jobId: string) => void;
  onSendToEdit?: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const [hover, setHover] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const canSendToEdit = Boolean(onSendToEdit && (path || url));

  useEffect(() => {
    setImageFailed(false);
  }, [url]);

  return (
    <motion.div
      key={job.id}
      role="button"
      tabIndex={0}
      onClick={() => onOpenJob?.(job.id)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocusCapture={() => setFocusWithin(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocusWithin(false);
        }
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onOpenJob?.(job.id);
      }}
      whileTap={reducedMotion ? undefined : { scale: 0.985 }}
      transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
      className="relative h-full w-full cursor-pointer rounded-md overflow-hidden ring-1 ring-[color:var(--w-10)] hover:ring-[color:var(--accent-45)] hover:scale-[1.025] transition-[box-shadow,transform] bg-[color:var(--bg-sunken)] focus-visible:outline-none focus-visible:ring-[color:var(--accent-55)]"
      title={promptText.slice(0, 80)}
      aria-label={`打开作品 ${outputIndex + 1}:${promptText.slice(0, 40)}`}
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
        <PlaceholderImage seed={jobPlaceholderSeed(job)} variant="recent" />
      )}
      {canSendToEdit && (hover || focusWithin) && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onSendToEdit?.();
          }}
          className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-[5px] border border-[color:var(--surface-floating-border)] bg-[color:var(--surface-floating)] text-foreground shadow-[var(--shadow-floating)] backdrop-blur transition-colors hover:bg-[color:var(--surface-floating-strong)]"
          title="发送到编辑"
          aria-label="发送到编辑"
        >
          <Icon name="edit" size={13} />
        </button>
      )}
    </motion.div>
  );
}

function PendingWorkTile({
  seed,
  slotIndex,
}: {
  seed: number;
  slotIndex: number;
}) {
  return (
    <div
      className="relative h-full w-full overflow-hidden rounded-md border border-[color:var(--w-12)] bg-[color:var(--bg-sunken)] shadow-sm"
      aria-label="生成中"
    >
      <PlaceholderImage
        seed={seed}
        variant={`pending-${slotIndex}`}
        style={{ opacity: 0.72 }}
      />
      <div
        className="absolute inset-0 animate-shimmer"
        style={{
          background: "var(--skeleton-gradient-soft)",
          backgroundSize: "200% 100%",
          opacity: 0.55,
          mixBlendMode: "screen",
        }}
      />
      <div className="absolute inset-0 bg-[color:var(--k-18)]" />
      <div className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full border border-[color:var(--w-12)] bg-[color:var(--k-35)] px-2 py-1 text-[10px] font-medium text-[color:var(--image-overlay-text)] backdrop-blur-md">
        <Loader2
          size={11}
          className="animate-spin text-[color:var(--accent)]"
        />
        生成中
      </div>
    </div>
  );
}

export function GenerateScreen({
  config,
  onOpenEdit,
  onOpenHistory,
  onOpenJob,
  onOpenSettings,
}: {
  config?: ServerConfig;
  onOpenEdit?: () => void;
  onOpenHistory?: () => void;
  onOpenJob?: (jobId: string) => void;
  onOpenSettings?: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const providerNames = useMemo(() => readProviderNames(config), [config]);
  const defaultProvider = effectiveDefaultProvider(config);
  // ClickSpark needs a real CSS color value, not a var() reference,
  // so tint it to whatever preset is active.
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
  const [draftLoaded, setDraftLoaded] = useState(false);
  const pendingRerunAppliedRef = useRef(false);
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
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
    if (!tweaks.persistCreativeDrafts) {
      setDraftLoaded(true);
      return;
    }
    let cancelled = false;
    void loadGenerateDraft()
      .then((draft) => {
        if (cancelled || pendingRerunAppliedRef.current) return;
        if (!draft) return;
        setPrompt(draft.prompt);
        setProvider(draft.provider);
        setSize(draft.size);
        setFormat(draft.format);
        setQuality(draft.quality);
        setN(draft.n);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setDraftLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [tweaks.persistCreativeDrafts]);

  useEffect(() => {
    if (!draftLoaded || !tweaks.persistCreativeDrafts) return;
    const handle = window.setTimeout(() => {
      void saveGenerateDraft({
        prompt,
        provider,
        size,
        quality,
        format,
        n,
      }).catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [
    draftLoaded,
    format,
    n,
    prompt,
    provider,
    quality,
    size,
    tweaks.persistCreativeDrafts,
  ]);

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
      pendingRerunAppliedRef.current = true;
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
        const outputIndex = jobOutputIndexes(job)[0] ?? 0;
        let url: string | null = null;
        let path: string | null = null;
        try {
          url = jobOutputUrl(job, outputIndex);
          path = jobOutputPath(job, outputIndex);
        } catch {
          url = null;
          path = null;
        }
        const meta = (job.metadata ?? {}) as Record<string, unknown>;
        const promptText = (meta.prompt as string | undefined) ?? "";
        return {
          id: `completed-${job.id}`,
          heightRatio: heightRatioFromSize(meta.size),
          data: {
            kind: "completed",
            job,
            outputIndex,
            path,
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
  const hasSplit = recentCompleted.length > 0 || pendingPlaceholders.length > 0;
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
          // Split mode (xl+ AND has completed work): hero spans top, form
          // pinned to the left column, gallery on the right. Closes the
          // prompt → result loop on a single screen. Gated at xl (≥1280)
          // so the form / gallery pair doesn't get crammed in the awkward
          // 1024–1279 band where both columns end up vertically tight.
          hasSplit &&
            "xl:grid xl:grid-cols-[minmax(420px,500px)_minmax(480px,1fr)] xl:gap-x-10 xl:gap-y-6 xl:items-start xl:content-start xl:max-w-[1440px] xl:mx-auto xl:px-12 xl:pt-10 xl:pb-10 xl:justify-items-stretch",
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
            hasSplit && "mb-1 xl:col-span-2 xl:mb-2",
          )}
        >
          <img
            src={logoUrl}
            alt=""
            aria-hidden="true"
            className={cn(
              "mb-3 h-16 w-16 object-contain",
              // Halo size follows logo size so the small split-mode logo
              // doesn't get crowned with the same 22px aura as the hero.
              hasSplit
                ? "[filter:drop-shadow(var(--logo-halo-md))] mb-1 h-10 w-10 sm:mb-2 sm:h-12 sm:w-12 xl:mb-3 xl:h-14 xl:w-14"
                : "[filter:drop-shadow(var(--logo-halo-lg))]",
            )}
          />
          <div
            className={cn(
              "t-display flex items-baseline gap-3",
              hasSplit && "gap-2 text-[34px] sm:text-[44px] xl:text-[64px]",
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
        <motion.section
          initial={reducedMotion ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: reducedMotion ? 0 : 0.42,
            delay: reducedMotion ? 0 : 0.08,
            ease: [0.22, 1, 0.36, 1],
          }}
          className={cn(
            "surface-panel mt-3 w-full max-w-[640px] p-4 sm:mt-9 sm:p-5",
            // Split mode: pin to left column, drop top margin (the grid
            // gap takes over), drop the centering max-width.
            hasSplit && "xl:col-start-1 xl:mt-0 xl:max-w-none",
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
            <div className="flex-1" />
            <PromptTemplatePicker
              scope="generate"
              onInsert={insertPromptTemplate}
            />
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
            onOpenSettings ? (
              <button
                type="button"
                onClick={onOpenSettings}
                className="group mb-3 inline-flex items-center gap-2 rounded-md border border-[color:var(--accent-30)] px-3 py-1.5 text-[12px] text-muted transition-colors hover:border-[color:var(--accent-55)] hover:text-foreground hover:bg-[color:var(--accent-14)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-55)]"
                style={{ background: "var(--accent-08)" }}
              >
                <ImageIcon size={12} className="opacity-70 transition-opacity group-hover:opacity-100" />
                还没有凭证，
                <span className="font-medium text-foreground underline decoration-dotted underline-offset-2">
                  去「设置 → 凭证」添加
                </span>
                <Sparkles size={11} className="opacity-60" />
              </button>
            ) : (
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
            )
          )}

          {/* textarea */}
          <div className="relative">
            <label htmlFor={promptId} className="sr-only">
              生成提示词
            </label>
            <textarea
              ref={promptTextareaRef}
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

          <CreationParamsBar
            className="mt-3"
            stackActionOnDesktop={hasSplit}
            size={size}
            onSizeChange={setSize}
            sizeOptions={POPULAR_SIZE_OPTIONS}
            sizeInvalid={!sizeValidation.ok}
            quality={quality}
            onQualityChange={setQuality}
            qualityOptions={QUALITY_CHIP_OPTIONS}
            format={format}
            onFormatChange={setFormat}
            formatOptions={FORMAT_OPTIONS}
            count={String(n)}
            onCountChange={(value) => setN(Number(value) || 1)}
            countOptions={COUNT_OPTIONS}
            countDisabled={!supportsMultipleOutputs}
            countInvalid={supportsMultipleOutputs && !outputCountValidation.ok}
            action={
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
                  className="relative inline-flex h-11 w-full items-center justify-center gap-1.5 overflow-hidden rounded-full px-4 text-[14px] font-semibold text-foreground transition-[background,transform,opacity] hover:opacity-95 active:translate-y-[0.5px] disabled:cursor-not-allowed"
                  style={
                    submitDisabled
                      ? {
                          // Disabled: drop the accent gradient so the
                          // button doesn't dissolve into the liquid
                          // background. Neutral surface keeps a clear
                          // edge in dark + busy preset combinations.
                          background: "var(--w-06)",
                          border: "1px solid var(--w-12)",
                          boxShadow: "none",
                          color: "var(--text-faint)",
                        }
                      : {
                          backgroundImage: "var(--accent-gradient-fill)",
                          border: "1px solid var(--accent-50)",
                          boxShadow: "var(--shadow-accent-glow)",
                        }
                  }
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
            }
          />
        </motion.section>

        {/* Inline result gallery — closes the prompt → result loop on the
            same screen. Renders whenever there's anything to show
            (completed work OR in-flight placeholders) so the user sees
            their submission immediately, not after the API returns. */}
        {(recentCompleted.length > 0 || pendingPlaceholders.length > 0) && (
          <motion.section
            initial={reducedMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: reducedMotion ? 0 : 0.46,
              delay: reducedMotion ? 0 : 0.14,
              ease: [0.22, 1, 0.36, 1],
            }}
            aria-label="最近的作品"
            className={cn(
              "mt-6 w-full max-w-[640px]",
              // Split mode: right column, top-aligned with the form,
              // wider visual since the column is the larger of the two.
              hasSplit &&
                "xl:col-start-2 xl:row-start-2 xl:mt-0 xl:max-w-none xl:self-start",
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
                  />
                ) : (
                  <RecentWorkTile
                    job={data.job}
                    outputIndex={data.outputIndex}
                    path={data.path}
                    url={data.url}
                    promptText={data.promptText}
                    onOpenJob={onOpenJob}
                    onSendToEdit={() => {
                      sendImageToEdit({
                        jobId: data.job.id,
                        outputIndex: data.outputIndex,
                        path: data.path,
                        url: data.url,
                      });
                      onOpenEdit?.();
                    }}
                  />
                )
              }
            />
          </motion.section>
        )}

        {/* Queue chip — spans both columns in split mode and centers
            itself; in default mode it's part of the centered stack.
            Hidden when there's nothing to look at: an empty queue chip
            on the empty hero just duplicates the "任务" tab badge while
            adding zero information. Re-emerges the moment a job is
            queued or completed. */}
        {queueCount > 0 && (
          <div
            className={cn(
              "mt-7 flex items-center gap-2 animate-fade-up",
              hasSplit && "xl:col-span-2 xl:justify-self-center xl:mt-4",
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
        )}
      </div>
    </div>
  );
}
