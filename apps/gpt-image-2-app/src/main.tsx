import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { AuthGate } from "@/components/auth-gate";
import { TweaksProvider } from "@/hooks/use-tweaks";
import { ConfirmProvider } from "@/hooks/use-confirm";
import { setActionsQueryClient } from "@/lib/image-actions/query-client";
import "./index.css";
import { initializeLanguage } from "@/lib/i18n";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 10_000,
    },
  },
});

// Image-action executors run outside React (e.g. inside contextmenu callbacks
// or sonner toast actions) and need a way to invalidate job queries after a
// soft delete or undo. Hand them the singleton at app boot so they don't
// have to thread `useQueryClient()` through every call site.
setActionsQueryClient(queryClient);

// In dev mode, expose the QueryClient on window so we can inspect & mock data
// from the browser console / preview eval. No-op in production builds.
if (import.meta.env.DEV) {
  (window as unknown as { __qc?: QueryClient }).__qc = queryClient;
}

async function bootstrap() {
  let nativeLocale: string | null = null;
  if (window.__TAURI_INTERNALS__ || window.__TAURI__) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      nativeLocale = await invoke<string | null>("system_locale");
    } catch {
      // A missing platform locale falls back to the WebView's language.
    }
  }
  initializeLanguage(nativeLocale);
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <TweaksProvider>
          <ConfirmProvider>
            <AuthGate>
              <App />
            </AuthGate>
          </ConfirmProvider>
        </TweaksProvider>
      </QueryClientProvider>
    </React.StrictMode>,
  );
}

void bootstrap();
