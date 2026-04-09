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
            input: {
              app: path.resolve(__dirname, "./main.tsx"),
              changyouRoom: path.resolve(__dirname, "./changyouRoomMain.tsx"),
              musicPortal: path.resolve(__dirname, "./musicPortalMain.tsx"),
            },
            output: {
              entryFileNames: (chunkInfo) => {
                if (chunkInfo.name === "app") return "init.js";
                if (chunkInfo.name === "changyouRoom") return "changyou-room.js";
                if (chunkInfo.name === "musicPortal") return "music-portal.js";
                return "assets/[name]-[hash].js";
              },
              chunkFileNames: "assets/[name]-[hash].js",
              assetFileNames: "assets/[name]-[hash][extname]",
            },
          },
        },
  };
});
