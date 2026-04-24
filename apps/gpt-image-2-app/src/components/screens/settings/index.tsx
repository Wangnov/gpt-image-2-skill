import { type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Segmented } from "@/components/ui/segmented";
import { Toggle } from "@/components/ui/toggle";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { useTweaks } from "@/hooks/use-tweaks";
import { useQueueStatus } from "@/hooks/use-jobs";
import { api, type ConfigPaths } from "@/lib/api";
import { copyText, openPath, revealPath } from "@/lib/user-actions";
import type { Tweaks } from "@/lib/types";

const ACCENTS: { value: Tweaks["accent"]; color: string; label: string }[] = [
  { value: "green", color: "#0d8b5c", label: "翠绿" },
  { value: "black", color: "#0d0d0c", label: "石墨" },
  { value: "blue", color: "#1a6fe0", label: "靛蓝" },
  { value: "violet", color: "#6e3aff", label: "紫罗兰" },
  { value: "orange", color: "#cc5b1b", label: "赤橙" },
];

const PARALLEL_OPTIONS = [1, 2, 3, 4, 6, 8].map((n) => ({
  value: String(n),
  label: String(n),
}));

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="surface-panel overflow-hidden">
      <header className="border-b border-border-faint px-5 py-3">
        <div className="t-h3">{title}</div>
        {description && (
          <div className="mt-0.5 text-[12px] text-muted">{description}</div>
        )}
      </header>
      <div className="divide-y divide-border-faint">{children}</div>
    </section>
  );
}

function Row({
  title,
  description,
  control,
}: {
  title: string;
  description?: ReactNode;
  control: ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 px-5 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-foreground">{title}</div>
        {description && (
          <div className="mt-0.5 text-[11.5px] text-muted">{description}</div>
        )}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function PathRow({
  title,
  path,
  isFolder,
}: {
  title: string;
  path?: string;
  isFolder?: boolean;
}) {
  return (
    <div className="flex items-center gap-4 px-5 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-foreground">{title}</div>
        <div
          className="mt-0.5 truncate font-mono text-[11px] text-faint"
          title={path ?? undefined}
        >
          {path ?? "—"}
        </div>
      </div>
      <div className="flex shrink-0 gap-0.5">
        <Button
          variant="ghost"
          size="iconSm"
          icon="folder"
          disabled={!path}
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
            if (path) void copyText(path, "路径");
          }}
          title="复制路径"
          aria-label="复制路径"
        />
      </div>
    </div>
  );
}

function AccentPicker({
  value,
  onChange,
}: {
  value: Tweaks["accent"];
  onChange: (v: Tweaks["accent"]) => void;
}) {
  return (
    <div className="flex items-center gap-2" role="radiogroup" aria-label="强调色">
      {ACCENTS.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.label}
            title={option.label}
            onClick={() => onChange(option.value)}
            className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)] focus-visible:ring-offset-2"
            style={{
              width: 22,
              height: 22,
              background: option.color,
              border: "1.5px solid rgba(0,0,0,0.1)",
              outline: selected ? "2px solid var(--accent)" : "none",
              outlineOffset: 2,
            }}
          />
        );
      })}
    </div>
  );
}

export function SettingsScreen() {
  const { tweaks, setTweaks } = useTweaks();
  const { data: queue } = useQueueStatus();
  const { data: paths } = useQuery<ConfigPaths>({
    queryKey: ["config-paths"],
    queryFn: api.configPaths,
    staleTime: 60_000,
  });

  const running = queue?.running ?? 0;
  const queued = queue?.queued ?? 0;
  const queueSummary =
    running + queued === 0
      ? "目前没有任务在队列里"
      : `当前 ${running} 个在跑，${queued} 个排队`;

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 p-6">
        <Section
          title="外观"
          description="主题、强调色、字体与布局密度，变更实时生效。"
        >
          <Row
            title="主题"
            description="亮色适合白天，暗色适合弱光环境。"
            control={
              <Segmented
                value={tweaks.theme}
                onChange={(v) => setTweaks({ theme: v })}
                size="sm"
                ariaLabel="主题"
                options={[
                  { value: "light", label: "亮色" },
                  { value: "dark", label: "暗色" },
                ]}
              />
            }
          />
          <Row
            title="强调色"
            description="按钮、徽章和选中态会跟随这个颜色。"
            control={
              <AccentPicker
                value={tweaks.accent}
                onChange={(v) => setTweaks({ accent: v })}
              />
            }
          />
          <Row
            title="字体"
            description="系统默认读起来最自然；等宽/衬线用于强调代码或文本风格。"
            control={
              <Segmented
                value={tweaks.font}
                onChange={(v) => setTweaks({ font: v })}
                size="sm"
                ariaLabel="字体"
                options={[
                  { value: "system", label: "系统" },
                  { value: "mono", label: "等宽" },
                  { value: "serif", label: "衬线" },
                ]}
              />
            }
          />
          <Row
            title="界面密度"
            description="紧凑减少空白，舒适更透气。"
            control={
              <Segmented
                value={tweaks.density}
                onChange={(v) => setTweaks({ density: v })}
                size="sm"
                ariaLabel="界面密度"
                options={[
                  { value: "compact", label: "紧凑" },
                  { value: "comfortable", label: "舒适" },
                ]}
              />
            }
          />
        </Section>

        <Section
          title="任务队列"
          description="控制可以同时在跑的任务数量，避免一次性吃掉网络或 CPU。"
        >
          <Row
            title="并发上限"
            description={`同时最多跑几个任务。${queueSummary}。`}
            control={
              <Segmented
                value={String(tweaks.maxParallel)}
                onChange={(v) => setTweaks({ maxParallel: Number(v) })}
                size="sm"
                ariaLabel="并发上限"
                options={PARALLEL_OPTIONS}
              />
            }
          />
        </Section>

        <Section
          title="通知"
          description="任务结束时是否弹出右上角的 toast 提示。"
        >
          <Row
            title="完成时通知"
            description="任务成功完成后弹出一条绿色 toast。"
            control={
              <Toggle
                checked={tweaks.notifyOnComplete}
                onChange={(v) => setTweaks({ notifyOnComplete: v })}
              />
            }
          />
          <Row
            title="失败/取消时通知"
            description="任务失败或被取消时弹出一条 toast。"
            control={
              <Toggle
                checked={tweaks.notifyOnFailure}
                onChange={(v) => setTweaks({ notifyOnFailure: v })}
              />
            }
          />
        </Section>

        <Section
          title="数据位置"
          description="本地存放配置、历史和生成结果的路径。只读信息。"
        >
          <PathRow title="配置文件" path={paths?.config_file} />
          <PathRow title="历史数据库" path={paths?.history_file} />
          <PathRow title="任务输出目录" path={paths?.jobs_dir} isFolder />
          <PathRow title="配置目录" path={paths?.config_dir} isFolder />
        </Section>

        <div className="flex items-center gap-1.5 px-1 pt-1 text-[11px] text-faint">
          <Icon name="info" size={11} />
          <span>偏好保存在本机浏览器存储里；并发上限会实时同步到后台队列。</span>
        </div>
      </div>
    </div>
  );
}
