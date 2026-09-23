/**
 * 构建前检查：前端路由的顶层段有没有和后端路由撞车。
 *
 * 为什么必须查：nginx 把 {BASE}/* 全部转给后端，由后端兜底发 SPA 外壳。
 * 也就是说，只要某条前端路由的第一段和后端某条路由的第一段重名，
 * 那条前端路由**永远到不了浏览器**——后端先把请求接走了。
 * 症状是「本地 dev 好好的，部署上去点那个菜单就下载了一坨 JSON」。
 *
 * 两份清单分别来自：
 *   前端 src/app/routes.ts 的 FRONTEND_TOP_SEGMENTS
 *   后端 vite.config.ts 的 BACKEND_ROUTES
 * 两边都是**手工维护**的，加路由时要记得同步 —— 这个脚本就是那道提醒。
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

function extractArray(file, varName) {
  const src = readFileSync(resolve(root, file), "utf8");
  const start = src.indexOf(varName);
  if (start === -1) throw new Error(`${file} 里找不到 ${varName}`);
  const open = src.indexOf("[", start);
  const close = src.indexOf("]", open);
  return [...src.slice(open, close).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

const frontend = extractArray("src/app/routes.ts", "FRONTEND_TOP_SEGMENTS");
const backend = extractArray("vite.config.ts", "BACKEND_ROUTES");

const clashes = frontend.filter((seg) => backend.includes(seg));

if (clashes.length > 0) {
  console.error("\n✗ 前端路由与后端路径撞车，这些前端路由永远到不了浏览器：\n");
  for (const c of clashes) console.error(`    /${c}`);
  console.error(
    "\n  解决：改前端路由名（用户可见的地址优先），或者改后端挂载前缀。\n" +
      "  已有先例：旧前端 /info 与后端 /info/* 撞车，前端改成了 /about。\n",
  );
  process.exit(1);
}

console.log(`✓ 路由无冲突（前端 ${frontend.length} 段 / 后端 ${backend.length} 段）`);
