import { cn } from "@/lib/cn";
import { SCREENS, type ScreenId } from "./screens";

export function TopNav({
  screen,
  setScreen,
  running,
}: {
  screen: ScreenId;
  setScreen: (s: ScreenId) => void;
  running?: { generate: number; edit: number; total: number };
}) {
  return (
    <header className="relative h-14 shrink-0 z-30 flex items-center px-4 xl:px-5">
      {/* Left — brand chip */}
      <div className="flex items-center gap-2">
        <div
          className="inline-flex items-center gap-2 px-3 h-9 rounded-full border"
          style={{
            background: "var(--surface-nav)",
            borderColor: "var(--w-10)",
            backdropFilter: "blur(18px) saturate(140%)",
            WebkitBackdropFilter: "blur(18px) saturate(140%)",
            boxShadow: "inset 0 1px 0 var(--w-06)",
          }}
        >
          <span
            className="h-3.5 w-3.5 rounded-[5px]"
            style={{
              background: "var(--accent-gradient-line)",
              boxShadow: "0 0 10px var(--accent-55)",
            }}
            aria-hidden
          />
          <span className="text-[12.5px] font-semibold tracking-tight text-foreground">
            GPT Image 2
          </span>
        </div>
      </div>

      {/* Center — screen tabs */}
      <div
        className="absolute left-1/2 -translate-x-1/2 inline-flex items-center gap-0.5 p-1 rounded-full border"
        style={{
          background: "var(--surface-nav-strong)",
          borderColor: "var(--w-08)",
          backdropFilter: "blur(20px) saturate(140%)",
          WebkitBackdropFilter: "blur(20px) saturate(140%)",
          boxShadow: "var(--shadow-popover)",
        }}
      >
        {SCREENS.map((s) => {
          const isActive = s.id === screen;
          const tabCount =
            s.id === "generate"
              ? (running?.generate ?? 0)
              : s.id === "edit"
                ? (running?.edit ?? 0)
                : s.id === "history"
                  ? (running?.total ?? 0)
                  : 0;
          const isRunning = tabCount > 0;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setScreen(s.id)}
              className={cn(
                "relative inline-flex items-center gap-1.5 h-8 px-4 rounded-full text-[12.5px] font-medium transition-all",
                isActive
                  ? "text-foreground"
                  : "text-muted hover:text-foreground hover:bg-[color:var(--w-05)]",
              )}
              style={
                isActive
                  ? {
                      background: "var(--w-10)",
                      boxShadow: "inset 0 1px 0 var(--w-10)",
                    }
                  : undefined
              }
            >
              <span>{s.label}</span>
              {isRunning && (
                <span
                  className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full text-[9.5px] font-mono font-semibold leading-none animate-pulse-subtle"
                  style={{
                    background: "var(--status-running-bg)",
                    color: "var(--status-running)",
                    boxShadow: "0 0 8px var(--status-running-60)",
                  }}
                  aria-label={`${tabCount} 个任务进行中`}
                >
                  {tabCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

    </header>
  );
}
