import type { ProviderConfig, ServerConfig } from "./types";
import { imageTransportLabel } from "./provider-protocol";

export function providerNativeSupportsMultipleOutputs(
  config: ServerConfig | undefined,
  provider: string,
) {
  if (provider === "openai") return true;
  if (provider === "codex") return false;
  const cfg = provider ? config?.providers[provider] : undefined;
  if (!cfg) return true;
  return cfg.supports_n ?? cfg.type === "openai";
}

export function providerSupportsMultipleOutputs(
  _config: ServerConfig | undefined,
  _provider: string,
) {
  return true;
}

export function effectiveOutputCount(
  _config: ServerConfig | undefined,
  _provider: string,
  requested: number,
) {
  return requested;
}

export function requestOutputCount(
  _config: ServerConfig | undefined,
  _provider: string,
  requested: number,
) {
  return requested;
}

export function providerEditRegionMode(
  config: ServerConfig | undefined,
  provider: string,
): NonNullable<ProviderConfig["edit_region_mode"]> {
  if (provider === "openai") return "native-mask";
  if (provider === "codex") return "reference-hint";
  const cfg = provider ? config?.providers[provider] : undefined;
  if (cfg?.edit_region_mode) return cfg.edit_region_mode;
  if (cfg?.type === "openai") return "native-mask";
  if (cfg?.type === "codex") return "reference-hint";
  return "reference-hint";
}

export function providerCapabilityBadges(
  config: ServerConfig | undefined,
  provider: string,
) {
  const cfg = provider ? config?.providers[provider] : undefined;
  const nativeN = providerNativeSupportsMultipleOutputs(config, provider);
  const editMode = providerEditRegionMode(config, provider);
  return [
    cfg ? imageTransportLabel(cfg) : "同步 Images",
    nativeN ? "接口多图" : "App 并发多图",
    editMode === "native-mask"
      ? "原生遮罩"
      : editMode === "reference-hint"
        ? "参考图局部编辑"
        : "不支持局部编辑",
    "失败可分类",
  ];
}
