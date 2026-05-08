import { Bell } from "lucide-react";
import { Toggle } from "@/components/ui/toggle";
import type { NotificationConfig } from "@/lib/types";
import { Row } from "./layout";

export function NotificationLocalRow({
  draft,
  patch,
}: {
  draft: NotificationConfig;
  patch: (next: Partial<NotificationConfig>) => void;
}) {
  return (
    <Row
      title="本地提示"
      description="右上角弹提示；系统通知首次会请求权限。"
      control={
        <div className="grid w-full gap-2 sm:w-[600px] sm:grid-cols-2">
          <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-[color:var(--w-04)] px-3 py-2 text-[12px]">
            <span className="inline-flex items-center gap-2">
              <Bell size={13} />
              应用内
            </span>
            <Toggle
              checked={draft.toast.enabled}
              onChange={(enabled) =>
                patch({ toast: { ...draft.toast, enabled } })
              }
            />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-[color:var(--w-04)] px-3 py-2 text-[12px]">
            <span className="inline-flex items-center gap-2">
              <Bell size={13} />
              系统通知
            </span>
            <Toggle
              checked={draft.system.enabled}
              onChange={(enabled) =>
                patch({ system: { ...draft.system, enabled } })
              }
            />
          </label>
        </div>
      }
    />
  );
}
