import { type RefObject } from "react";
import { Image as ImageIcon, Sparkles, X } from "lucide-react";
import { motion } from "motion/react";
import ClickSpark from "@/components/reactbits/components/ClickSpark";
import { CreationParamsBar } from "@/components/screens/shared/creation-params-bar";
import { PromptTemplatePicker } from "@/components/screens/shared/prompt-template-picker";
import { cn } from "@/lib/cn";
import {
  POPULAR_SIZE_OPTIONS,
  type validateImageSize,
  type validateOutputCount,
} from "@/lib/image-options";
import {
  COUNT_OPTIONS,
  FORMAT_OPTIONS,
  QUALITY_CHIP_OPTIONS,
} from "./shared";

type SizeValidation = ReturnType<typeof validateImageSize>;
type OutputCountValidation = ReturnType<typeof validateOutputCount>;

export function GenerateForm({
  reducedMotion,
  hasSplit,
  onOpenEdit,
  onOpenSettings,
  insertPromptTemplate,
  runError,
  setRunError,
  isWorking,
  noProviders,
  promptId,
  promptTextareaRef,
  prompt,
  setPrompt,
  handleRun,
  size,
  setSize,
  sizeValidation,
  quality,
  setQuality,
  format,
  setFormat,
  n,
  setN,
  supportsMultipleOutputs,
  outputCountValidation,
  accentHex,
  setPulseKey,
  submitDisabled,
  isSubmitting,
  isTracking,
  pendingOutputCount,
  pulseKey,
}: {
  reducedMotion: boolean;
  hasSplit: boolean;
  onOpenEdit?: () => void;
  onOpenSettings?: () => void;
  insertPromptTemplate: (text: string) => void;
  runError: string | null;
  setRunError: (value: string | null) => void;
  isWorking: boolean;
  noProviders: boolean;
  promptId: string;
  promptTextareaRef: RefObject<HTMLTextAreaElement | null>;
  prompt: string;
  setPrompt: (value: string) => void;
  handleRun: () => void;
  size: string;
  setSize: (value: string) => void;
  sizeValidation: SizeValidation;
  quality: string;
  setQuality: (value: string) => void;
  format: string;
  setFormat: (value: string) => void;
  n: number;
  setN: (value: number) => void;
  supportsMultipleOutputs: boolean;
  outputCountValidation: OutputCountValidation;
  accentHex: string;
  setPulseKey: (value: number | ((current: number) => number)) => void;
  submitDisabled: boolean;
  isSubmitting: boolean;
  isTracking: boolean;
  pendingOutputCount: number | null;
  pulseKey: number;
}) {
  return (
    <motion.section
      initial={reducedMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      // FLIP layout: when hasSplit flips at xl, the form re-anchors
      // from a centered max-w-[640px] block to the left grid column.
      // motion.section animates that transition with transform-only,
      // so the panel slides + resizes smoothly instead of snapping
      // when the first job lands. Gated off when reducedMotion is on.
      layout={reducedMotion ? false : "position"}
      transition={{
        duration: reducedMotion ? 0 : 0.42,
        delay: reducedMotion ? 0 : 0.08,
        ease: [0.22, 1, 0.36, 1],
        layout: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
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
        <PromptTemplatePicker scope="generate" onInsert={insertPromptTemplate} />
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

      {noProviders &&
        !runError &&
        (onOpenSettings ? (
          <button
            type="button"
            onClick={onOpenSettings}
            className="group mb-3 inline-flex items-center gap-2 rounded-md border border-[color:var(--accent-30)] px-3 py-1.5 text-[12px] text-muted transition-colors hover:border-[color:var(--accent-55)] hover:text-foreground hover:bg-[color:var(--accent-14)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-55)]"
            style={{ background: "var(--accent-08)" }}
          >
            <ImageIcon
              size={12}
              className="opacity-70 transition-opacity group-hover:opacity-100"
            />
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
        ))}

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
                setPulseKey((current) => current + 1);
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
  );
}
