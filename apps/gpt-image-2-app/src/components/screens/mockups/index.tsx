import { useState } from "react";
import { LayoutGrid, X } from "lucide-react";
import { GenerateMockup } from "./generate-mockup";
import { HistoryMockup } from "./history-mockup";
import { EditMockup } from "./edit-mockup";
import { SettingsMockup } from "./settings-mockup";
import { MockupNav, type MockupTab } from "./_shared/mockup-nav";

type ViewMode = "single" | "overview";

export function MockupsScreen({ onExit }: { onExit?: () => void }) {
  const [tab, setTab] = useState<MockupTab>("generate");
  const [mode, setMode] = useState<ViewMode>("single");

  if (mode === "overview") {
    return (
      <div className="relative h-full w-full overflow-hidden bg-[#050508] p-4">
        {/* exit pill (top-left) */}
        {onExit && (
          <button
            type="button"
            onClick={onExit}
            className="absolute top-4 left-4 z-20 inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full bg-black/50 border border-white/[.12] text-[12.5px] text-white/85 hover:bg-black/70 hover:text-white transition-colors backdrop-blur-md"
          >
            <X size={13} />
            退出预览
          </button>
        )}
        <button
          type="button"
          onClick={() => setMode("single")}
          className="absolute top-4 left-1/2 -translate-x-1/2 z-20 inline-flex items-center gap-2 px-4 h-9 rounded-full bg-white/[.08] border border-white/[.14] text-[12.5px] text-white/90 hover:bg-white/[.14] hover:text-white transition-colors backdrop-blur-md"
        >
          <LayoutGrid size={13} />
          返回单屏视图
        </button>

        <div className="grid h-full w-full grid-cols-2 grid-rows-2 gap-3 pt-12">
          {(
            [
              { id: "generate", el: <GenerateMockup /> },
              { id: "history", el: <HistoryMockup /> },
              { id: "edit", el: <EditMockup /> },
              { id: "settings", el: <SettingsMockup /> },
            ] as const
          ).map((m) => (
            <div
              key={m.id}
              role="button"
              tabIndex={0}
              onClick={() => {
                setTab(m.id);
                setMode("single");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setTab(m.id);
                  setMode("single");
                }
              }}
              className="relative overflow-hidden rounded-2xl ring-1 ring-white/[.10] hover:ring-white/[.25] transition-all text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              {m.el}
              <span className="absolute bottom-3 left-3 px-2.5 py-1 rounded-full bg-black/60 border border-white/10 text-[11px] text-white/85 backdrop-blur z-20">
                {m.id}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div className="absolute inset-0">
        {tab === "generate" && <GenerateMockup />}
        {tab === "history" && <HistoryMockup />}
        {tab === "edit" && <EditMockup />}
        {tab === "settings" && <SettingsMockup />}
      </div>

      <MockupNav active={tab} onChange={setTab} />

      {/* framework controls — pinned at the BOTTOM so they never collide
          with the per-screen chrome that mirrors the reference image */}
      <div className="absolute bottom-3 left-3 z-30 flex items-center gap-2">
        {onExit && (
          <button
            type="button"
            onClick={onExit}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-black/55 border border-white/[.12] text-[12px] text-white/85 hover:bg-black/75 hover:text-white transition-colors backdrop-blur-md"
            aria-label="退出液态预览"
          >
            <X size={12} />
            退出预览
          </button>
        )}
      </div>
      <div className="absolute bottom-3 right-3 z-30">
        <button
          type="button"
          onClick={() => setMode("overview")}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-black/55 border border-white/[.12] text-[12px] text-white/85 hover:bg-black/75 hover:text-white transition-colors backdrop-blur-md"
          aria-label="切换到 4 屏总览"
        >
          <LayoutGrid size={12} />
          4 屏总览
        </button>
      </div>
    </div>
  );
}
