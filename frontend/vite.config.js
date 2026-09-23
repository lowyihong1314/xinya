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

  // ── 后端占用的顶层路径 ────────────────────────────────────────────────
  // v3 去掉了 /api 这一段（BASE_PATH 已经区分项目），所以 dev 代理不能再靠
  // "^/api" 一条规则认出后端请求，必须把后端占用的顶层路径逐个列出来。
  //
  // 为什么这样是安全的：前端是 **hash 路由**（createHashRouter），所有 SPA 导航
  // 都发生在路径 "/" 上（#/... 片段根本不会发给服务器）。所以除了 "/" 和 vite
  // 自己的开发资源（/@vite /src /node_modules …），其余路径都属于后端，不会撞车。
  //
  // ⚠️ 新增后端模块（或改挂载前缀）时要同步这张表，否则 dev 下那个模块会 404
  //    而生产正常 —— 这种「只有 dev 坏」最费时间。生成方式见
  //    docs/flask_to_fastAPI/00-迁移进度.md。
  const BACKEND_ROUTES = [
    // 基础设施
    "healthz", "time", "docs", "openapi.json", "static", "media", "media_file",
    // public_api（挂在根上）
    "ping", "forms", "members", "payments", "event_data", "get_file_data",
    // 各业务模块的挂载前缀
    "account", "app", "asset", "board_router", "changyou_room", "diy_paiwei",
    "email", "fahui_router", "files", "form", "gl", "info", "lampRegistration_API",
    "mirror", "mobile", "move_camera", "music", "payment", "permission",
    "print_paiwei", "quiz", "quiz_game", "songbook", "twilio", "user_control",
  ];

  // dev server 的代理规则是按「路径开头」匹配的，加了前缀就全打不中（见下面 proxy 处的说明）。
  const prefixedDevProxy = {};
  if (BASE_PATH) {
    for (const route of BACKEND_ROUTES) {
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

      // ✅ 只代理 BACKEND_ROUTES 里列出的后端路径，其余（含 "/"）留给 vite 自己
      proxy: {
        ...Object.fromEntries(
          BACKEND_ROUTES.map((route) => [
            `^/${route}(/|$)`,
            { target: "http://localhost:5102", changeOrigin: true },
          ]),
        ),

        // dev 一般不设 VITE_BASE_PATH（BASE_PATH="" 时下面这段是空对象，行为与现在一致）。
        // 但万一设了，请求会变成 /UTBA_DEMO/members，上面几条 ^/ 开头的规则全部落空 → 404。
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
