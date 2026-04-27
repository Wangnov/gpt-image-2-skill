/// <reference types="vite/client" />

// Compile-time constant injected by vite.config.ts's `define`.
// Reads package.json `version` so the About panel can show the
// current release without hardcoding a string.
declare const __APP_VERSION__: string;
