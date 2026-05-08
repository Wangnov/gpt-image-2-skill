import { useMemo, useState } from "react";
import { api } from "@/lib/api";

export function useClassicEditOutputs({
  eventsLength,
  jobId,
  outputCount,
}: {
  eventsLength: number;
  jobId: string | null;
  outputCount: number;
}) {
  const [selectedOutput, setSelectedOutput] = useState(0);
  const outputRefreshKey = eventsLength;
  const outputs = useMemo(() => {
    if (!jobId || outputCount < 1) return [];
    return Array.from({ length: outputCount }).map((_, index) => ({
      index,
      url: api.outputUrl(jobId, index),
      selected: index === selectedOutput,
      seed: index * 43 + outputRefreshKey,
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

  return {
    outputs,
    resetSelectedOutput: () => setSelectedOutput(0),
    selectedPath,
    setSelectedOutput,
  };
}
