import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("/ogl/")) return "vendor-webgl";
          if (id.includes("/lucide-react/")) return "vendor-icons";
          if (
            id.includes("/@tauri-apps/") ||
            id.includes("/class-variance-authority/") ||
            id.includes("/clsx/") ||
            id.includes("/tailwind-merge/")
          ) {
            return "vendor";
          }
          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/scheduler/") ||
            id.includes("/@tanstack/") ||
            id.includes("/motion/") ||
            id.includes("/framer-motion/") ||
            id.includes("/@radix-ui/") ||
            id.includes("/sonner/")
          ) {
            return "vendor-ui";
          }
          return "vendor-ui";
        },
      },
    },
  },
});
