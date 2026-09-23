import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// 归一化必须和 src/js/basePath.ts、scripts/gen_frontend_env.sh、后端 core/config.py
// **逐字一致**：有前导斜杠、无尾随斜杠、空值就是空字符串。
// 这里不能直接 import src/js/basePath.ts —— 配置文件跑在 Node 里，那边模块顶层就读
// import.meta.env，在 Node 里是 undefined，一 import 就炸。所以只好抄这五行。
function normalizeBasePath(raw) {
  const value = String(raw ?? "").trim();
  if (!value || value === "/") return "";
  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  return withLeadingSlash.replace(/\/+$/, "");
}

export default defineConfig(({ command, mode }) => {
  const isBuild = command === "build";
  const isApk = mode === "apk";

  // 项目路径前缀在**构建期**就要定下来：它会被拼进产物里每个 chunk 的 URL。
  // loadEnv 按 mode 读 .env 文件，并让命令行传进来的 VITE_* 覆盖文件里的值：
  //   npm run build      (mode=production) → .env / .env.production（gen_frontend_env.sh 生成）
  //   npm run build:apk  (mode=apk)        → .env / .env.apk      ★ 读不到 .env.production
  //   npm run dev        (mode=development)→ 没有 .env 文件 → "" → 与现在完全一致
  const env = loadEnv(mode, __dirname, "VITE_");
  const BASE_PATH = normalizeBasePath(env.VITE_BASE_PATH);

  // dev server 的代理规则是按「路径开头」匹配的，加了前缀就全打不中（见下面 proxy 处的说明）。
  const prefixedDevProxy = {};
  if (BASE_PATH) {
    for (const route of ["api", "static", "media", "media_file"]) {
      prefixedDevProxy[`^${BASE_PATH}/${route}(/|$)`] = {
        target: "http://localhost:5102",
        changeOrigin: true,
        rewrite: (p) => p.slice(BASE_PATH.length),
      };
    }
  }

  return {
    plugins: [react()],
    // 网页构建：静态资源挂在 {前缀}/static/vite/ 下，由 nginx 的 location {前缀}/ 覆盖。
    // APK 构建：产物是本地文件（capacitor://localhost），永远相对路径，前缀与它无关 ——
    //   APK 的前缀只作用在**请求后端**的地址上，那条路走 src/js/basePath.ts。
    // dev：不起 nginx，保持 "/"。
    base: isApk ? "./" : isBuild ? `${BASE_PATH}/static/vite/` : "/",
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

        // dev 一般不设 VITE_BASE_PATH（BASE_PATH="" 时下面这段是空对象，行为与现在一致）。
        // 但万一设了，请求会变成 /UTBA_DEMO/api/...，上面几条 ^/ 开头的规则全部落空 → 404。
        // 这里补一套带前缀的规则，转发前把前缀剥掉 —— 等价于 nginx 里 proxy_pass 结尾那个斜杠。
        ...prefixedDevProxy,
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
