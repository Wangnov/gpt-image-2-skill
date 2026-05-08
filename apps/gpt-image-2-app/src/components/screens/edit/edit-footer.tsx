import { type RefObject } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Icon } from "@/components/icon";
import { CreationParamsBar } from "@/components/screens/shared/creation-params-bar";
import { PromptTemplatePicker } from "@/components/screens/shared/prompt-template-picker";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import {
  POPULAR_SIZE_OPTIONS,
  QUALITY_OPTIONS,
  type validateImageSize,
  type validateOutputCount,
} from "@/lib/image-options";
import { COUNT_OPTIONS, FORMAT_OPTIONS, type EditOutput } from "./shared";
import { OutputDrawer } from "./output-drawer";
import type { runtimeCopy } from "@/lib/runtime-copy";

type SizeValidation = ReturnType<typeof validateImageSize>;
type OutputCountValidation = ReturnType<typeof validateOutputCount>;
type RuntimeCopy = ReturnType<typeof runtimeCopy>;

export function EditFooter({
  runError,
  runNotice,
  isWorking,
  handleRun,
  showOutputsLauncher,
  outputsDrawerOpen,
  setOutputsDrawerOpen,
  displayN,
  outputs,
  hasOutputs,
  copy,
  saveSelected,
  saveAll,
  selectedPath,
  jobId,
  prompt,
  setSelectedOutput,
  promptId,
  usesRegion,
  insertPromptTemplate,
  promptTextareaRef,
  setPrompt,
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
  submitDisabled,
  isSubmitting,
  isTracking,
}: {
  runError: string | null;
  runNotice: string | null;
  isWorking: boolean;
  handleRun: () => void;
  showOutputsLauncher: boolean;
  outputsDrawerOpen: boolean;
  setOutputsDrawerOpen: (open: boolean) => void;
  displayN: number;
  outputs: EditOutput[];
  hasOutputs: boolean;
  copy: RuntimeCopy;
  saveSelected: () => void;
  saveAll: () => void;
  selectedPath?: string;
  jobId: string | null;
  prompt: string;
  setSelectedOutput: (index: number) => void;
  promptId: string;
  usesRegion: boolean;
  insertPromptTemplate: (text: string) => void;
  promptTextareaRef: RefObject<HTMLTextAreaElement | null>;
  setPrompt: (prompt: string) => void;
  size: string;
  setSize: (size: string) => void;
  sizeValidation: SizeValidation;
  quality: string;
  setQuality: (quality: string) => void;
  format: string;
  setFormat: (format: string) => void;
  n: number;
  setN: (count: number) => void;
  supportsMultipleOutputs: boolean;
  outputCountValidation: OutputCountValidation;
  submitDisabled: boolean;
  isSubmitting: boolean;
  isTracking: boolean;
}) {
  return (
    <footer className="relative shrink-0 px-4 pb-3 space-y-2">
      {runError && !isWorking && (
        <div className="surface-panel flex items-center gap-2 px-3 py-2 border border-[color:var(--status-err)]/40 animate-fade-up">
          <Icon name="warn" size={13} style={{ color: "var(--status-err)" }} />
          <span
            className="text-[12px] flex-1"
            style={{ color: "var(--status-err)" }}
          >
            {runError}
          </span>
          <Button variant="ghost" size="sm" icon="reload" onClick={handleRun}>
            重试
          </Button>
        </div>
      )}

      {runNotice && !isWorking && (
        <div className="surface-panel px-3 py-1.5 text-[11.5px] leading-relaxed text-muted animate-fade-up">
          {runNotice} 已保留收到的图片；如果需要补齐，可以点「应用」重试。
        </div>
      )}

      {showOutputsLauncher && (
        <OutputDrawer
          open={outputsDrawerOpen}
          onOpenChange={setOutputsDrawerOpen}
          isWorking={isWorking}
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
        />
      )}

      <div className="surface-panel p-2.5">
        <div className="flex items-center gap-2 mb-1.5">
          <FieldLabel htmlFor={promptId}>
            {usesRegion ? "目标图选区里要变成什么" : "提示词"}
          </FieldLabel>
          <div className="flex-1" />
          <PromptTemplatePicker
            scope={usesRegion ? "region" : "edit"}
            onInsert={insertPromptTemplate}
          />
          <span className="text-[10.5px] font-mono text-faint">
            {prompt.length} / 4000
          </span>
        </div>
        <Textarea
          ref={promptTextareaRef}
          id={promptId}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          minHeight={104}
          maxLength={4000}
          placeholder={
            usesRegion
              ? "描述目标图选区里要变成什么..."
              : "描述如何参考这些图片进行编辑..."
          }
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              handleRun();
            }
          }}
        />
        <CreationParamsBar
          size={size}
          onSizeChange={setSize}
          sizeOptions={POPULAR_SIZE_OPTIONS}
          sizeInvalid={!sizeValidation.ok}
          quality={quality}
          onQualityChange={setQuality}
          qualityOptions={QUALITY_OPTIONS}
          format={format}
          onFormatChange={setFormat}
          formatOptions={FORMAT_OPTIONS}
          count={String(n)}
          onCountChange={(value) => setN(Number(value) || 1)}
          countOptions={COUNT_OPTIONS}
          countDisabled={!supportsMultipleOutputs}
          countInvalid={supportsMultipleOutputs && !outputCountValidation.ok}
          action={
            <button
              type="button"
              onClick={handleRun}
              disabled={submitDisabled}
              className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-full px-5 text-[13px] font-semibold text-foreground transition-[background,opacity,transform] hover:opacity-95 active:translate-y-[0.5px] disabled:cursor-not-allowed disabled:opacity-45"
              style={{
                backgroundImage: "var(--accent-gradient-fill)",
                border: "1px solid var(--accent-50)",
                boxShadow: "var(--shadow-accent-glow)",
              }}
            >
              {isSubmitting ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Sparkles size={13} />
              )}
              {isSubmitting ? "提交中…" : isTracking ? "再提交" : "应用"}
            </button>
          }
        />
      </div>
    </footer>
  );
}
