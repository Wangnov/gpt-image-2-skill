import type { MouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Magnet from "@/components/reactbits/components/Magnet";
import CountUp from "@/components/reactbits/text/CountUp";
import logoUrl from "@/assets/logo.png";
import { cn } from "@/lib/cn";
import { SCREENS, type ScreenId } from "./screens";

function isTauriRuntime() {
  return Boolean(
    typeof window !== "undefined" &&
      (window.__TAURI_INTERNALS__ || window.__TAURI__),
  );
}

function canStartWindowDrag(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return true;
  return !target.closest(
    [
      "[data-no-window-drag]",
      "a",
      "button",
      "input",
      "select",
      "textarea",
      "[role='button']",
      "[role='tab']",
    ].join(","),
  );
}

function startWindowDrag(event: MouseEvent<HTMLElement>) {
  if (event.button !== 0 || !isTauriRuntime()) return;
  if (!canStartWindowDrag(event.target)) return;
  event.preventDefault();
  void getCurrentWindow().startDragging().catch(() => {
    /* Tauri can reject dragging before the window is focused. */
  });
}

export function TopNav({
  screen,
  setScreen,
  running,
}: {
  screen: ScreenId;
  setScreen: (s: ScreenId) => void;
  running?: { generate: number; edit: number; total: number };
}) {
  const tauriRuntime = isTauriRuntime();

  return (
    <header
      onMouseDown={startWindowDrag}
      className={cn(
        "relative h-14 shrink-0 z-30 flex items-start pt-2",
        tauriRuntime ? "pl-[92px] pr-4 xl:pr-5" : "px-4 xl:px-5",
      )}
    >
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
          <img
            src={logoUrl}
            className="h-5 w-5 object-contain drop-shadow-[0_0_10px_var(--accent-40)]"
            alt=""
            aria-hidden
          />
          <span className="text-[12.5px] font-semibold tracking-tight text-foreground">
            GPT Image 2
          </span>
        </div>
      </div>

      {/* Center — screen tabs */}
      <div
        data-no-window-drag
        className="absolute left-1/2 top-2 -translate-x-1/2 inline-flex items-center gap-0.5 p-1 rounded-full border"
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
            <Magnet
              key={s.id}
              padding={24}
              magnetStrength={14}
              activeTransition="transform 220ms cubic-bezier(0.16, 1, 0.3, 1)"
              inactiveTransition="transform 360ms cubic-bezier(0.32, 0.72, 0, 1)"
              wrapperClassName="shrink-0"
            >
              <button
                type="button"
                data-no-window-drag
                onClick={() => setScreen(s.id)}
                className={cn(
                  "relative inline-flex items-center gap-1.5 h-8 px-4 rounded-full text-[12.5px] font-medium whitespace-nowrap transition-all",
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
                    className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full text-[9.5px] font-mono font-semibold leading-none animate-pulse-subtle tabular-nums"
                    style={{
                      background: "var(--status-running-bg)",
                      color: "var(--status-running)",
                      boxShadow: "0 0 8px var(--status-running-60)",
                    }}
                    aria-label={`${tabCount} 个任务进行中`}
                  >
                    <CountUp
                      to={tabCount}
                      duration={0.5}
                      className="leading-none"
                    />
                  </span>
                )}
              </button>
            </Magnet>
          );
        })}
      </div>

    </header>
  );
}
