import type { ServerConfig } from "./types";

export function providerNames(config?: ServerConfig) {
  return Object.keys(config?.providers ?? {});
}

export function effectiveDefaultProvider(config?: ServerConfig) {
  if (!config) return "";
  if (config.default_provider && config.providers[config.default_provider]) {
    return config.default_provider;
  }
  if (config.providers.codex) return "codex";
  return providerNames(config)[0] ?? "";
}

export function defaultProviderLabel(config?: ServerConfig) {
  return effectiveDefaultProvider(config) || "—";
}
