import {
  Trash2,
  Plus,
  ExternalLink,
  MoreHorizontal,
  Clock,
  CheckCircle2,
  X,
  Loader2,
} from "lucide-react";
import { LiquidShell } from "./_shared/liquid-shell";
import {
  GlassButton,
  GlassChip,
  GlassDivider,
  GlassPanel,
  GlassProgress,
  StatusDot,
} from "./_shared/glass";

type JobStatus = "ok" | "run" | "queue" | "err";
type Job = {
  id: number;
  prompt: string;
  ratio: string;
  status: JobStatus;
  statusLabel: string;
  rightTop: string;
  rightBottom: string;
  thumbClass: string;
  progress?: number;
};

const JOBS: Job[] = [
  {
    id: 1,
    prompt: "赛博朋克风格的未来城市，雨夜，霓虹灯…",
    ratio: "16:9",
    status: "ok",
    statusLabel: "已完成",
    rightTop: "2024-05-20 14:32",
    rightBottom: "2.1 MB",
    thumbClass: "tile-cyber",
  },
  {
    id: 2,
    prompt: "宁静的山间湖泊，清晨薄雾，远处雪山",
    ratio: "4:3",
    status: "ok",
    statusLabel: "已完成",
    rightTop: "2024-05-20 14:28",
    rightBottom: "1.6 MB",
    thumbClass: "tile-mountain",
  },
  {
    id: 3,
    prompt: "抽象艺术，流动的银色液体质感",
    ratio: "1:1",
    status: "run",
    statusLabel: "进行中 35%",
    rightTop: "预计剩余 00:18",
    rightBottom: "",
    thumbClass: "tile-flow",
    progress: 35,
  },
  {
    id: 4,
    prompt: "可爱的猫咪，戴着宇航员头盔，太空中",
    ratio: "3:2",
    status: "queue",
    statusLabel: "等待中",
    rightTop: "排队中…",
    rightBottom: "",
    thumbClass: "tile-cat",
  },
];

function StatusBadge({ status, label }: { status: JobStatus; label: string }) {
  const Icon =
    status === "ok"
      ? CheckCircle2
      : status === "run"
        ? Loader2
        : status === "err"
          ? X
          : Clock;
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px]">
      <Icon
        size={13}
        className={
          status === "ok"
            ? "text-emerald-300"
            : status === "run"
              ? "text-amber-300 animate-spin"
              : status === "err"
                ? "text-rose-300"
                : "text-slate-300"
        }
      />
      <span
        className={
          status === "ok"
            ? "text-emerald-200"
            : status === "run"
              ? "text-amber-200"
              : status === "err"
                ? "text-rose-200"
                : "text-on-glass-mute"
        }
      >
        {label}
      </span>
    </span>
  );
}

