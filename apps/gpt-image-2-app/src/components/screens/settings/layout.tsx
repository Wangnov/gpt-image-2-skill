import { type ReactNode, useState } from "react";
import { motion } from "motion/react";
import ScrambleText from "@/components/reactbits/text/ScrambleText";
import { Button } from "@/components/ui/button";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { runtimeCopy } from "@/lib/runtime-copy";
import { copyText, openPath, revealPath } from "@/lib/user-actions";
import { NAV, TAB_TITLES, type SettingsTab } from "./constants";

export function Section({
  title,
  description,
  headerAction,
  children,
}: {
  title: string;
  description?: string;
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      className="rounded-xl overflow-hidden border border-border-faint"
      style={{ background: "var(--w-02)" }}
    >
      {(title || description || headerAction) && (
        <header className="flex items-start gap-3 border-b border-border-faint px-4 py-3 sm:px-5">
          <div className="min-w-0 flex-1">
            <div className="t-h3">{title}</div>
            {description && (
              <div className="mt-0.5 text-[12px] text-muted">{description}</div>
            )}
          </div>
          {headerAction && <div className="shrink-0">{headerAction}</div>}
        </header>
      )}
      <div className="divide-y divide-border-faint">{children}</div>
    </section>
  );
}

export function Row({
  title,
  description,
  control,
}: {
  title: string;
  description?: ReactNode;
  control: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-foreground">{title}</div>
        {description && (
          <div className="mt-0.5 text-[11.5px] text-muted">{description}</div>
        )}
      </div>
      <div className="w-full min-w-0 sm:w-auto sm:shrink-0">{control}</div>
    </div>
  );
}

export function PathRow({
  title,
  path,
  isFolder,
  dim = false,
}: {
  title: string;
  path?: string;
  isFolder?: boolean;
  dim?: boolean;
}) {
  // Bumping this trigger replays the ScrambleText reveal — used as a
  // visual receipt that "the value you just copied is the value you
  // see right now", catching cases where the user might have stale
  // path text in their clipboard.
  const [copyTrigger, setCopyTrigger] = useState(0);
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5",
        dim ? "px-4 py-2" : "px-4 py-3",
      )}
    >
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            dim
              ? "text-[11.5px] font-medium text-muted"
              : "text-[13px] font-semibold text-foreground",
          )}
        >
          {title}
        </div>
        <div
          className="mt-0.5 truncate font-mono text-[11px] text-faint"
          title={path ?? undefined}
        >
          <ScrambleText
            text={path ?? "—"}
            trigger={copyTrigger}
            duration={520}
          />
        </div>
      </div>
      <div className="flex shrink-0 gap-0.5 self-end sm:self-auto">
        <Button
          variant="ghost"
          size="iconSm"
          icon="folder"
          disabled={!path || !api.canUseLocalFiles}
          onClick={() => {
            if (!path) return;
            if (isFolder) void openPath(path);
            else void revealPath(path);
          }}
          title={isFolder ? "打开目录" : "在访达中显示"}
          aria-label={isFolder ? "打开目录" : "在访达中显示"}
        />
        <Button
          variant="ghost"
          size="iconSm"
          icon="copy"
          disabled={!path}
          onClick={() => {
            if (!path) return;
            void copyText(path, "路径");
            setCopyTrigger((n) => n + 1);
          }}
          title="复制路径"
          aria-label="复制路径"
        />
      </div>
    </div>
  );
}

/* ── Left nav ─────────────────────────────────────────── */

export function SettingsNav({
  tab,
  setTab,
}: {
  tab: SettingsTab;
  setTab: (t: SettingsTab) => void;
}) {
  const reducedMotion = useReducedMotion();
  return (
    <aside className="flex min-w-0 shrink-0 flex-col gap-2">
      <div className="px-2 pt-1 pb-1 sm:pb-2">
        <div className="t-title text-foreground">设置</div>
      </div>
      <div className="surface-panel flex gap-1.5 overflow-x-auto p-1.5 scrollbar-none [mask-image:linear-gradient(to_right,black_calc(100%-32px),transparent_100%)] md:flex-col md:gap-0.5 md:overflow-visible md:[mask-image:none]">
        {NAV.map((n) => {
          const I = n.icon;
          const active = n.id === tab;
          return (
            <button
              key={n.id}
              type="button"
              onClick={() => setTab(n.id)}
              className={cn(
                "relative flex h-9 shrink-0 items-center gap-2.5 rounded-md px-3 text-left text-[13px] transition-colors md:w-full",
                active
                  ? "text-foreground"
                  : "text-muted hover:text-foreground hover:bg-[color:var(--w-05)]",
              )}
            >
              {/* Sliding active pill — same trick the top-nav uses.
                  motion shares one element across all tabs via layoutId,
                  so the highlight slides between tabs instead of cutting. */}
              {active && (
                <motion.span
                  layoutId="settings-nav-active-pill"
                  aria-hidden="true"
                  className="absolute inset-0 z-0 rounded-md border border-[color:var(--w-10)]"
                  style={{ background: "var(--w-10)" }}
                  transition={{
                    duration: reducedMotion ? 0 : 0.24,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                />
              )}
              <I size={14} className="relative z-10 opacity-80" />
              <span className="relative z-10 flex-1">{n.label}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

/* ── Panel header (inside the right surface) ──────────── */

export function PanelHeader({ tab }: { tab: SettingsTab }) {
  const copy = runtimeCopy();
  const meta =
    tab === "about"
      ? {
          title: TAB_TITLES.about.title,
          subtitle:
            copy.kind === "tauri"
              ? "桌面端更新、本地配置和数据路径"
              : copy.kind === "http"
                ? "Web 版本、部署更新和服务端数据"
                : "静态 Web 版本和浏览器数据",
        }
      : TAB_TITLES[tab];
  return (
    <header className="border-b border-border-faint px-4 pb-3 pt-4 sm:px-6 sm:pb-4 sm:pt-5">
      <div className="t-h2">{meta.title}</div>
      <div className="mt-0.5 text-[12px] text-muted">{meta.subtitle}</div>
    </header>
  );
}
