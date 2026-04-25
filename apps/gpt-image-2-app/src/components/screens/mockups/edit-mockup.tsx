import {
  ArrowLeft,
  Undo2,
  Redo2,
  Brush,
  Wand2,
  Eraser,
  Square,
  GitCompare,
  Download,
  Image as ImageIcon,
  LayoutGrid,
  MoreHorizontal,
  Sparkles,
} from "lucide-react";
import { LiquidShell } from "./_shared/liquid-shell";
import { GlassButton, GlassPanel, GlassTextarea } from "./_shared/glass";

const TOOLS = [
  { id: "brush", icon: Brush, active: false },
  { id: "wand", icon: Wand2, active: true },
  { id: "eraser", icon: Eraser, active: false },
  { id: "marquee", icon: Square, active: false },
];

export function EditMockup() {
  return (
    <LiquidShell preset="graphite">
      {/* top toolbar */}
      <div className="absolute top-3 left-4 right-4 z-10 flex items-center gap-2">
        <GlassButton variant="ghost" size="sm" iconLeft={<ArrowLeft size={14} />}>
          返回
        </GlassButton>
        <div className="flex-1" />

        <div className="glass-panel inline-flex items-center gap-0.5 px-1 py-1 !rounded-full !shadow-none">
          <button className="h-7 w-7 inline-flex items-center justify-center rounded-full text-on-glass-mute hover:text-on-glass hover:bg-white/[.08] transition-colors">
            <Undo2 size={13} />
          </button>
          <button className="h-7 w-7 inline-flex items-center justify-center rounded-full text-on-glass-mute hover:text-on-glass hover:bg-white/[.08] transition-colors">
            <Redo2 size={13} />
          </button>
        </div>

        <div className="glass-panel inline-flex items-center gap-1 px-1 py-1 !rounded-full !shadow-none">
          <button className="h-7 w-7 inline-flex items-center justify-center rounded-full text-on-glass-mute hover:text-on-glass hover:bg-white/[.08] transition-colors">
            <ImageIcon size={13} />
          </button>
          <span className="px-2 text-[12px] font-mono text-on-glass-mute">100%</span>
          <button className="h-7 w-7 inline-flex items-center justify-center rounded-full text-on-glass-mute hover:text-on-glass hover:bg-white/[.08] transition-colors">
            <GitCompare size={13} />
          </button>
          <button className="h-7 w-7 inline-flex items-center justify-center rounded-full text-on-glass-mute hover:text-on-glass hover:bg-white/[.08] transition-colors">
            <LayoutGrid size={13} />
          </button>
          <button className="h-7 w-7 inline-flex items-center justify-center rounded-full text-on-glass-mute hover:text-on-glass hover:bg-white/[.08] transition-colors">
            <MoreHorizontal size={13} />
          </button>
        </div>
      </div>

      {/* main grid */}
      <div className="relative h-full w-full pt-16 pb-4 px-4 grid grid-cols-[260px_minmax(0,1fr)] gap-4">
        {/* left panel */}
        <GlassPanel variant="strong" className="flex flex-col p-4 gap-4 overflow-hidden">
          <div>
            <div className="text-[13px] font-semibold text-on-glass">编辑图像</div>
          </div>

          {/* current image thumb */}
          <div>
            <div className="text-[10.5px] uppercase tracking-wider text-on-glass-faint mb-2">
              当前图像
            </div>
            <div className="tile-arch h-20 w-full rounded-md ring-1 ring-white/[.10]" />
          </div>

          {/* brush tools */}
          <div>
            <div className="text-[10.5px] uppercase tracking-wider text-on-glass-faint mb-2">
              画笔工具
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {TOOLS.map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    className={
                      t.active
                        ? "h-9 w-full inline-flex items-center justify-center rounded-md bg-white/[.10] border border-white/[.18] text-on-glass"
                        : "h-9 w-full inline-flex items-center justify-center rounded-md border border-transparent bg-white/[.03] text-on-glass-mute hover:bg-white/[.07] hover:text-on-glass transition-colors"
                    }
                  >
                    <Icon size={14} />
                  </button>
                );
              })}
            </div>
          </div>

          {/* brush size */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10.5px] uppercase tracking-wider text-on-glass-faint">
                画笔大小
              </div>
              <div className="text-[11.5px] font-mono text-on-glass">40</div>
            </div>
            <div className="relative h-1.5 rounded-full bg-white/[.08]">
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: "55%",
                  background:
                    "linear-gradient(90deg, rgba(167,139,250,.85), rgba(103,232,249,.75))",
                }}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-3 w-3 rounded-full bg-white shadow-md"
                style={{ left: "55%" }}
              />
            </div>
          </div>

          {/* prompt */}
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="text-[10.5px] uppercase tracking-wider text-on-glass-faint mb-2">
              编辑提示词
            </div>
            <GlassTextarea
              rows={3}
              defaultValue="将左侧区域的建筑改为夜景效果"
              className="flex-1"
            />
          </div>

          {/* apply */}
          <GlassButton variant="primary" size="lg" iconRight={<Sparkles size={15} />}>
            应用修改
          </GlassButton>
        </GlassPanel>

        {/* canvas */}
        <div className="relative">
          <GlassPanel
            variant="deep"
            className="h-full w-full overflow-hidden flex items-center justify-center"
          >
            <div className="tile-arch absolute inset-3 rounded-[14px]" />
            {/* fake selection */}
            <div
              className="dashed-selection absolute"
              style={{
                left: "18%",
                top: "30%",
                width: "32%",
                height: "55%",
                animation: "dashed-rotate 14s linear infinite",
              }}
            />
            {/* bottom action chips */}
            <div className="absolute left-0 right-0 bottom-5 flex items-center justify-center gap-3 z-10">
              <GlassButton iconLeft={<GitCompare size={14} />}>对比</GlassButton>
              <GlassButton iconLeft={<Download size={14} />}>下载</GlassButton>
            </div>
          </GlassPanel>
        </div>
      </div>

      {/* selection rotate keyframes (inline so we don't pollute global css) */}
      <style>{`
        @keyframes dashed-rotate {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </LiquidShell>
  );
}
