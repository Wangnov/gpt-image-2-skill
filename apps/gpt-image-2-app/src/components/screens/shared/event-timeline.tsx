import { useEffect, useRef } from "react";
import { Empty } from "@/components/ui/empty";
import { Icon } from "@/components/icon";
import { StatusDot } from "@/components/ui/status-dot";
import type { JobEvent, Tweaks } from "@/lib/types";

const KIND_ICON: Record<JobEvent["kind"], "dot" | "sparkle" | "arrowin"> = {
  local: "dot",
  progress: "sparkle",
  sse: "arrowin",
};
const KIND_COLOR: Record<JobEvent["kind"], string> = {
  local: "var(--text-faint)",
  progress: "var(--accent)",
  sse: "#1a6fe0",
};

export function EventTimeline({ events, mode = "card" }: { events: JobEvent[]; mode?: Tweaks["timeline"] }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (endRef.current) endRef.current.scrollTop = endRef.current.scrollHeight;
  }, [events.length]);

  if (events.length === 0) {
    return <Empty icon="sparkle" title="等待运行" subtitle="请求、SSE 与本地进度事件会在此依次出现。" />;
  }

  if (mode === "log") {
    return (
      <div
        ref={endRef}
        style={{ fontFamily: "var(--f-mono)" }}
        className="text-[11.5px] bg-sunken border border-border rounded-md p-3 h-[260px] overflow-auto text-muted"
      >
        {events.map((ev) => (
          <div key={ev.seq} className="mb-1 animate-fade-in">
            <span className="text-faint">[{String(ev.seq).padStart(2, "0")}]</span>{" "}
            <span style={{ color: KIND_COLOR[ev.kind] }}>{ev.kind}</span>{" "}
            <span className="text-foreground">{ev.type}</span>{" "}
            <span>
              {ev.data.message ||
                JSON.stringify(
                  Object.fromEntries(Object.entries(ev.data).filter(([k]) => k !== "provider"))
                )}
            </span>
          </div>
        ))}
      </div>
    );
  }

  if (mode === "chip") {
    return (
      <div className="flex flex-col gap-1.5">
        {events.map((ev) => {
          const status = ev.data.status === "completed" ? "completed" : "running";
          const pulse = ev.data.status === "running";
          return (
            <div key={ev.seq} className="flex items-center gap-2.5 px-2.5 py-1.5 bg-sunken rounded-md animate-fade-in">
              <StatusDot status={status as "running" | "completed"} pulse={pulse} />
              <span className="text-[11.5px] font-mono text-faint min-w-5">
                {String(ev.seq).padStart(2, "0")}
              </span>
              <span className="text-[12px] font-medium">{ev.type}</span>
              <span className="text-[11.5px] text-muted flex-1 truncate">{ev.data.message}</span>
              {typeof ev.data.percent === "number" && ev.data.percent < 100 && (
                <span className="t-mono text-faint">{ev.data.percent}%</span>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        style={{ position: "absolute", left: 13, top: 14, bottom: 14, width: 1, background: "var(--border)" }}
      />
      <div className="flex flex-col gap-2.5">
        {events.map((ev, i) => {
          const isLast = i === events.length - 1;
          const running = ev.data.status === "running" && isLast;
          const borderColor =
            ev.data.status === "completed" ? "var(--accent)" :
            ev.data.status === "running" ? "var(--status-running)" : "var(--border)";
          return (
            <div key={ev.seq} className="animate-fade-up flex gap-3 items-start relative">
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background: "var(--bg-raised)",
                  border: `1.5px solid ${borderColor}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  color: KIND_COLOR[ev.kind],
                  zIndex: 1,
                  animation: running ? "pulse-subtle 1.6s ease-in-out infinite" : "none",
                }}
              >
                <Icon name={KIND_ICON[ev.kind]} size={12} />
              </div>
              <div className="flex-1 min-w-0 pt-[3px]">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-semibold">{ev.type}</span>
                  <span
                    className="text-[10px] font-mono px-1 py-px rounded bg-sunken uppercase tracking-wider"
                    style={{ color: KIND_COLOR[ev.kind] }}
                  >
                    {ev.kind}
                  </span>
                  <span className="flex-1" />
                  <span className="t-mono text-faint text-[10.5px]">#{String(ev.seq).padStart(2, "0")}</span>
                </div>
                {ev.data.message && <div className="t-small mt-0.5">{ev.data.message}</div>}
                {ev.data.output?.path && (
                  <div className="mt-1.5 px-2 py-1.5 bg-sunken border border-border rounded text-[11px] font-mono text-muted inline-flex items-center gap-1.5 max-w-full">
                    <Icon name="folder" size={11} />
                    <span className="truncate">{ev.data.output.path}</span>
                  </div>
                )}
                {typeof ev.data.percent === "number" && ev.data.percent < 100 && (
                  <div className="mt-1.5 h-[3px] bg-sunken rounded-sm overflow-hidden">
                    <div
                      style={{ width: `${ev.data.percent}%` }}
                      className="h-full bg-accent transition-[width] duration-500 ease-out"
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
