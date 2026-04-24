/// <reference types="vite/client" />

// Compile-time constant injected by vite.config.ts's `define`.
// Reads package.json `version` so the About panel can show the
// current release without hardcoding a string.
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_GPT_IMAGE_2_API_BASE?: string;
}

interface Window {
  __GPT_IMAGE_2_API_BASE__?: string;
  __GPT_IMAGE_2_RUNTIME__?: "browser" | "http";
}
