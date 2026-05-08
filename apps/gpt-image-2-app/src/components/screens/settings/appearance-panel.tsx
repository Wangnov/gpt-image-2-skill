import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import ElasticSlider from "@/components/reactbits/components/ElasticSlider";
import { Segmented } from "@/components/ui/segmented";
import { useTweaks } from "@/hooks/use-tweaks";
import { cn } from "@/lib/cn";
import {
  HIDDEN_PRESETS,
  THEME_PRESETS,
  readUnlockedPresets,
  type ThemePreset,
  type ThemePresetId,
} from "@/lib/theme-presets";
import {
  DENSITY_LABEL,
  FONT_LABEL,
  PRESET_ORDER,
  UNLOCK_EVENT,
} from "./constants";
import { Row, Section } from "./layout";

function ThemePreviewCard({
  preset,
  isActive,
  onSelect,
}: {
  preset: ThemePreset;
  isActive: boolean;
  onSelect: () => void;
}) {
  // Mini gradient preview is built from the preset's RGB triplets so
  // the card itself uses the colors it would apply when selected.
  // Three color dots mirror the accent / accent-2 / accent-3 swatches
  // that drive the alpha ramps in index.css.
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isActive}
      title={preset.description}
      className={cn(
        "group relative h-[88px] rounded-lg overflow-hidden text-left transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]",
        isActive
          ? "ring-2 ring-[color:var(--accent)] shadow-[0_0_24px_-6px_rgba(var(--accent-rgb),0.55)]"
          : "ring-1 ring-[color:var(--w-10)] hover:ring-[color:var(--w-20)] hover:scale-[1.015]",
      )}
    >
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background: `linear-gradient(135deg, rgba(${preset.accentRgb}, 0.42) 0%, rgba(${preset.accent2Rgb}, 0.36) 60%, rgba(${preset.accent3Rgb}, 0.30) 100%)`,
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0 opacity-30 mix-blend-overlay"
        style={{
          background:
            "radial-gradient(80% 60% at 50% 0%, rgba(255,255,255,0.18) 0%, transparent 70%)",
        }}
      />
      <div className="relative flex h-full flex-col justify-between p-2">
        <div className="flex items-center gap-1">
          {[preset.accentRgb, preset.accent2Rgb, preset.accent3Rgb].map(
            (rgb, i) => (
              <span
                key={i}
                className="h-2.5 w-2.5 rounded-full"
                style={{
                  background: `rgb(${rgb})`,
                  boxShadow: `0 0 6px rgba(${rgb}, 0.6)`,
                }}
              />
            ),
          )}
          <span className="ml-auto t-mono text-[9.5px] text-foreground/85">
            Aa
          </span>
        </div>
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-foreground truncate">
            {preset.displayName}
          </div>
          <div className="mt-0.5 text-[10px] text-foreground/60 truncate">
            {preset.description}
          </div>
        </div>
      </div>
      {isActive && (
        <span
          className="absolute top-1.5 right-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full"
          style={{ background: "var(--accent)" }}
          aria-label="当前主题"
        >
          <Check size={10} className="text-[color:var(--accent-on)]" />
        </span>
      )}
    </button>
  );
}

