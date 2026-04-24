import { useEffect, useState } from "react";
import { Icon, type IconName } from "@/components/icon";
import type { ScreenId } from "@/components/shell/sidebar";
import type { Job } from "@/lib/types";

type Item = {
  group: string;
  label: string;
  icon: IconName;
  action: () => void;
};

export function CommandPalette({
  open,
  onClose,
  setScreen,
  latestJob,
}: {
  open: boolean;
  onClose: () => void;
  setScreen: (s: ScreenId) => void;
  latestJob?: Job;
}) {
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const items: Item[] = (
    [
      { group: "跳转", label: "生成工作台", icon: "generate", action: () => setScreen("generate") },
      { group: "跳转", label: "编辑工作台", icon: "edit", action: () => setScreen("edit") },
      { group: "跳转", label: "历史与队列", icon: "history", action: () => setScreen("history") },
      { group: "跳转", label: "服务商", icon: "providers", action: () => setScreen("providers") },
      { group: "操作", label: "使用默认服务商开始新生成", icon: "sparkle", action: () => setScreen("generate") },
      { group: "操作", label: "测试默认服务商连接", icon: "play", action: () => setScreen("providers") },
      {
        group: "最近",
        label: ((latestJob?.metadata as Record<string, unknown>)?.prompt as string) ?? "最新任务",
        icon: "history",
        action: () => setScreen("history"),
      },
    ] as Item[]
  ).filter((i) => !q || i.label.toLowerCase().includes(q.toLowerCase()));

  const groups = items.reduce<Record<string, Item[]>>((acc, i) => {
    (acc[i.group] = acc[i.group] ?? []).push(i);
    return acc;
  }, {});

  return (
    <div
      onClick={onClose}
      className="absolute inset-0 z-[80] flex justify-center pt-[120px] animate-fade-in"
      style={{ background: "rgba(0,0,0,0.3)", backdropFilter: "blur(4px)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[520px] max-h-[440px] overflow-hidden bg-raised border border-border rounded-xl shadow-lg animate-fade-up flex flex-col"
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border-faint">
          <Icon name="search" size={16} style={{ color: "var(--text-faint)" }} />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="跳转到… / 运行命令…"
            className="flex-1 border-none outline-none bg-transparent text-[14px] text-foreground"
          />
          <span className="kbd">ESC</span>
        </div>
        <div className="flex-1 overflow-auto px-2 py-1.5">
          {Object.entries(groups).map(([g, list]) => (
            <div key={g}>
              <div className="t-caps px-2.5 py-1.5">{g}</div>
              {list.map((i, idx) => (
                <button
                  key={idx}
                  onClick={() => { i.action(); onClose(); }}
                  className="flex items-center gap-2.5 w-full h-[34px] px-2.5 bg-transparent border-none rounded-md text-[13px] text-foreground text-left cursor-pointer hover:bg-hover"
                >
                  <Icon name={i.icon} size={14} style={{ color: "var(--text-faint)" }} />
                  <span className="flex-1 truncate">{i.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
