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
  }, [jobId, outputCount, selectedOutput, outputRefreshKey]);
  const outputPaths = useMemo(() => {
    if (!jobId || outputCount < 1) return [];
    return Array.from({ length: outputCount })
      .map((_, index) => api.outputPath(jobId, index))
      .filter((path): path is string => Boolean(path));
  }, [jobId, outputCount, outputRefreshKey]);
  const selectedPath = jobId
    ? (api.outputPath(jobId, selectedOutput) ?? outputPaths[0])
    : undefined;
  const copy = runtimeCopy();
  const saveSelected = () => saveImages([selectedPath], "图片");
  const saveAll = () =>
    jobId ? saveJobImages(jobId, "任务图片") : saveImages(outputPaths, "图片");
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
