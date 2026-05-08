import { OUTPUT_COUNT_OPTIONS } from "@/lib/image-options";
import type { Job } from "@/lib/types";

export const QUALITY_CHIP_OPTIONS = [
  { value: "auto", label: "自动" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];

export const FORMAT_OPTIONS = [
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG" },
  { value: "webp", label: "WEBP" },
];

export const COUNT_OPTIONS = OUTPUT_COUNT_OPTIONS.map((n) => ({
  value: String(n),
  label: String(n),
}));

export function jobPlaceholderSeed(job: Job) {
  return (
    Array.from(job.id).reduce((sum, char) => sum + char.charCodeAt(0), 0) || 1
  );
}

export function heightRatioFromSize(size: unknown) {
  if (typeof size !== "string") return 1;
  const match = size.match(/^(\d{2,5})x(\d{2,5})$/i);
  if (!match) return 1;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return 1;
  return height / width;
}

export type PendingGalleryTile = {
  kind: "pending";
  jobId: string;
  slotIndex: number;
  seed: number;
};

export type CompletedGalleryTile = {
  kind: "completed";
  job: Job;
  outputIndex: number;
  path: string | null;
  url: string | null;
  promptText: string;
};

export type GalleryTile = PendingGalleryTile | CompletedGalleryTile;
