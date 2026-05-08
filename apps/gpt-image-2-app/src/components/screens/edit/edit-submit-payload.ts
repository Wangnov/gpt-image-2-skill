import { type MaskExport } from "./mask-canvas";
import {
  blobFile,
  type EditMode,
  type EditRegionMode,
  type RefWithFile,
} from "./shared";

export function appendReferenceImages(form: FormData, refs: RefWithFile[]) {
  refs.forEach((ref, index) => {
    form.append(`ref_${String(index).padStart(2, "0")}`, ref.file, ref.name);
  });
}

export function appendNativeMaskPayload({
  form,
  maskPayload,
  refs,
  targetRef,
}: {
  form: FormData;
  maskPayload: MaskExport;
  refs: RefWithFile[];
  targetRef: RefWithFile;
}) {
  form.append("ref_00", blobFile(maskPayload.targetImage, "target.png"));
  refs
    .filter((ref) => ref.id !== targetRef.id)
    .forEach((ref, index) => {
      form.append(
        `ref_${String(index + 1).padStart(2, "0")}`,
        ref.file,
        ref.name,
      );
    });
  form.append("mask", blobFile(maskPayload.nativeMask, "mask.png"));
}

export function appendSoftRegionPayload({
  form,
  maskPayload,
  refs,
}: {
  form: FormData;
  maskPayload: MaskExport;
  refs: RefWithFile[];
}) {
  appendReferenceImages(form, refs);
  form.append(
    "selection_hint",
    blobFile(maskPayload.selectionHint, "selection-hint.png"),
  );
}

export function appendEditMetadata({
  editMode,
  editRegionMode,
  format,
  form,
  normalizedSize,
  prompt,
  provider,
  quality,
  requestedN,
  targetRef,
  usesRegion,
}: {
  editMode: EditMode;
  editRegionMode: EditRegionMode;
  format: string;
  form: FormData;
  normalizedSize: string;
  prompt: string;
  provider: string;
  quality: string;
  requestedN: number;
  targetRef?: RefWithFile;
  usesRegion: boolean;
}) {
  form.append(
    "meta",
    JSON.stringify({
      prompt,
      provider,
      size: normalizedSize,
      format,
      quality,
      n: requestedN,
      edit_mode: editMode,
      edit_region_mode: usesRegion ? editRegionMode : "none",
      target_name: usesRegion ? targetRef?.name : undefined,
    }),
  );
}
