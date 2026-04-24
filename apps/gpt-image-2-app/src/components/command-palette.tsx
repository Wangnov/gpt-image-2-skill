import * as Dialog from "@radix-ui/react-dialog";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
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
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const inputId = useId();

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);

  const items = useMemo(() => {
    const rows: Item[] = [
      {
        group: "跳转",
        label: "生成工作台",
        icon: "generate",
        action: () => setScreen("generate"),
      },
      {
        group: "跳转",
        label: "编辑工作台",
        icon: "edit",
        action: () => setScreen("edit"),
      },
      {
        group: "跳转",
        label: "历史与队列",
        icon: "history",
        action: () => setScreen("history"),
      },
      {
        group: "跳转",
        label: "服务商",
        icon: "providers",
        action: () => setScreen("providers"),
      },
      {
        group: "操作",
        label: "使用默认服务商开始新生成",
        icon: "sparkle",
        action: () => setScreen("generate"),
      },
      {
        group: "操作",
        label: "测试默认服务商连接",
        icon: "play",
        action: () => setScreen("providers"),
      },
      {
        group: "最近",
        label:
          ((latestJob?.metadata as Record<string, unknown>)
            ?.prompt as string) ?? "最新任务",
        icon: "history",
        action: () => setScreen("history"),
      },
    ];
    return rows.filter(
      (item) =>
        !query || item.label.toLowerCase().includes(query.toLowerCase()),
    );
  }, [query, latestJob, setScreen]);

  useEffect(() => {
    if (activeIndex >= items.length) {
      setActiveIndex(Math.max(0, items.length - 1));
    }
  }, [items.length, activeIndex]);

  const groups = useMemo(() => {
    return items.reduce<Record<string, { item: Item; index: number }[]>>(
      (acc, item, index) => {
        (acc[item.group] ??= []).push({ item, index });
        return acc;
      },
      {},
    );
  }, [items]);

  const runActive = () => {
    const target = items[activeIndex];
    if (!target) return;
    target.action();
    onClose();
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (items.length === 0 ? 0 : (i + 1) % items.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) =>
        items.length === 0 ? 0 : (i - 1 + items.length) % items.length,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      runActive();
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(Math.max(0, items.length - 1));
    }
  };

  // Scroll active option into view on change
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-cmd-index="${activeIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay fixed inset-0 z-[80] animate-fade-in" />
        <Dialog.Content
          aria-label="命令面板"
          className="fixed left-1/2 top-[120px] z-[90] -translate-x-1/2 w-[min(calc(100vw-32px),560px)] max-h-[min(calc(100vh-160px),480px)] overflow-hidden bg-raised border border-border rounded-xl shadow-lg animate-fade-up flex flex-col"
          onOpenAutoFocus={(event) => {
            // Focus the search input instead of the first focusable element.
            event.preventDefault();
            const input = document.getElementById(
              inputId,
            ) as HTMLInputElement | null;
            input?.focus();
          }}
        >
          <Dialog.Title className="sr-only">跳转到或运行命令</Dialog.Title>
          <Dialog.Description className="sr-only">
            输入关键字过滤,使用上下方向键选择,回车执行。
          </Dialog.Description>
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border-faint">
            <Icon
              name="search"
              size={16}
              aria-hidden="true"
              style={{ color: "var(--text-faint)" }}
            />
            <input
              id={inputId}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={onKey}
              placeholder="跳转到… / 运行命令…"
              role="combobox"
              aria-expanded="true"
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={
                items[activeIndex] ? `${listboxId}-${activeIndex}` : undefined
              }
              className="flex-1 border-none outline-none bg-transparent text-[14px] text-foreground"
            />
            <span className="kbd" aria-hidden="true">
              ESC
            </span>
          </div>
          <div
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-label="命令结果"
            className="flex-1 overflow-auto px-2 py-1.5"
          >
            {items.length === 0 ? (
              <div className="py-6 text-center text-[12px] text-faint">
                没有匹配的命令。
              </div>
            ) : (
              Object.entries(groups).map(([groupName, entries]) => (
                <div key={groupName}>
                  <div className="t-caps px-2.5 py-1.5" aria-hidden="true">
                    {groupName}
                  </div>
                  {entries.map(({ item, index }) => {
                    const isActive = index === activeIndex;
                    return (
                      <button
                        key={`${groupName}-${index}`}
                        id={`${listboxId}-${index}`}
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        data-cmd-index={index}
                        onClick={() => {
                          item.action();
                          onClose();
                        }}
                        onMouseEnter={() => setActiveIndex(index)}
                        className={
                          "flex items-center gap-2.5 w-full min-h-[36px] px-2.5 bg-transparent border-none rounded-md text-[13px] text-foreground text-left cursor-pointer " +
                          (isActive ? "bg-hover" : "hover:bg-hover")
                        }
                      >
                        <Icon
                          name={item.icon}
                          size={14}
                          aria-hidden="true"
                          style={{ color: "var(--text-faint)" }}
                        />
                        <span className="flex-1 truncate">{item.label}</span>
                        {isActive && (
                          <span className="kbd" aria-hidden="true">
                            ↵
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
