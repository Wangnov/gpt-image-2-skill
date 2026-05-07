import type { MouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { motion } from "motion/react";
import GlassSurface from "@/components/reactbits/components/GlassSurface";
import CountUp from "@/components/reactbits/text/CountUp";
import logoUrl from "@/assets/logo.png";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
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
  void getCurrentWindow()
    .startDragging()
    .catch(() => {
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
  const reducedMotion = useReducedMotion();

  return (
    <header
      onMouseDown={startWindowDrag}
      className={cn(
        "relative h-14 shrink-0 z-30 flex items-start pt-2",
        tauriRuntime ? "pl-[92px] pr-4 xl:pr-5" : "px-4 xl:px-5",
      )}
    >
      {/* Left — brand chip */}
      <div className="hidden md:flex items-center gap-2">
        <GlassSurface
          width={196}
          height={40}
          borderRadius={50}
          borderWidth={0.07}
          backgroundOpacity={0.1}
          saturation={1}
          opacity={0.68}
          distortionScale={-210}
          blur={11}
          displace={0.5}
          redOffset={0}
          greenOffset={10}
          blueOffset={20}
          mixBlendMode="screen"
          className="inline-flex shrink-0"
          contentClassName="gap-2"
          contentPadding="0 14px"
        >
          <img
            src={logoUrl}
            className="h-5 w-5 object-contain [filter:drop-shadow(var(--logo-halo-sm))]"
            alt=""
            aria-hidden
          />
          <span className="text-[12.5px] font-semibold tracking-tight text-foreground">
            GPT Image 2
          </span>
        </GlassSurface>
      </div>

      {/* Center — screen tabs */}
      <GlassSurface
        data-no-window-drag
        width="min(288px, calc(100vw - 32px))"
        height={44}
        borderRadius={50}
        borderWidth={0.07}
        backgroundOpacity={0.1}
        saturation={1}
        opacity={0.68}
        distortionScale={-210}
        blur={11}
        displace={0.5}
        redOffset={0}
        greenOffset={10}
        blueOffset={20}
        mixBlendMode="screen"
        className="absolute left-1/2 top-2 -translate-x-1/2"
        contentClassName="gap-0.5"
        contentPadding={4}
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
            <div key={s.id} className="shrink-0">
              <motion.button
                type="button"
                data-no-window-drag
                onClick={() => setScreen(s.id)}
                whileTap={reducedMotion ? undefined : { scale: 0.985 }}
                className={cn(
                  "relative isolate inline-flex items-center gap-1.5 h-8 min-h-8 px-4 rounded-full text-[12.5px] font-medium whitespace-nowrap transition-colors",
                  isActive
                    ? "text-foreground"
                    : "text-muted hover:text-foreground hover:bg-[color:var(--w-05)]",
                )}
                style={{ minHeight: 32 }}
              >
                {isActive && (
                  <motion.span
                    layoutId="top-nav-active-pill"
                    aria-hidden="true"
                    className="absolute inset-0 z-0 rounded-full"
                    style={{
                      background: "rgba(255, 255, 255, 0.14)",
                      boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.16)",
                    }}
                    transition={{
                      duration: reducedMotion ? 0 : 0.24,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                  />
                )}
                <span className="relative z-10">{s.label}</span>
                {isRunning && (
                  <span
                    className="relative z-10 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-mono font-semibold leading-none animate-pulse-subtle tabular-nums"
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
              </motion.button>
            </div>
          );
        })}
      </GlassSurface>
    </header>
  );
}
