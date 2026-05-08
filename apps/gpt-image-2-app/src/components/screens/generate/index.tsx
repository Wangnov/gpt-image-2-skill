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
} from "lucide-react";
import { motion } from "motion/react";
import GradientText from "@/components/reactbits/text/GradientText";
import ShinyText from "@/components/reactbits/text/ShinyText";
import logoUrl from "@/assets/logo.png";
import { useTweaks } from "@/hooks/use-tweaks";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { THEME_PRESETS } from "@/lib/theme-presets";
import { loadGenerateDraft, saveGenerateDraft } from "@/lib/drafts";
import { useCreateGenerate } from "@/hooks/use-jobs";
import { useJobEvents } from "@/hooks/use-job-events";
import { isActiveJobStatus } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { insertPromptAtCursor } from "@/lib/prompt-templates";
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
  providerNames as readProviderNames,
  reconcileProviderSelection,
} from "@/lib/providers";
import type { ServerConfig } from "@/lib/types";
import { GenerateForm } from "./generate-form";
import { RecentGallery } from "./recent-gallery";
import { useGenerateGallery } from "./use-generate-gallery";

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
  const { galleryItems, hasSplit, pendingCount, queueCount, recentCount } =
    useGenerateGallery();
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
    const nextProvider = reconcileProviderSelection(config, provider);
    if (provider !== nextProvider) setProvider(nextProvider);
  }, [config, provider]);

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
        Boolean(res.job && isActiveJobStatus(res.job.status));
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

        <GenerateForm
          reducedMotion={reducedMotion}
          hasSplit={hasSplit}
          onOpenEdit={onOpenEdit}
          onOpenSettings={onOpenSettings}
          insertPromptTemplate={insertPromptTemplate}
          runError={runError}
          setRunError={setRunError}
          isWorking={isWorking}
          noProviders={noProviders}
          promptId={promptId}
          promptTextareaRef={promptTextareaRef}
          prompt={prompt}
          setPrompt={setPrompt}
          handleRun={handleRun}
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
          accentHex={accentHex}
          setPulseKey={setPulseKey}
          submitDisabled={submitDisabled}
          isSubmitting={isSubmitting}
          isTracking={isTracking}
          pendingOutputCount={pendingOutputCount}
          pulseKey={pulseKey}
        />

        <RecentGallery
          reducedMotion={reducedMotion}
          hasSplit={hasSplit}
          recentCount={recentCount}
          pendingCount={pendingCount}
          onOpenHistory={onOpenHistory}
          onOpenJob={onOpenJob}
          onOpenEdit={onOpenEdit}
          galleryItems={galleryItems}
        />

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
