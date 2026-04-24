import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Icon } from "@/components/icon";
import { useTweaks } from "@/hooks/use-tweaks";
import type { Tweaks } from "@/lib/types";

const ACCENTS: { v: Tweaks["accent"]; c: string }[] = [
  { v: "green", c: "#0d8b5c" },
  { v: "black", c: "#0d0d0c" },
  { v: "blue", c: "#1a6fe0" },
  { v: "violet", c: "#6e3aff" },
  { v: "orange", c: "#cc5b1b" },
];

export function TweaksPanel({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { tweaks, setTweaks } = useTweaks();
  if (!visible) return null;

  return (
    <div
      className="absolute right-5 bottom-5 w-[280px] z-[60] bg-raised border border-border rounded-xl shadow-lg animate-fade-up overflow-hidden"
    >
      <div className="flex items-center px-3.5 py-2.5 border-b border-border-faint">
        <Icon name="gear" size={14} style={{ marginRight: 8, color: "var(--text-muted)" }} />
        <div className="t-h3">Tweaks</div>
        <div className="flex-1" />
        <Button variant="ghost" size="iconSm" icon="x" onClick={onClose} />
      </div>

      <div className="p-3.5 flex flex-col gap-3.5">
        <div>
          <div className="t-tiny mb-1.5">主题</div>
          <Segmented
            value={tweaks.theme}
            onChange={(v) => setTweaks({ theme: v })}
            size="sm"
            options={[
              { value: "light", label: "亮色" },
              { value: "dark", label: "暗色" },
            ]}
          />
        </div>

        <div>
          <div className="t-tiny mb-1.5">强调色</div>
          <div className="flex gap-2">
            {ACCENTS.map((a) => (
              <button
                key={a.v}
                onClick={() => setTweaks({ accent: a.v })}
                title={a.v}
                className="rounded-full"
                style={{
                  width: 20,
                  height: 20,
                  background: a.c,
                  border: "1.5px solid rgba(0,0,0,0.1)",
                  outline: tweaks.accent === a.v ? "2px solid var(--accent)" : "none",
                  outlineOffset: 2,
                }}
              />
            ))}
          </div>
        </div>

        <div>
          <div className="t-tiny mb-1.5">字体</div>
          <Segmented
            value={tweaks.font}
            onChange={(v) => setTweaks({ font: v })}
            size="sm"
            options={[
              { value: "system", label: "系统" },
              { value: "mono", label: "等宽" },
              { value: "serif", label: "衬线" },
            ]}
          />
        </div>

        <div>
          <div className="t-tiny mb-1.5">密度</div>
          <Segmented
            value={tweaks.density}
            onChange={(v) => setTweaks({ density: v })}
            size="sm"
            options={[
              { value: "compact", label: "紧凑" },
              { value: "comfortable", label: "舒适" },
            ]}
          />
        </div>

        <div>
          <div className="t-tiny mb-1.5">事件时间线</div>
          <Segmented
            value={tweaks.timeline}
            onChange={(v) => setTweaks({ timeline: v })}
            size="sm"
            options={[
              { value: "card", label: "卡片" },
              { value: "chip", label: "紧凑" },
              { value: "log", label: "日志" },
            ]}
          />
        </div>
      </div>

      <div className="px-3.5 py-2 border-t border-border-faint text-[11px] text-faint flex items-center gap-1.5">
        <Icon name="info" size={11} />
        变更会实时应用至整个应用。
      </div>
    </div>
  );
}
