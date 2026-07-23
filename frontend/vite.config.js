import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(({ command, mode }) => {
  const isBuild = command === "build";
  const isApk = mode === "apk";

  return {
    plugins: [react()],
    base: isApk ? "./" : isBuild ? "/static/vite/" : "/",
    resolve: {
      alias: {
        sweetalert2: path.resolve(
          __dirname,
          "./node_modules/sweetalert2/dist/sweetalert2.esm.all.js",
        ),
      },
    },

    server: {
      port: 5173,
      strictPort: true,

      // ✅ 只代理你指定的后端路由
      proxy: {
        // 例：后端 API 前缀
        "^/api(/|$)": {
          target: "http://localhost:5102",
          changeOrigin: true,
        },
        "^/static(/|$)": {
          target: "http://localhost:5102",
          changeOrigin: true,
        },

        // 你提到的媒体路由（按你的实际路径二选一或都留着）
        "^/media(/|$)": {
          target: "http://localhost:5102",
          changeOrigin: true,
        },
        "^/media_file(/|$)": {
          target: "http://localhost:5102",
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
              formPayment: path.resolve(__dirname, "./formPayRegisterMain.tsx"),
              formPublic: path.resolve(__dirname, "./formPublicMain.tsx"),
              memberPortal: path.resolve(__dirname, "./memberPortalMain.tsx"),
              scorePanel: path.resolve(__dirname, "./scorePanelMain.tsx"),
              musicPortal: path.resolve(__dirname, "./musicPortalMain.tsx"),
              parentalSign: path.resolve(__dirname, "./parentalSignMain.js"),
            },
            output: {
              entryFileNames: (chunkInfo) => {
                if (chunkInfo.name === "app") return "init.js";
                if (chunkInfo.name === "changyouRoom") return "changyou-room.js";
                if (chunkInfo.name === "formPayment") return "form-payment.js";
                if (chunkInfo.name === "formPublic") return "form-public.js";
                if (chunkInfo.name === "memberPortal") return "member-portal.js";
                if (chunkInfo.name === "scorePanel") return "score-panel.js";
                if (chunkInfo.name === "musicPortal") return "music-portal.js";
                if (chunkInfo.name === "parentalSign") return "parental-sign.js";
                return "assets/[name]-[hash].js";
              },
              chunkFileNames: "assets/[name]-[hash].js",
              assetFileNames: "assets/[name]-[hash][extname]",
            },
          },
        },
  };
});
