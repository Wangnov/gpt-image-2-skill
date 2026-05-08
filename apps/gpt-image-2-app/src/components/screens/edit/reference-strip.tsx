import { type RefObject } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { RefWithFile } from "./shared";

export function ReferenceStrip({
  refs,
  selectedRef,
  setSelectedRef,
  targetRefId,
  setTargetRefId,
  targetRef,
  usesRegion,
  maskSnapshots,
  maxReferenceImages,
  referenceCountError,
  fileInputRef,
  removeRef,
  reducedMotion,
}: {
  refs: RefWithFile[];
  selectedRef: string | null;
  setSelectedRef: (id: string) => void;
  targetRefId: string | null;
  setTargetRefId: (id: string) => void;
  targetRef?: RefWithFile;
  usesRegion: boolean;
  maskSnapshots: Record<string, string>;
  maxReferenceImages: number;
  referenceCountError?: string;
  fileInputRef: RefObject<HTMLInputElement | null>;
  removeRef: (id: string) => void;
  reducedMotion: boolean;
}) {
  return (
    <section className="shrink-0 px-4 pb-2" aria-label="参考图缩略图">
      <div className="surface-panel flex min-w-0 items-center gap-2 px-2.5 py-2">
        <div className="flex w-12 shrink-0 flex-col items-start justify-center gap-0.5 px-1 leading-none">
          <span className="t-caps">参考图</span>
          <span
            className={cn(
              "font-mono text-[10.5px] leading-none",
              referenceCountError
                ? "text-[color:var(--status-err)]"
                : "text-faint",
            )}
          >
            {refs.length}/{maxReferenceImages}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto scrollbar-none pb-0.5">
          <AnimatePresence initial={false}>
            {refs.map((ref, index) => {
              const isSelected = ref.id === selectedRef;
              const isTarget = usesRegion && ref.id === targetRef?.id;
              const hasMask = Boolean(maskSnapshots[ref.id]);
              return (
                <motion.div
                  key={ref.id}
                  layout="position"
                  initial={
                    reducedMotion ? false : { opacity: 0, scale: 0.92, y: 4 }
                  }
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={
                    reducedMotion
                      ? { opacity: 0 }
                      : { opacity: 0, scale: 0.88, x: -8 }
                  }
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                  className="group relative shrink-0"
                >
                  <button
                    type="button"
                    onClick={() => setSelectedRef(ref.id)}
                    className={cn(
                      "relative h-14 w-14 overflow-hidden rounded-md border transition-[border-color,box-shadow,transform,opacity]",
                      isSelected
                        ? "border-[color:var(--accent)] shadow-[0_0_0_2px_var(--accent-faint)]"
                        : "border-border opacity-75 hover:opacity-100",
                    )}
                    title={ref.name}
                    aria-label={`查看参考图 ${index + 1}: ${ref.name}`}
                  >
                    <img
                      src={ref.url}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                      className="h-full w-full object-cover"
                    />
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 bottom-0 h-7 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                      style={{
                        background:
                          "linear-gradient(to top, rgba(7, 9, 18, 0.82), transparent)",
                      }}
                    />
                    <span
                      className="absolute bottom-0 left-0 right-0 flex h-4 items-center justify-center text-[8.5px] font-mono text-foreground"
                      style={{
                        background:
                          "linear-gradient(to top, var(--k-72), transparent)",
                      }}
                    >
                      {index + 1}
                    </span>
                  </button>
                  <div className="pointer-events-none absolute left-1 top-1 flex max-w-[calc(100%-8px)] flex-col items-start gap-0.5">
                    {isTarget && (
                      <span
                        className="max-w-full truncate rounded px-1 py-px text-[8px] font-semibold leading-none"
                        style={{
                          background: "var(--accent)",
                          color: "var(--accent-on)",
                        }}
                      >
                        目标
                      </span>
                    )}
                    {hasMask && (
                      <span className="max-w-full truncate rounded bg-[color:var(--k-65)] px-1 py-px text-[8px] font-semibold leading-none text-foreground">
                        遮罩
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeRef(ref.id);
                    }}
                    className="pointer-events-none absolute right-1 top-1 inline-flex h-5 w-5 translate-y-[-2px] items-center justify-center rounded-full border border-white/30 bg-black/70 text-white opacity-0 shadow-[0_2px_10px_rgba(0,0,0,0.42)] backdrop-blur transition-[opacity,transform,background-color] hover:bg-black/85 focus-visible:pointer-events-auto focus-visible:translate-y-0 focus-visible:opacity-100 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100"
                    aria-label={`删除第 ${index + 1} 张参考图`}
                  >
                    <X size={11} />
                  </button>
                  {usesRegion && !isTarget && (
                    <button
                      type="button"
                      onClick={() => {
                        setTargetRefId(ref.id);
                        setSelectedRef(ref.id);
                      }}
                      className="pointer-events-none absolute inset-x-1 bottom-1 inline-flex h-5 translate-y-1 items-center justify-center rounded border border-white/35 bg-black/75 px-1 text-[8.5px] font-semibold leading-none text-white opacity-0 shadow-[0_2px_12px_rgba(0,0,0,0.45)] backdrop-blur transition-[opacity,transform,background-color] hover:bg-black/90 focus-visible:pointer-events-auto focus-visible:translate-y-0 focus-visible:opacity-100 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100"
                      aria-label={`把第 ${index + 1} 张设为目标图`}
                    >
                      设为目标
                    </button>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={refs.length >= maxReferenceImages}
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-dashed border-border-strong bg-[color:var(--w-03)] text-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
            aria-label="添加参考图"
            title="添加参考图"
          >
            <Plus size={15} />
          </button>
        </div>
      </div>
    </section>
  );
}
