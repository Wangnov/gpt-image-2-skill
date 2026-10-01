import { t } from "@/lib/i18n";
import { Toggle } from "@/components/ui/toggle";
import type { NotificationConfig } from "@/lib/types";
import { Row } from "./layout";

export function NotificationStatusRow({
  draft,
  patch,
}: {
  draft: NotificationConfig;
  patch: (next: Partial<NotificationConfig>) => void;
}) {
  return (
    <Row
      title={t("触发状态")}
      description={t("哪些结果会通知。")}
      control={
        <div className="grid w-full gap-2 sm:w-[600px] sm:grid-cols-3">
          <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-[color:var(--w-04)] px-3 py-2 text-[12px]">
            <span>{t("完成")}</span>
            <Toggle
              checked={draft.on_completed}
              onChange={(on_completed) => patch({ on_completed })}
            />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-[color:var(--w-04)] px-3 py-2 text-[12px]">
            <span>{t("失败")}</span>
            <Toggle
              checked={draft.on_failed}
              onChange={(on_failed) => patch({ on_failed })}
            />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-[color:var(--w-04)] px-3 py-2 text-[12px]">
            <span>{t("取消")}</span>
            <Toggle
              checked={draft.on_cancelled}
              onChange={(on_cancelled) => patch({ on_cancelled })}
            />
          </label>
        </div>
      }
    />
  );
}
