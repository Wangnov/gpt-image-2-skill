import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { readFileSync } from "node:fs";

// Read version once at config load and expose it as a compile-time
// constant (`__APP_VERSION__`). Avoids importing package.json from app
// code (which would pull the whole manifest into the bundle) and
// avoids hardcoding a version that drifts from package.json on bumps.
const pkg = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "./package.json"), "utf-8"),
) as { version: string };

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
  build: {
    chunkSizeWarningLimit: 800,
    outDir: "dist",
    sourcemap: true,
    // 保留升级前的 JavaScript 浏览器语法基线。
    target: ["chrome87", "edge88", "firefox78", "safari14"],
    rolldownOptions: {
      output: {
        // 手工分组仍按源码顺序初始化，避免 React 与插件的循环依赖提前执行。
        strictExecutionOrder: true,
        codeSplitting: {
          includeDependenciesRecursively: false,
          groups: [
            {
              name: "vendor-webgl",
              test: /node_modules[\\/]ogl[\\/]/,
              priority: 100,
            },
            {
              name: "vendor-react-three",
              test: /node_modules[\\/]@react-three[\\/]/,
              priority: 100,
            },
            {
              name: "vendor-three",
              test: /node_modules[\\/]three[\\/]/,
              priority: 100,
            },
            {
              name: "vendor-icons",
              test: /node_modules[\\/]lucide-react[\\/]/,
              priority: 100,
            },
            {
              name: "vendor",
              test: /node_modules[\\/](?:@tauri-apps|class-variance-authority|clsx|tailwind-merge)[\\/]/,
              priority: 100,
            },
            {
              name: "vendor-radix",
              test: /node_modules[\\/]@radix-ui[\\/]/,
              priority: 100,
            },
            {
              name: "vendor-motion",
              test: /node_modules[\\/](?:motion|framer-motion)[\\/]/,
              priority: 100,
            },
            {
              name: "vendor-query",
              test: /node_modules[\\/]@tanstack[\\/]/,
              priority: 100,
            },
            {
              name: "vendor-toast",
              test: /node_modules[\\/]sonner[\\/]/,
              priority: 100,
            },
            { name: "vendor-ui", test: /node_modules/, priority: 0 },
          ],
        },
      },
    },
  },
});
