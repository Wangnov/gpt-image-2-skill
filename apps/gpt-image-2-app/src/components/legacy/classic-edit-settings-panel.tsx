import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { GlassCombobox } from "@/components/ui/combobox";
import { GlassSelect } from "@/components/ui/select";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import {
  COUNT_OPTIONS,
  FORMAT_OPTIONS,
  regionModeLabel,
  type EditMode,
  type EditRegionMode,
} from "@/components/screens/edit/shared";
import { POPULAR_SIZE_OPTIONS, QUALITY_OPTIONS } from "@/lib/image-options";
import type { MaskMode } from "@/components/screens/edit/mask-canvas";
import type {
  OutputCountValidation,
  SizeValidation,
} from "./classic-edit-shared";
import { regionModeHint } from "./classic-edit-shared";

export function ClassicEditSettingsPanel({
  brushSize,
  displayN,
  editMode,
  editRegionMode,
  format,
  handleRun,
  isSubmitting,
  maskMode,
  n,
  outputCountValidation,
  prompt,
  provider,
  providerNames,
  quality,
  regionUnavailable,
  runError,
  runNotice,
  setBrushSize,
  setClearKey,
  setEditMode,
  setFormat,
  setMaskMode,
  setN,
  setPrompt,
  setProvider,
  setQuality,
  setRunError,
  setRunNotice,
  setSize,
  setUserSelectedProvider,
  size,
  sizeValidation,
  submitDisabled,
  supportsMultipleOutputs,
  usesRegion,
}: {
  brushSize: number;
  displayN: number;
  editMode: EditMode;
  editRegionMode: EditRegionMode;
  format: string;
  handleRun: () => void;
  isSubmitting: boolean;
  maskMode: MaskMode;
  n: number;
  outputCountValidation: OutputCountValidation;
  prompt: string;
  provider: string;
  providerNames: string[];
  quality: string;
  regionUnavailable: boolean;
  runError: string | null;
  runNotice: string | null;
  setBrushSize: (value: number) => void;
  setClearKey: (updater: (key: number) => number) => void;
  setEditMode: (value: EditMode) => void;
  setFormat: (value: string) => void;
  setMaskMode: (value: MaskMode) => void;
  setN: (value: number) => void;
  setPrompt: (value: string) => void;
  setProvider: (value: string) => void;
  setQuality: (value: string) => void;
  setRunError: (value: string | null) => void;
  setRunNotice: (value: string | null) => void;
  setSize: (value: string) => void;
  setUserSelectedProvider: (value: boolean) => void;
  size: string;
  sizeValidation: SizeValidation;
  submitDisabled: boolean;
  supportsMultipleOutputs: boolean;
  usesRegion: boolean;
}) {
  return (
    <section className="edit-settings surface-panel min-h-0 overflow-auto p-3">
      <div className="mb-3 flex items-center gap-2">
        <Segmented
          value={editMode}
          onChange={(mode) => {
            setEditMode(mode);
            setRunError(null);
            setRunNotice(null);
          }}
          size="sm"
          ariaLabel="编辑模式"
          options={[
            { value: "reference", label: "多图参考", icon: "image" },
            { value: "region", label: "局部编辑", icon: "mask" },
          ]}
        />
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
      {runNotice && (
        <div className="mb-3 rounded-md border border-border bg-sunken px-3 py-2 text-[12px] text-muted">
          {runNotice}
        </div>
      )}

      <Field label="提示词">
        <Textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="描述如何编辑这些图片..."
          minHeight={96}
        />
      </Field>

      <Field label="凭证">
        <GlassSelect
          value={provider}
          onValueChange={(value) => {
            setUserSelectedProvider(true);
            setProvider(value);
          }}
          options={providerNames.map((name) => ({
            value: name,
            label: name,
          }))}
          disabled={providerNames.length === 0}
          placeholder="（无可用凭证）"
        />
      </Field>

      <Field
        label="尺寸"
        error={!sizeValidation.ok ? sizeValidation.message : undefined}
      >
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
            !outputCountValidation.ok ? outputCountValidation.message : undefined
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

      {usesRegion && (
        <div className="mb-3 rounded-md border border-border bg-sunken p-2.5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="t-caps">遮罩</div>
            <span className="text-[11px] text-faint">
              {regionModeLabel(editRegionMode)}
            </span>
          </div>
          <Segmented
            value={maskMode}
            onChange={setMaskMode}
            size="sm"
            ariaLabel="涂抹模式"
            options={[
              { value: "paint", label: "绘制", icon: "brush" },
              { value: "erase", label: "擦除", icon: "eraser" },
            ]}
          />
          <label className="mt-2 flex items-center gap-2 text-[11px] text-muted">
            <span className="shrink-0">笔刷</span>
            <input
              type="range"
              min={8}
              max={80}
              value={brushSize}
              onChange={(event) => setBrushSize(Number(event.target.value))}
              className="min-w-0 flex-1 accent-[color:var(--accent)]"
            />
            <span className="w-8 text-right font-mono">{brushSize}</span>
          </label>
          <div className="mt-2 text-[11px] leading-relaxed text-muted">
            {regionModeHint(editRegionMode)}
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon="trash"
            onClick={() => setClearKey((key) => key + 1)}
            className="mt-2"
          >
            清除选区
          </Button>
        </div>
      )}

      <Button
        variant="primary"
        size="lg"
        icon={isSubmitting ? "reload" : "sparkle"}
        disabled={submitDisabled}
        onClick={handleRun}
        className="w-full justify-center"
      >
        {isSubmitting ? "提交中" : "应用编辑"}
      </Button>
      <div className="mt-2 text-[11px] text-faint">
        {regionUnavailable
          ? regionModeHint(editRegionMode)
          : supportsMultipleOutputs
            ? `计划输出 ${displayN} 张`
            : "当前凭证只输出 1 张"}
      </div>
    </section>
  );
}
