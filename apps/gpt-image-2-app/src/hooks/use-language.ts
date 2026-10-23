import { useSyncExternalStore } from "react";
import { getLanguageSnapshot, subscribeLanguage } from "@/lib/i18n";

export function useLanguage() {
  return useSyncExternalStore(
    subscribeLanguage,
    getLanguageSnapshot,
    getLanguageSnapshot,
  );
}
