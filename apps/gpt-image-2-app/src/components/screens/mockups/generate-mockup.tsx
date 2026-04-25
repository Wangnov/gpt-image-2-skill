import { Sparkles, Settings2, ListChecks, Image as ImageIcon } from "lucide-react";
import GradientText from "@/components/reactbits/text/GradientText";
import ShinyText from "@/components/reactbits/text/ShinyText";
import { LiquidShell } from "./_shared/liquid-shell";
import {
  GlassButton,
  GlassChip,
  GlassPanel,
  GlassSelect,
  GlassTextarea,
  StatusDot,
} from "./_shared/glass";

export function GenerateMockup() {
  return (
    <LiquidShell preset="violet">
      {/* top-right toolbar */}
      <div className="absolute top-4 right-5 z-10 flex items-center gap-2">
        <div className="glass-chip cursor-pointer">
          <StatusDot variant="ok" />
          <span className="text-on-glass">OpenAI</span>
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" className="opacity-60">
            <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <GlassButton variant="ghost" size="icon" aria-label="设置">
          <Settings2 size={16} className="opacity-80" />
        </GlassButton>
      </div>

      {/* top-left brand chip */}
      <div className="absolute top-4 left-5 z-10">
        <div className="glass-chip">
          <span className="text-on-glass-soft">GPT Image 2</span>
        </div>
      </div>

      {/* hero + form column */}
      <div className="relative h-full w-full px-10 pb-12 pt-24 flex flex-col items-center justify-center">
        {/* hero */}
        <div className="flex flex-col items-center text-center">
          <div className="flex items-baseline gap-3 text-[52px] font-semibold leading-none tracking-tight">
            <span className="text-on-glass">GPT</span>
            <GradientText
              colors={["#a78bfa", "#67e8f9", "#f0abfc", "#a78bfa"]}
              animationSpeed={6}
              className="!mx-0 !rounded-none"
            >
              <span className="px-1">Image</span>
            </GradientText>
            <span className="text-on-glass">2</span>
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

        {/* form panel */}
        <GlassPanel
          variant="strong"
          className="mt-9 w-full max-w-[640px] p-5"
        >
          {/* tabs */}
          <div className="flex items-center gap-1 -mt-1 mb-3">
            <button className="relative px-3 py-1.5 text-[13px] font-semibold text-on-glass">
              生成
              <span className="absolute -bottom-px left-2 right-2 h-px bg-white" />
            </button>
            <button className="px-3 py-1.5 text-[13px] text-on-glass-mute hover:text-on-glass transition-colors">
              编辑
            </button>
          </div>

          {/* textarea */}
          <div className="relative">
            <GlassTextarea
              rows={3}
              placeholder="描述你想要生成的图像..."
              defaultValue=""
              className="pr-10"
            />
            <button
              type="button"
              aria-label="添加图片"
              className="absolute right-2.5 bottom-2.5 h-7 w-7 inline-flex items-center justify-center rounded-md text-on-glass-faint hover:text-on-glass hover:bg-white/[.06] transition-colors"
            >
              <ImageIcon size={15} />
            </button>
          </div>

          {/* parameter row */}
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <GlassSelect label="模型" value="GPT-image-2" />
            <GlassSelect label="比例" value="16:9" />
            <GlassSelect label="质量" value="标准" />
            <GlassSelect label="风格" value="自动" />
            <div className="flex-1" />
            <GlassButton variant="primary" size="lg" iconRight={<Sparkles size={15} />}>
              生成
            </GlassButton>
          </div>
        </GlassPanel>

        {/* queue chip */}
        <button
          type="button"
          className="glass-chip mt-7 hover:bg-white/[.10] transition-colors"
        >
          <ListChecks size={13} className="opacity-80" />
          <span>查看队列 (4)</span>
        </button>
      </div>
    </LiquidShell>
  );
}
