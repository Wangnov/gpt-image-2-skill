import { english } from "./messages/en";

export type Language = "en" | "zh-CN";
export type LanguagePreference = "auto" | Language;
export type LanguageSnapshot = Readonly<{
  preference: LanguagePreference;
  locale: Language;
}>;

const STORAGE_KEY = "gpt2.language";
const listeners = new Set<() => void>();
let systemLocale: string | undefined;
let storageListening = false;

export function isLanguagePreference(
  value: unknown,
): value is LanguagePreference {
  return value === "auto" || value === "en" || value === "zh-CN";
}

export function languageFromLocale(locale?: string | null): Language {
  // POSIX locales (zh_CN.UTF-8), BCP 47 tags, and C/POSIX are supported.
  return /^zh(?:[-_.@]|$)/i.test(locale?.trim() ?? "") ? "zh-CN" : "en";
}

export function resolveLanguage(
  preference: LanguagePreference,
  nativeLocale?: string | null,
  browserLocale?: string | null,
): Language {
  if (preference !== "auto") return preference;
  return languageFromLocale(nativeLocale?.trim() || browserLocale);
}

function browserLocale() {
  return typeof navigator === "undefined"
    ? undefined
    : navigator.languages?.[0] || navigator.language;
}

function readPreference(): LanguagePreference {
  try {
    const value =
      typeof window === "undefined"
        ? null
        : window.localStorage.getItem(STORAGE_KEY);
    return isLanguagePreference(value) ? value : "auto";
  } catch {
    return "auto";
  }
}

const initialPreference = readPreference();
let snapshot: LanguageSnapshot = {
  preference: initialPreference,
  locale: resolveLanguage(initialPreference, undefined, browserLocale()),
};

function updateSnapshot(preference: LanguagePreference) {
  const locale = resolveLanguage(preference, systemLocale, browserLocale());
  if (typeof document !== "undefined") document.documentElement.lang = locale;
  if (snapshot.preference === preference && snapshot.locale === locale) return;
  snapshot = { preference, locale };
  listeners.forEach((listener) => listener());
}

export function initializeLanguage(nativeLocale?: string | null) {
  systemLocale = nativeLocale?.trim() || undefined;
  updateSnapshot(readPreference());
  if (typeof window !== "undefined" && !storageListening) {
    window.addEventListener("storage", (event) => {
      if (event.key === STORAGE_KEY || event.key === null)
        updateSnapshot(readPreference());
    });
    storageListening = true;
  }
}

export function setLanguagePreference(preference: LanguagePreference) {
  try {
    if (typeof window !== "undefined")
      window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Private browsing and full/blocked storage still allow an in-memory switch.
  }
  updateSnapshot(preference);
}

export function getLanguageSnapshot() {
  return snapshot;
}

export function getLocale() {
  return snapshot.locale;
}

export function subscribeLanguage(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function t(message: string, values?: Record<string, unknown>): string {
  let translated =
    snapshot.locale === "en" ? (english[message] ?? message) : message;
  if (snapshot.locale === "en" && values) {
    // Adjust only catalog words, before interpolation, so user content is untouched.
    translated = translated.replace(
      /(\{(p\d+)\})( missing)? (images|outputs|files|records|templates|tasks)\b/g,
      (
        match,
        placeholder: string,
        key: string,
        adjective: string | undefined,
        noun: string,
      ) =>
        Number(values[key]) === 1
          ? `${placeholder}${adjective ?? ""} ${noun.slice(0, -1)}`
          : match,
    );
  }
  return values
    ? translated.replace(/\{(p\d+)\}/g, (match, key: string) =>
        Object.hasOwn(values, key) ? String(values[key]) : match,
      )
    : translated;
}
