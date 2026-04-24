import type { ServerConfig } from "./types";

export function providerSupportsMultipleOutputs(_config: ServerConfig | undefined, _provider: string) {
  return true;
}

export function effectiveOutputCount(_config: ServerConfig | undefined, _provider: string, requested: number) {
  return requested;
}

export function requestOutputCount(_config: ServerConfig | undefined, _provider: string, requested: number) {
  return requested;
}