export function HistoryMockup() {
  const filters = [
    { label: "全部", active: true },
    { label: "进行中", active: false },
    { label: "已完成", active: false },
    { label: "失败", active: false },
  ];

  return (
    <LiquidShell preset="midnight">
      <div className="relative h-full w-full px-8 pt-20 pb-8 flex flex-col">
        {/* header */}
        <header className="flex items-end justify-between mb-5">
          <div className="flex items-baseline gap-3">
            <h1 className="text-[26px] font-semibold tracking-tight text-on-glass">
              生成队列
            </h1>
            <span className="inline-flex items-center justify-center min-w-[26px] h-[22px] px-2 rounded-full bg-white/[.08] border border-white/[.10] text-[12px] font-medium text-on-glass">
              4
            </span>
          </div>
          <div className="flex items-center gap-2">
            <GlassButton variant="ghost" size="icon" aria-label="清空">
              <Trash2 size={15} className="opacity-80" />
            </GlassButton>
            <GlassButton iconLeft={<Plus size={15} />}>新建任务</GlassButton>
          </div>
        </header>

        {/* filter tabs */}
        <div className="flex items-center gap-1 mb-4">
          {filters.map((f) => (
            <button
              key={f.label}
              type="button"
              className={
                f.active
                  ? "px-3.5 h-8 rounded-full bg-white/[.10] border border-white/[.12] text-[12.5px] font-medium text-on-glass"
                  : "px-3.5 h-8 rounded-full border border-transparent text-[12.5px] font-medium text-on-glass-mute hover:text-on-glass hover:bg-white/[.04] transition-colors"
              }
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* job list */}
        <GlassPanel
          variant="default"
          className="flex-1 min-h-0 flex flex-col overflow-hidden"
        >
          <div className="flex-1 overflow-auto divide-y divide-white/[.06]">
            {JOBS.map((j) => (
              <div
                key={j.id}
                className="flex items-center gap-4 px-4 py-3 hover:bg-white/[.03] transition-colors"
              >
                {/* index */}
                <span className="w-6 text-center text-[12px] text-on-glass-faint font-mono">
                  {j.id}
                </span>

                {/* thumbnail */}
                <div
                  className={`relative h-14 w-20 shrink-0 rounded-md overflow-hidden ${j.thumbClass} ring-1 ring-white/[.10]`}
                >
                  {j.status === "run" && (
                    <div className="absolute inset-0 backdrop-blur-[2px] bg-black/30 flex items-center justify-center">
                      <Loader2 size={18} className="text-white animate-spin opacity-80" />
                    </div>
                  )}
                  {j.status === "queue" && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <Clock size={16} className="text-white opacity-70" />
                    </div>
                  )}
                </div>

                {/* prompt + meta */}
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-on-glass truncate">
                    {j.prompt}
                  </div>
                  <div className="text-[11px] text-on-glass-faint mt-0.5 font-mono">
                    {j.ratio}
                  </div>
                </div>

                {/* status */}
                <div className="w-[120px] shrink-0">
                  {j.status === "run" ? (
                    <div className="flex flex-col gap-1.5">
                      <StatusBadge status={j.status} label={j.statusLabel} />
                      <GlassProgress value={j.progress ?? 0} />
                    </div>
                  ) : (
                    <StatusBadge status={j.status} label={j.statusLabel} />
                  )}
                </div>

                {/* right text */}
                <div className="w-[120px] shrink-0 text-right">
                  <div className="text-[11.5px] text-on-glass-mute font-mono">
                    {j.rightTop}
                  </div>
                  {j.rightBottom && (
                    <div className="text-[11px] text-on-glass-faint font-mono mt-0.5">
                      {j.rightBottom}
                    </div>
                  )}
                </div>

                {/* actions */}
                <div className="flex items-center gap-0.5">
                  {j.status !== "queue" && j.status !== "run" ? (
                    <button
                      className="h-7 w-7 inline-flex items-center justify-center rounded-md text-on-glass-mute hover:text-on-glass hover:bg-white/[.06] transition-colors"
                      aria-label="打开"
                    >
                      <ExternalLink size={13} />
                    </button>
                  ) : (
                    <button
                      className="h-7 w-7 inline-flex items-center justify-center rounded-md text-on-glass-mute hover:text-on-glass hover:bg-white/[.06] transition-colors"
                      aria-label="取消"
                    >
                      <X size={14} />
                    </button>
                  )}
                  <button
                    className="h-7 w-7 inline-flex items-center justify-center rounded-md text-on-glass-mute hover:text-on-glass hover:bg-white/[.06] transition-colors"
                    aria-label="更多"
                  >
                    <MoreHorizontal size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <GlassDivider />

          <div className="flex items-center gap-2 px-4 py-2.5 text-[11.5px] text-on-glass-faint">
            <StatusDot variant="run" />
            <span>任务将在后台依次处理，关闭应用不影响任务执行</span>
          </div>
        </GlassPanel>
      </div>
    </LiquidShell>
  );
}
