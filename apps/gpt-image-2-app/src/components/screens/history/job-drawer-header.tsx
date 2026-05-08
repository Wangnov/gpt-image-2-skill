import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";
import { statusLabel } from "@/lib/format";
import type { Job } from "@/lib/types";
import { jobDrawerBadgeTone } from "./job-drawer-utils";

export function JobDrawerHeader({
  job,
  planned,
  doneCount,
  selectedLabel,
  prompt,
  promptTitle,
  onClose,
}: {
  job: Job;
  planned: number;
  doneCount: number;
  selectedLabel: string;
  prompt: string;
  promptTitle: string;
  onClose: () => void;
}) {
  return (
    <div className="px-[18px] py-3.5 border-b border-border-faint flex items-start gap-2.5">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
          <Badge tone={jobDrawerBadgeTone(job.status)} size="sm">
            <StatusDot status={job.status} />
            {statusLabel(job.status)}
          </Badge>
          {planned > 1 && (
            <span className="t-small">
              {job.status === "completed" || doneCount >= planned
                ? `${planned} 张图片`
                : `已完成 ${doneCount}/${planned}`}
            </span>
          )}
          {planned > 1 && (
            <Badge tone="accent" size="sm">
              候选 {selectedLabel}
            </Badge>
          )}
        </div>
        <div
          className="t-h3 line-clamp-2 break-anywhere leading-snug"
          title={prompt}
        >
          {promptTitle}
        </div>
      </div>
      <Button variant="ghost" size="iconSm" icon="x" onClick={onClose} />
    </div>
  );
}
