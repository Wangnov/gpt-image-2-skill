import { cn } from "@/lib/cn";

export type MockupTab = "generate" | "history" | "edit" | "settings";

const TABS: { id: MockupTab; label: string }[] = [
  { id: "generate", label: "生成" },
  { id: "history", label: "队列" },
  { id: "edit", label: "编辑" },
  { id: "settings", label: "设置" },
];

export function MockupNav({
  active,
  onChange,
  className,
}: {
  active: MockupTab;
  onChange: (t: MockupTab) => void;
  className?: string;
}) {
  return (
    <div className={cn("mockup-nav", className)}>
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          className="mockup-nav-item"
          data-active={t.id === active ? "true" : undefined}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
