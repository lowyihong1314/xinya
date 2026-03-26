import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(({ command, mode }) => {
  const isBuild = command === "build";
  const isApk = mode === "apk";

  return {
    plugins: [react()],
    base: isApk ? "./" : isBuild ? "/static/vite/" : "/",

    server: {
      port: 5173,
      strictPort: true,

      // ✅ 只代理你指定的后端路由
      proxy: {
        // 例：后端 API 前缀
        "^/api(/|$)": {
          target: "http://localhost:5015",
          changeOrigin: true,
        },
        "^/static(/|$)": {
          target: "http://localhost:5015",
          changeOrigin: true,
        },

        // 你提到的媒体路由（按你的实际路径二选一或都留着）
        "^/media(/|$)": {
          target: "http://localhost:5015",
          changeOrigin: true,
        },
        "^/media_file(/|$)": {
          target: "http://localhost:5015",
          changeOrigin: true,
        },
      },
    },

    build: isApk
      ? {
          // APK build: standard Vite output with index.html for Capacitor
          outDir: "apk_dist",
          emptyOutDir: true,
        }
      : {
          // Web build: single init.js entry loaded by Flask template
          outDir: "../static/vite",
          emptyOutDir: true,
          rollupOptions: {
            input: path.resolve(__dirname, "./main.tsx"),
            output: {
              entryFileNames: "init.js",
              assetFileNames: "assets/[name]-[hash][extname]",
            },
          },
        },
  };
});
