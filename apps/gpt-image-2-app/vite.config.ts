import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { readFileSync } from "node:fs";

// Read version once at config load and expose it as a compile-time
// constant (`__APP_VERSION__`). Avoids importing package.json from app
// code (which would pull the whole manifest into the bundle) and
// avoids hardcoding a version that drifts from package.json on bumps.
const pkg = JSON.parse(
  readFileSync(path.resolve(__dirname, "./package.json"), "utf-8"),
) as { version: string };

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const moduleId = id.replaceAll("\\", "/");
          if (!moduleId.includes("node_modules")) return undefined;
          if (moduleId.includes("/ogl/")) return "vendor-webgl";
          if (
            moduleId.includes("/three/") ||
            moduleId.includes("/@react-three/")
          ) {
            return "vendor-three";
          }
          if (moduleId.includes("/lucide-react/")) return "vendor-icons";
          if (
            moduleId.includes("/@tauri-apps/") ||
            moduleId.includes("/class-variance-authority/") ||
            moduleId.includes("/clsx/") ||
            moduleId.includes("/tailwind-merge/")
          ) {
            return "vendor";
          }
          if (
            moduleId.includes("/react/") ||
            moduleId.includes("/react-dom/") ||
            moduleId.includes("/scheduler/") ||
            moduleId.includes("/use-sync-external-store/")
          ) {
            return "vendor-ui";
          }
          if (moduleId.includes("/@radix-ui/")) return "vendor-radix";
          if (
            moduleId.includes("/motion/") ||
            moduleId.includes("/framer-motion/")
          ) {
            return "vendor-motion";
          }
          if (moduleId.includes("/@tanstack/")) return "vendor-query";
          if (moduleId.includes("/sonner/")) return "vendor-toast";
          return "vendor-ui";
        },
      },
    },
  },
});
