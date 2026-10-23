import { t } from "@/lib/i18n";
import type { ImageTransport, ProviderConfig, ProviderPreset } from "./types";

export function effectiveProviderPreset(
  provider: ProviderConfig,
): ProviderPreset {
  if (provider.preset) return provider.preset;
  return provider.type === "openai" ? "openai" : "custom";
}

export function providerPresetLabel(provider: ProviderConfig) {
  if (provider.type === "codex") return "Codex";
  switch (effectiveProviderPreset(provider)) {
    case "openai":
      return t("OpenAI 官方");
    case "new-api":
      return "New API";
    case "sub2api":
      return "sub2api";
    default:
      return t("自定义服务");
  }
}

export function effectiveImageTransport(
  provider: ProviderConfig,
): ImageTransport {
  return provider.image_transport ?? "openai-sync";
}

export function imageTransportLabel(provider: ProviderConfig) {
  if (provider.type === "codex") return "image_generation";
  return effectiveImageTransport(provider) === "sub2api-async"
    ? t("异步任务")
    : t("同步 Images");
}
