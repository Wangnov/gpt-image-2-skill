import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import type { JobStatus } from "@/lib/types";
import { Row } from "./layout";

export function NotificationActionsRow({
  testing,
  saving,
  test,
  save,
}: {
  testing: boolean;
  saving: boolean;
  test: (status: JobStatus) => void;
  save: () => void;
}) {
  return (
    <Row
      title={t("保存与试发")}
      description={t("试发一条假数据，使用已保存的配置。")}
      control={
        <div className="flex w-full flex-wrap justify-end gap-2 sm:w-[600px]">
          <Button
            variant="secondary"
            size="sm"
            disabled={testing}
            onClick={() => test("completed")}
          >
            {t("试发完成")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={testing}
            onClick={() => test("failed")}
          >
            {t("试发失败")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={testing}
            onClick={() => test("cancelled")}
          >
            {t("试发取消")}
          </Button>
          <Button variant="primary" size="sm" disabled={saving} onClick={save}>
            {t("保存")}
          </Button>
        </div>
      }
    />
  );
}
