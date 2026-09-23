import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type ProxyOptions } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 归一化前缀：去尾斜杠、补前导斜杠。与 src/shared/config/env.ts 里那份保持一致。 */
function normalizeBasePath(raw?: string): string {
  const text = String(raw ?? "").trim();
  if (!text || text === "/") return "";
  const withLead = text.startsWith("/") ? text : `/${text}`;
  return withLead.replace(/\/+$/, "");
}

/**
 * 后端占用的顶层路径。
 *
 * v3 去掉了 /api 这一段（BASE_PATH 已经区分项目），所以 dev 代理不能再靠
 * "^/api" 一条规则认出后端请求，必须把后端占用的顶层路径逐个列出来。
 *
 * ⚠️ 新增后端模块（或改挂载前缀）时要同步这张表，否则 dev 下那个模块会 404
 *    而生产正常 —— 这种「只有 dev 坏」最费时间。
 *    scripts/check-route-collisions.mjs 会检查它和前端路由有没有撞车。
 */
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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "");
  const isApk = mode === "apk";
  const BASE_PATH = normalizeBasePath(env.VITE_BASE_PATH);
  const backend = env.VITE_DEV_BACKEND || "http://localhost:5102";

  const proxyEntry: ProxyOptions = { target: backend, changeOrigin: true };
  const proxy: Record<string, ProxyOptions> = Object.fromEntries(
    BACKEND_ROUTES.map((r) => [`^/${r}(/|$)`, proxyEntry]),
  );
  // 设了 VITE_BASE_PATH 时请求会变成 /UTBA_DEMO/members，上面几条 ^/ 开头的全落空。
  // 补一套带前缀的，转发前把前缀剥掉——等价于 nginx 里 proxy_pass 结尾那个斜杠。
  if (BASE_PATH) {
    for (const r of BACKEND_ROUTES) {
      proxy[`^${BASE_PATH}/${r}(/|$)`] = {
        ...proxyEntry,
        rewrite: (p: string) => p.slice(BASE_PATH.length),
      };
    }
  }

  return {
    plugins: [react(), tailwindcss()],

    // 网页构建：静态资源挂在 {前缀}/static/vite/ 下，由 nginx 的 location {前缀}/ 覆盖。
    // APK 构建：产物是本地文件（capacitor://localhost），永远相对路径。
    // dev：不起 nginx，保持 "/"。
    base: isApk ? "./" : mode === "production" ? `${BASE_PATH}/static/vite/` : "/",

    resolve: {
      alias: {
        // @ → src。深层相对路径（../../../../js/apiFetch）是旧代码最难读的地方之一。
        "@": path.resolve(__dirname, "./src"),
      },
    },

    define: {
      // APK 强制 hash 路由：壳里没有服务端做 try_files 兜底，
      // 路径路由一刷新就白屏。见 src/shared/config/env.ts 的 ROUTER_MODE。
      ...(isApk ? { "import.meta.env.VITE_ROUTER": JSON.stringify("hash") } : {}),
    },

    server: {
      port: 5173,
      strictPort: true,
      proxy,
    },

    build: {
      outDir: isApk ? "dist" : "../static/vite",
      emptyOutDir: true,
      sourcemap: mode !== "production",
    },
  };
});
