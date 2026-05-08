import { api } from "@/lib/api";
import type { Job } from "@/lib/types";
import type { ImageAsset } from "./types";

export function imageAssetFromJob(
  job: Job,
  outputIndex: number = 0,
): ImageAsset {
  const url = api.jobOutputUrl(job, outputIndex);
  const path = api.jobOutputPath(job, outputIndex);
  return {
    jobId: job.id,
    outputIndex,
    src: url,
    path: path ?? null,
    prompt: readPromptFromMetadata(job.metadata),
    command: job.command,
    job,
  };
}

export function imageAssetFromOutput(args: {
  jobId: string;
  outputIndex: number;
  src: string;
  path?: string | null;
  prompt?: string;
  command?: Job["command"];
  job?: Job;
}): ImageAsset {
  return {
    jobId: args.jobId,
    outputIndex: args.outputIndex,
    src: args.src,
    path: args.path ?? null,
    prompt: args.prompt,
    command: args.command,
    job: args.job,
  };
}

function readPromptFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string | undefined {
  if (!metadata) return undefined;
  const value = metadata["prompt"];
  if (typeof value === "string" && value.trim().length > 0) return value;
  return undefined;
}
