import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { PromptTemplatesPanel } from "@/components/screens/settings/prompt-templates-panel";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import type { ServerConfig } from "@/lib/types";
import { AboutPanel } from "./about-panel";
import { AppearancePanel } from "./appearance-panel";
import { type SettingsTab } from "./constants";
import { CredsPanel } from "./credentials-panel";
import { PanelHeader, SettingsNav } from "./layout";
import { RuntimePanel } from "./runtime-panel";
import { StoragePanel } from "./storage-panel";

export function SettingsScreen({ config }: { config?: ServerConfig } = {}) {
  const [tab, setTab] = useState<SettingsTab>("creds");
  const reducedMotion = useReducedMotion();

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden px-4 pb-4 pt-3 md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-5 md:px-6 md:pb-6 md:pt-2">
      <SettingsNav tab={tab} setTab={setTab} />

      <div className="surface-panel flex min-h-0 flex-1 flex-col overflow-hidden">
        <PanelHeader tab={tab} />

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={reducedMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            {tab === "creds" && <CredsPanel config={config} />}
            {tab === "appearance" && <AppearancePanel />}
            {tab === "runtime" && <RuntimePanel />}
            {tab === "storage" && (
              <StoragePanel storage={config?.storage} paths={config?.paths} />
            )}
            {tab === "prompts" && <PromptTemplatesPanel />}
            {tab === "about" && <AboutPanel />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
