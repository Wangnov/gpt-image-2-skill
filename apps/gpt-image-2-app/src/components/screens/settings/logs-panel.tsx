import { useMemo, useState } from "react";
import { Download, FolderOpen, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Toggle } from "@/components/ui/toggle";
import {
  useConfig,
  useLogs,
  useOpenLogsDir,
  useUpdateLogging,
} from "@/hooks/use-config";
import { cn } from "@/lib/cn";
import { runtimeCopy } from "@/lib/runtime-copy";
import type { LogEntry, LogLevel } from "@/lib/types";
import { Row, Section } from "./layout";

// Segmented filter value; "all" means "no level floor" (show debug and up).
type LevelFilter = "all" | LogLevel;

const LEVEL_FILTER_OPTIONS: { value: LevelFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "error", label: "错误" },
  { value: "warn", label: "警告" },
  { value: "info", label: "信息" },
  { value: "debug", label: "调试" },
];

const LEVEL_LABEL: Record<LogLevel, string> = {
  error: "错误",
  warn: "警告",
  info: "信息",
  debug: "调试",
};

function levelClasses(level: LogLevel): string {
  switch (level) {
    case "error":
      return "text-status-err border-[color:var(--status-err-25)] bg-[color:var(--status-err-08)]";
    case "warn":
      return "text-status-warn border-[color:var(--status-warn-25,var(--border))] bg-[color:var(--status-warn-08,var(--w-05))]";
    case "info":
      return "text-foreground border-border bg-[color:var(--w-05)]";
    case "debug":
    default:
      return "text-muted border-border bg-[color:var(--w-03)]";
  }
}

function formatTimestamp(ts: string): string {
  const parsed = new Date(ts);
  if (Number.isNaN(parsed.getTime())) return ts;
  return parsed.toLocaleString();
}

/** Best-effort one-line message extracted from a log entry's payload. */
function entryMessage(entry: LogEntry): string {
  const data = entry.data ?? {};
  const error = data.error;
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }
  const direct = data.message;
  if (typeof direct === "string") return direct;
  // Fall back to a compact rendering of the remaining payload so the row is
  // never empty (e.g. job ids on job.started).
  const keys = Object.keys(data);
  if (keys.length === 0) return "";
  try {
    return JSON.stringify(data);
  } catch {
    return "";
  }
}

export function LogsPanel() {
  const copy = runtimeCopy();
  const [filter, setFilter] = useState<LevelFilter>("all");

  const level = filter === "all" ? undefined : filter;
  const isBrowser = copy.kind === "browser";

  const { data: config } = useConfig();
  const logging = config?.logging;
  const updateLogging = useUpdateLogging();
  const openLogsDir = useOpenLogsDir();

  const logsQuery = useLogs({ level, limit: 1000, enabled: !isBrowser });
  const entries = logsQuery.data?.entries ?? [];
  const logsDir = logsQuery.data?.logs_dir ?? "";

  // Render newest first in the UI even though the backend returns oldest-last.
  const ordered = useMemo(() => [...entries].reverse(), [entries]);

  if (isBrowser) {
    return (
      <div className="flex-1 min-h-0 overflow-auto p-4 sm:p-5 space-y-4">
        <Section
          title="日志"
          description="运行诊断日志，便于排查生成失败的原因。"
        >
          <Row
            title="此环境不支持日志"
            description="静态 Web 版本没有本机日志文件，请使用桌面 App 或自托管的 Docker 后端查看诊断日志。"
            control={<span className="text-[12px] text-muted">不可用</span>}
          />
        </Section>
      </div>
    );
  }

  const handleExport = () => {
    if (ordered.length === 0) {
      toast.warning("没有可导出的日志");
      return;
    }
    // Export the currently loaded slice as JSONL (oldest-first to match the
    // on-disk file) so it can be attached to a bug report.
    const text = entries.map((entry) => JSON.stringify(entry)).join("\n");
    const blob = new Blob([`${text}\n`], {
      type: "application/x-ndjson;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    anchor.download = `gpt-image-2-logs-${stamp}.jsonl`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const handleOpenDir = async () => {
    try {
      const path = await openLogsDir.mutateAsync();
      if (copy.kind === "http") {
        toast.info("日志目录", {
          description: path || "服务器日志目录路径不可用。",
        });
      }
    } catch (error) {
      toast.error("无法打开日志文件夹", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-5">
      <Section title="日志设置" description="控制诊断日志的详细程度。">
        <Row
          title="详细日志（调试）"
          description="开启后会额外记录 debug 级别的事件，便于深入排查；默认仅记录信息及以上。"
          control={
            <Toggle
              checked={logging?.debug ?? false}
              disabled={updateLogging.isPending}
              onChange={(debug) => {
                updateLogging.mutate(
                  { debug },
                  {
                    onError: (error) =>
                      toast.error("保存日志设置失败", {
                        description:
                          error instanceof Error
                            ? error.message
                            : String(error),
                      }),
                  },
                );
              }}
            />
          }
        />
      </Section>

      <div className="flex flex-col min-h-0 flex-1 rounded-xl overflow-hidden border border-border-faint">
        <div className="flex flex-wrap items-center gap-2 border-b border-border-faint px-4 py-3 sm:px-5">
          <Segmented
            value={filter}
            onChange={setFilter}
            options={LEVEL_FILTER_OPTIONS}
            size="sm"
            ariaLabel="日志级别过滤"
          />
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void logsQuery.refetch()}
              disabled={logsQuery.isFetching}
            >
              <RefreshCw
                size={13}
                className={cn(logsQuery.isFetching && "animate-spin")}
              />
              刷新
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleOpenDir()}
              disabled={openLogsDir.isPending}
            >
              <FolderOpen size={13} />
              {copy.kind === "http" ? "日志目录" : "打开文件夹"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleExport}
              disabled={ordered.length === 0}
            >
              <Download size={13} />
              导出
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {logsQuery.isLoading ? (
            <div className="px-4 py-8 text-center text-[12.5px] text-muted">
              正在加载日志…
            </div>
          ) : logsQuery.isError ? (
            <div className="px-4 py-8 text-center text-[12.5px] text-status-err">
              加载日志失败：
              {logsQuery.error instanceof Error
                ? logsQuery.error.message
                : "未知错误"}
            </div>
          ) : ordered.length === 0 ? (
            <div className="px-4 py-8 text-center text-[12.5px] text-muted">
              暂无日志记录。
              {logging?.debug
                ? ""
                : "如需更详细的事件，可开启上方的「详细日志」。"}
            </div>
          ) : (
            <ul className="divide-y divide-border-faint">
              {ordered.map((entry, index) => {
                const message = entryMessage(entry);
                return (
                  <li
                    key={`${entry.ts}-${index}`}
                    className="flex flex-col gap-1 px-4 py-2.5 sm:px-5"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wide",
                          levelClasses(entry.level),
                        )}
                      >
                        {LEVEL_LABEL[entry.level] ?? entry.level}
                      </span>
                      <span className="font-mono text-[11.5px] text-foreground">
                        {entry.type}
                      </span>
                      <span className="ml-auto shrink-0 font-mono text-[11px] text-muted">
                        {formatTimestamp(entry.ts)}
                      </span>
                    </div>
                    {message && (
                      <p className="break-words text-[12px] leading-snug text-muted">
                        {message}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {logsDir && (
          <div className="border-t border-border-faint px-4 py-2 sm:px-5">
            <p className="truncate font-mono text-[11px] text-muted" title={logsDir}>
              {logsDir}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
