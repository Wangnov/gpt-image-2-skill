import { t } from "@/lib/i18n";
import type { TauriJobResponse } from "./api";
import type { JobEvent } from "./types";

export function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return t("任务执行失败");
}

export function responseOutputCount(response: TauriJobResponse) {
  const jobOutputs = response.job?.outputs ?? [];
  if (jobOutputs.length > 0) return jobOutputs.length;
  const payloadOutputs = response.payload?.output?.files ?? [];
  if (payloadOutputs.length > 0) return payloadOutputs.length;
  if (response.job?.output_path || response.payload?.output?.path) return 1;
  return 0;
}

export function responseOutputPath(response: TauriJobResponse) {
  return (
    response.job?.output_path ??
    response.payload?.output?.path ??
    response.payload?.output?.files?.[0]?.path
  );
}

export function outputCountDescription(actual: number, requested: number) {
  if (actual < 1) return t("未发现输出文件");
  if (requested > 1 && actual !== requested) {
    return t("计划生成 {p0} 张，已收到 {p1} 张", { p0: requested, p1: actual });
  }
  return actual > 1
    ? t("已生成并保存 {p0} 张图片", { p0: actual })
    : t("图片已生成并保存");
}

export function outputCountMismatchMessage(actual: number, requested: number) {
  if (requested <= 1 || actual === requested) return null;
  return t("这次计划生成 {p0} 张，但只收到 {p1} 张。", {
    p0: requested,
    p1: actual,
  });
}

export function submittedEvent(message: string): JobEvent {
  return {
    seq: 1,
    kind: "progress",
    type: "request.submitted",
    data: {
      status: "running",
      percent: 8,
      message,
    },
  };
}

export function terminalEventType(
  status: string | undefined,
): JobEvent["type"] {
  if (status === "failed") return "job.failed";
  if (status === "cancelled" || status === "canceled") return "job.cancelled";
  if (status === "partial_failed") return "job.partial_failed";
  return "job.completed";
}

export function completedEvent(response: TauriJobResponse): JobEvent {
  const status = response.job?.status ?? "completed";
  return (
    response.events?.[0] ?? {
      seq: 2,
      kind: "local",
      type: terminalEventType(status),
      data: {
        status,
        output: { path: responseOutputPath(response) },
        message: t("图片已保存，可以继续查看。"),
      },
    }
  );
}

export function failedEvent(message: string): JobEvent {
  return {
    seq: 2,
    kind: "local",
    type: "job.failed",
    data: {
      status: "failed",
      message,
    },
  };
}
