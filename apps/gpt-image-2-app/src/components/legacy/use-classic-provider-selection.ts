import { useEffect } from "react";
import { reconcileProviderSelection } from "@/lib/providers";
import type { ServerConfig } from "@/lib/types";

export function useClassicProviderSelection({
  config,
  provider,
  setProvider,
  setUserSelectedProvider,
  userSelectedProvider,
}: {
  config?: ServerConfig;
  provider: string;
  setProvider: (value: string) => void;
  setUserSelectedProvider: (value: boolean) => void;
  userSelectedProvider: boolean;
}) {
  useEffect(() => {
    const nextProvider = reconcileProviderSelection(config, provider, {
      userSelected: userSelectedProvider,
    });
    if (provider !== nextProvider) {
      if (userSelectedProvider) setUserSelectedProvider(false);
      setProvider(nextProvider);
    }
  }, [
    config,
    provider,
    setProvider,
    setUserSelectedProvider,
    userSelectedProvider,
  ]);
}
