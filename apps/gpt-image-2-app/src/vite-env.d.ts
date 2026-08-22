/// <reference types="vite/client" />

// Compile-time constant injected by vite.config.ts's `define`.
// Reads package.json `version` so the About panel can show the
// current release without hardcoding a string.
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_GPT_IMAGE_2_API_BASE?: string;
  readonly VITE_GPT_IMAGE_2_RELAY_BASE?: string;
}

interface TurnstileRenderOptions {
  sitekey: string;
  action: string;
  appearance: "interaction-only";
  theme: "auto" | "light" | "dark";
  callback(token: string): void;
  "error-callback"(): void;
  "expired-callback"(): void;
  "timeout-callback"(): void;
}

interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string;
  remove(widgetId: string): void;
}

interface Window {
  __GPT_IMAGE_2_API_BASE__?: string;
  __GPT_IMAGE_2_RELAY_BASE__?: string;
  __GPT_IMAGE_2_RUNTIME__?: "browser" | "http";
  turnstile?: TurnstileApi;
}