export function AppearancePanel() {
  const { tweaks, setTweaks } = useTweaks();
  const [unlocked, setUnlocked] = useState<Set<ThemePresetId>>(() =>
    readUnlockedPresets(),
  );

  // Stay in sync with localStorage when AboutPanel unlocks a hidden
  // preset. Custom event keeps both panels coordinated without
  // lifting state into TweaksContext.
  useEffect(() => {
    const refresh = () => setUnlocked(readUnlockedPresets());
    window.addEventListener(UNLOCK_EVENT, refresh);
    return () => window.removeEventListener(UNLOCK_EVENT, refresh);
  }, []);

  const visibleIds: ThemePresetId[] = [
    ...PRESET_ORDER,
    ...HIDDEN_PRESETS.filter((id) => unlocked.has(id)),
  ];
  const activePreset = THEME_PRESETS[tweaks.themePreset];
  const modernInterface = tweaks.interfaceMode === "modern";

  const opacityHint =
    activePreset.surfaceStyle === "paper"
      ? "纸感主题下用作描边强度。值越高边线越清晰。"
      : activePreset.surfaceStyle === "neon"
        ? "霓虹主题下用作发光强度。值越高边光越明显。"
        : "玻璃面板的不透明度。值越低背景越能透出，值越高内容越易读。";

  return (
    <div className="flex-1 min-h-0 overflow-auto p-4 sm:p-5 space-y-4">
      <Section title="主题">
        <Row
          title="界面版本"
          description={
            tweaks.interfaceMode === "legacy"
              ? "经典三栏会复用旧工作台外观，并禁用常驻动态背景以降低资源占用。"
              : "现代界面使用主题背景、玻璃胶囊和作品墙；适合视觉调试。"
          }
          control={
            <Segmented
              value={tweaks.interfaceMode}
              onChange={(interfaceMode) => setTweaks({ interfaceMode })}
              size="sm"
              ariaLabel="界面版本"
              options={[
                { value: "modern", label: "现代" },
                { value: "legacy", label: "经典" },
              ]}
            />
          }
        />
        {modernInterface ? (
          <>
            <div className="space-y-2.5 px-4 py-3.5 sm:px-5">
              <div>
                <div className="text-[13px] font-semibold text-foreground">
                  主题预设
                </div>
                <div className="mt-0.5 text-[11.5px] text-muted">
                  一键切换背景动效、配色、面板风格；字体和密度也会跟着调到主题推荐值。想禁用所有动效，切到「网格灰」或在
                  macOS 辅助功能里开启「减弱动态效果」。
                </div>
              </div>
              <div
                className={cn(
                  "grid gap-2",
                  visibleIds.length <= 4
                    ? "grid-cols-2 lg:grid-cols-4"
                    : "grid-cols-2 lg:grid-cols-5",
                )}
              >
                {visibleIds.map((id) => (
                  <ThemePreviewCard
                    key={id}
                    preset={THEME_PRESETS[id]}
                    isActive={tweaks.themePreset === id}
                    onSelect={() => setTweaks({ themePreset: id })}
                  />
                ))}
              </div>
            </div>
            <Row
              title="面板透明度"
              description={opacityHint}
              control={
                <div className="w-[252px]">
                  <ElasticSlider
                    value={tweaks.glassOpacity}
                    min={5}
                    max={95}
                    step={1}
                    onChange={(glassOpacity) => setTweaks({ glassOpacity })}
                    valueSuffix="%"
                    ariaLabel="面板透明度"
                  />
                </div>
              }
            />
          </>
        ) : (
          <Row
            title="亮暗主题"
            description="只影响经典工作台；现代界面的主题仍由主题预设控制。"
            control={
              <Segmented
                value={tweaks.theme}
                onChange={(theme) => setTweaks({ theme })}
                size="sm"
                ariaLabel="经典亮暗主题"
                options={[
                  { value: "dark", label: "暗色" },
                  { value: "light", label: "亮色" },
                ]}
              />
            }
          />
        )}
      </Section>

      <Section
        title="排版"
        description="主题切换会把字体和密度调到推荐值；下面的设置会覆盖推荐。"
      >
        <Row
          title="字体"
          description={`主题推荐：${FONT_LABEL[activePreset.suggestedFont]}。`}
          control={
            <Segmented
              value={tweaks.font}
              onChange={(v) => setTweaks({ font: v })}
              size="sm"
              ariaLabel="字体"
              options={[
                { value: "system", label: "系统" },
                { value: "mono", label: "等宽" },
                { value: "serif", label: "衬线" },
              ]}
            />
          }
        />
        <Row
          title="界面密度"
          description={`主题推荐：${DENSITY_LABEL[activePreset.suggestedDensity]}。`}
          control={
            <Segmented
              value={tweaks.density}
              onChange={(v) => setTweaks({ density: v })}
              size="sm"
              ariaLabel="界面密度"
              options={[
                { value: "compact", label: "紧凑" },
                { value: "comfortable", label: "舒适" },
              ]}
            />
          }
        />
      </Section>
    </div>
  );
}
