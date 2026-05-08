import { useCallback, useEffect, useState } from "react";
import { Empty } from "@/components/ui/empty";
import { promptLength, promptSummary, promptText } from "@/lib/prompt-display";
import { api } from "@/lib/api";
import { runtimeCopy } from "@/lib/runtime-copy";
import { isActiveJobStatus } from "@/lib/api/types";
import type { Job } from "@/lib/types";
import { JobDrawerFooter } from "./job-drawer-footer";
import { JobDrawerHeader } from "./job-drawer-header";
import { JobDrawerPreview } from "./job-drawer-preview";
import {
  JobDrawerAdvanced,
  JobDrawerError,
  JobDrawerLocation,
  JobDrawerMetadata,
  JobDrawerPrompt,
  JobDrawerStorage,
} from "./job-drawer-sections";
import {
  jobSeed,
  outputUploadsFor,
  readPlannedCount,
} from "./job-drawer-utils";

export function JobMetadataDrawer({
  job,
  outputIndex,
  onOutputIndexChange,
  onClose,
  onDelete,
  onCancel,
}: {
  job?: Job;
  outputIndex?: number;
  onOutputIndexChange?: (index: number) => void;
  onClose: () => void;
  onDelete?: (id: string) => void;
  onCancel?: (id: string) => void;
}) {
  const [internalIndex, setInternalIndex] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const controlled = outputIndex !== undefined;
  const selectedOutput = controlled ? (outputIndex as number) : internalIndex;

  const setSelectedOutput = useCallback(
    (index: number) => {
      if (onOutputIndexChange) onOutputIndexChange(index);
      if (!controlled) setInternalIndex(index);
    },
    [controlled, onOutputIndexChange],
  );

  const meta = (job?.metadata ?? {}) as Record<string, unknown>;
  const seed = job ? jobSeed(job) : 0;
  const prompt = promptText(meta.prompt, job?.command ?? "未命名图片");
  const promptTitle = promptSummary(
    meta.prompt,
    72,
    job?.command ?? "未命名图片",
  );
  const promptCount = promptLength(meta.prompt);
  const outputPaths = job ? api.jobOutputPaths(job) : [];
  const planned = job ? readPlannedCount(job) : 1;
  const doneCount = outputPaths.length;
  const previewPath = job
    ? (api.jobOutputPath(job, selectedOutput) ??
      outputPaths[0] ??
      job.output_path)
    : undefined;
  const previewUrl = previewPath ? api.fileUrl(previewPath) : "";
  const selectedUploads = job ? outputUploadsFor(job, selectedOutput) : [];

  useEffect(() => {
    setImageFailed(false);
    if (!controlled) setInternalIndex(0);
  }, [job?.id, controlled]);

  useEffect(() => {
    setImageFailed(false);
  }, [previewUrl]);

  if (!job)
    return (
      <Empty
        icon="history"
        title="选择一条记录"
        subtitle="点击左侧任意作品，查看图片和保存操作。"
      />
    );

  const selectedLabel = String.fromCharCode(65 + selectedOutput);
  const canSave = job.status === "completed" && Boolean(previewPath);
  const canCancel = isActiveJobStatus(job.status);
  const copy = runtimeCopy();

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <JobDrawerHeader
        job={job}
        planned={planned}
        doneCount={doneCount}
        selectedLabel={selectedLabel}
        prompt={prompt}
        promptTitle={promptTitle}
        onClose={onClose}
      />

      <div className="flex-1 overflow-auto p-[18px]">
        <JobDrawerPreview
          job={job}
          seed={seed}
          planned={planned}
          doneCount={doneCount}
          selectedOutput={selectedOutput}
          selectedLabel={selectedLabel}
          previewUrl={previewUrl}
          imageFailed={imageFailed}
          setImageFailed={setImageFailed}
          setSelectedOutput={setSelectedOutput}
        />
        <JobDrawerMetadata job={job} meta={meta} />
        {job.status === "completed" && (
          <>
            <JobDrawerLocation
              previewPath={previewPath}
              selectedLabel={selectedLabel}
            />
            <JobDrawerStorage job={job} selectedUploads={selectedUploads} />
          </>
        )}
        <JobDrawerError job={job} />
        <JobDrawerPrompt prompt={prompt} promptCount={promptCount} />
        <JobDrawerAdvanced job={job} />
      </div>

      <JobDrawerFooter
        job={job}
        planned={planned}
        selectedLabel={selectedLabel}
        previewPath={previewPath}
        outputPaths={outputPaths}
        prompt={prompt}
        canCancel={canCancel}
        canSave={canSave}
        copy={copy}
        onCancel={onCancel}
        onDelete={onDelete}
      />
    </div>
  );
}
