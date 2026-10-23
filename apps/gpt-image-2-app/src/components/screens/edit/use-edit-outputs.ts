import { t, getLocale } from "@/lib/i18n";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { runtimeCopy } from "@/lib/runtime-copy";
import { saveImages, saveJobImages } from "@/lib/user-actions";

export function useEditOutputs({
  eventsLength,
  isWorking,
  jobId,
  outputCount,
}: {
  eventsLength: number;
  isWorking: boolean;
  jobId: string | null;
  outputCount: number;
}) {
  const [selectedOutput, setSelectedOutput] = useState(0);
  const [outputsDrawerOpen, setOutputsDrawerOpen] = useState(false);
  const outputRefreshKey = eventsLength;
  const outputs = useMemo(() => {
    if (!jobId || outputCount < 1) return [];
    return Array.from({ length: outputCount }).map((_, index) => ({
      index,
      url: api.outputUrl(jobId, index),
      selected: index === selectedOutput,
    }));
  }, [jobId, outputCount, selectedOutput, outputRefreshKey, getLocale()]);
  const outputPaths = useMemo(() => {
    if (!jobId || outputCount < 1) return [];
    return Array.from({ length: outputCount })
      .map((_, index) => api.outputPath(jobId, index))
      .filter((path): path is string => Boolean(path));
  }, [jobId, outputCount, outputRefreshKey, getLocale()]);
  const selectedPath = jobId
    ? (api.outputPath(jobId, selectedOutput) ?? outputPaths[0])
    : undefined;
  const copy = runtimeCopy();
  const saveSelected = () => saveImages([selectedPath], t("图片"));
  const saveAll = () =>
    jobId
      ? saveJobImages(jobId, t("任务图片"))
      : saveImages(outputPaths, t("图片"));
  const hasOutputs =
    outputs.some((output) => output.url) || outputPaths.length > 0;
  const showOutputsLauncher = isWorking || hasOutputs;

  return {
    copy,
    hasOutputs,
    outputs,
    outputsDrawerOpen,
    saveAll,
    saveSelected,
    selectedPath,
    resetSelectedOutput: () => setSelectedOutput(0),
    setOutputsDrawerOpen,
    setSelectedOutput,
    showOutputsLauncher,
  };
}
