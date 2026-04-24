import type { ServerConfig } from "./types";

export function providerSupportsMultipleOutputs(config: ServerConfig | undefined, provider: string) {
  const providerConfig = provider ? config?.providers[provider] : undefined;
  if (provider === "codex" || providerConfig?.type === "codex") return false;
  return true;
}

export function effectiveOutputCount(config: ServerConfig | undefined, provider: string, requested: number) {
  return providerSupportsMultipleOutputs(config, provider) ? requested : 1;
}

export function requestOutputCount(config: ServerConfig | undefined, provider: string, requested: number) {
  return providerSupportsMultipleOutputs(config, provider) ? requested : undefined;
}
