import { useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { PromptTemplatesPanel } from "@/components/screens/settings/prompt-templates-panel";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { runtimeCopy } from "@/lib/runtime-copy";
import type { ServerConfig } from "@/lib/types";
import { AboutPanel } from "./about-panel";
import { AppearancePanel } from "./appearance-panel";
import { BROWSER_HIDDEN_TABS, type SettingsTab } from "./constants";
import { CredsPanel } from "./credentials-panel";
import { PanelHeader, SettingsNav } from "./layout";
import { RuntimePanel } from "./runtime-panel";
import { StoragePanel } from "./storage-panel";

export function SettingsScreen({ config }: { config?: ServerConfig } = {}) {
  const [tab, setTab] = useState<SettingsTab>("creds");
  const reducedMotion = useReducedMotion();
  const copy = runtimeCopy();
  const visibleTab =
    copy.kind === "browser" && BROWSER_HIDDEN_TABS.includes(tab)
      ? "creds"
      : tab;
  // Storage tab puts a save button in the panel header so it shows up next to
  // the title rather than inside the content area. The panel reports its
  // dirty state and current save handler through these refs/state; we render
  // the actual button on this side so the header DOM is the panel header,
  // not a duplicate inside the panel.
  const [storageDirty, setStorageDirty] = useState(false);
  const [storageSaving, setStorageSaving] = useState(false);
  const storageSaveRef = useRef<() => void>(() => {});
  const storageHeaderAction: ReactNode | undefined =
    visibleTab === "storage" ? (
      <>
        {storageDirty && (
          <span className="flex h-7 items-center text-[12px] leading-none text-[color:var(--accent-70)]">
            有未保存的改动
          </span>
        )}
        <button
          type="button"
          disabled={!storageDirty || storageSaving}
          onClick={() => storageSaveRef.current()}
          className="flex h-7 items-center rounded-md bg-[color:var(--accent-55)] px-3 text-[12.5px] font-medium leading-none text-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          保存
        </button>
      </>
    ) : undefined;

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden px-4 pb-4 pt-3 md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-5 md:px-6 md:pb-6 md:pt-2">
      <SettingsNav tab={visibleTab} setTab={setTab} />

      <div className="surface-panel flex min-h-0 flex-1 flex-col overflow-hidden">
        <PanelHeader tab={visibleTab} action={storageHeaderAction} />

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={visibleTab}
            initial={reducedMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            {visibleTab === "creds" && <CredsPanel config={config} />}
            {visibleTab === "appearance" && <AppearancePanel />}
            {visibleTab === "runtime" && <RuntimePanel />}
            {visibleTab === "storage" && (
              <StoragePanel
                storage={config?.storage}
                paths={config?.paths}
                onDirtyChange={setStorageDirty}
                onSavingChange={setStorageSaving}
                saveRef={storageSaveRef}
              />
            )}
            {visibleTab === "prompts" && <PromptTemplatesPanel />}
            {visibleTab === "about" && <AboutPanel />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
