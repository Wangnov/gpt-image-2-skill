import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Toggle } from "@/components/ui/toggle";
import { Segmented } from "@/components/ui/segmented";
import { useQueueStatus } from "@/hooks/use-jobs";
import { useTweaks } from "@/hooks/use-tweaks";
import { api } from "@/lib/api";
import { clearCreativeDrafts } from "@/lib/drafts";
import type { ServerConfig } from "@/lib/types";
import { PARALLEL_OPTIONS } from "./constants";
import { Row, Section } from "./layout";
import { NotificationCenterPanel } from "./notifications-panel";

export function RuntimePanel() {
  const { tweaks, setTweaks } = useTweaks();
  const { data: queue } = useQueueStatus();
  const { data: config } = useQuery<ServerConfig>({
    queryKey: ["config"],
    queryFn: api.getConfig,
  });
  const notifications = config?.notifications;
  const running = queue?.running ?? 0;
  const queued = queue?.queued ?? 0;
  const queueSummary =
    running + queued === 0
      ? "目前没有任务在队列里"
      : `当前 ${running} 个在跑，${queued} 个排队`;
  const setDraftPersistence = async (enabled: boolean) => {
    setTweaks({ persistCreativeDrafts: enabled });
    if (enabled) return;
    try {
      await clearCreativeDrafts();
      toast.success("创作草稿已清除");
    } catch (error) {
      toast.error("清除草稿失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-auto p-4 sm:p-5 space-y-4">
      <Section
        title="队列"
        description="一次最多并行几个，避免占满网络或 CPU。"
      >
        <Row
          title="同时执行数"
          description={`${queueSummary}。`}
          control={
            <Segmented
              value={String(tweaks.maxParallel)}
              onChange={(v) => setTweaks({ maxParallel: Number(v) })}
              size="sm"
              ariaLabel="同时执行数"
              options={PARALLEL_OPTIONS}
            />
          }
        />
      </Section>

      <Section
        title="草稿"
        description="保留生成 / 编辑页未提交的内容（参数、参考图、遮罩）。"
      >
        <Row
          title="保留创作草稿"
          description="刷新或重启后仍能恢复未提交的内容；关闭会清空。"
          control={
            <Toggle
              checked={tweaks.persistCreativeDrafts}
              onChange={(v) => void setDraftPersistence(v)}
            />
          }
        />
      </Section>

      <NotificationCenterPanel notifications={notifications} />
    </div>
  );
}
