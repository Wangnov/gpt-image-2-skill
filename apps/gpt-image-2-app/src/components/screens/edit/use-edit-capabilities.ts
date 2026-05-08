import {
  normalizeOutputCount,
  validateImageSize,
  validateOutputCount,
} from "@/lib/image-options";
import {
  effectiveOutputCount,
  providerEditRegionMode,
  providerSupportsMultipleOutputs,
} from "@/lib/provider-capabilities";
import type { ServerConfig } from "@/lib/types";
import { MAX_INPUT_IMAGES, type EditMode } from "./shared";

export function useEditCapabilities({
  config,
  editMode,
  isSubmitting,
  n,
  provider,
  refsLength,
  size,
}: {
  config?: ServerConfig;
  editMode: EditMode;
  isSubmitting: boolean;
  n: number;
  provider: string;
  refsLength: number;
  size: string;
}) {
  const supportsMultipleOutputs = providerSupportsMultipleOutputs(
    config,
    provider,
  );
  const editRegionMode = providerEditRegionMode(config, provider);
  const usesRegion = editMode === "region";
  const usesNativeMask = usesRegion && editRegionMode === "native-mask";
  const usesSoftRegion = usesRegion && editRegionMode === "reference-hint";
  const regionUnavailable = usesRegion && editRegionMode === "none";
  const maxReferenceImages = MAX_INPUT_IMAGES - (usesSoftRegion ? 1 : 0);
  const referenceCountError =
    refsLength > maxReferenceImages
      ? `最多上传 ${maxReferenceImages} 张参考图。`
      : undefined;
  const sizeValidation = validateImageSize(size);
  const outputCountValidation = validateOutputCount(n);
  const parameterError =
    referenceCountError ??
    sizeValidation.message ??
    (supportsMultipleOutputs ? outputCountValidation.message : undefined);
  const safeN = normalizeOutputCount(n);
  const actualN = effectiveOutputCount(config, provider, safeN);
  const submitDisabled =
    isSubmitting ||
    refsLength === 0 ||
    !provider ||
    Boolean(parameterError) ||
    regionUnavailable;

  return {
    actualN,
    editRegionMode,
    maxReferenceImages,
    outputCountValidation,
    parameterError,
    referenceCountError,
    regionUnavailable,
    safeN,
    sizeValidation,
    submitDisabled,
    supportsMultipleOutputs,
    usesNativeMask,
    usesRegion,
    usesSoftRegion,
  };
}
