/**
 * 构建前检查：前端路由和后端路由有没有**完整路径**撞车。
 *
 * 为什么要查：nginx 把 {BASE}/* 全部转给后端，后端匹配不到任何业务路由才兜底
 * 发 SPA 外壳。所以只要某条前端路由的完整路径能被后端某条路由匹配上，
 * 那条前端路由**永远到不了浏览器**——后端先把请求接走了。
 * 症状是「本地 dev 好好的，部署上去点那个菜单就下载了一坨 JSON」。
 *
 * ★ 比的是**完整路径**不是首段。后端只有 /email/list、/email/send，
 *   没有 /email 本身，所以前端用 /email 当页面地址是安全的。
 *   按首段比会误报，按完整路径比才准。
 *
 * 后端路由表直接从 FastAPI 应用读，不手工维护 —— 手工表迟早和真实路由漂移，
 * 而漂移的方向恰好是"检查通过但线上撞车"。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const front = resolve(here, "..");
const repo = resolve(front, "..");

const PY = `
import sys; sys.path.insert(0, '.')
import backend.main
from backend.main import app

def walk(routes, out):
    for r in routes:
        if hasattr(r, "path") and hasattr(r, "methods"):
            out.append(r.path)
        for attr in ("routes", "original_router"):
            sub = getattr(r, attr, None)
            if sub is not None:
                walk(getattr(sub, "routes", sub) if attr == "original_router" else sub, out)

out = []
walk(app.routes, out)
# {x:int} / {x:path} 归一成 {x}；catch-all 本身就是兜底，不算冲突
import re
seen = set()
for p in out:
    p = re.sub(r"\\{(\\w+):[^}]+\\}", r"{\\1}", p)
    if p in ("/{spa_path}", "/{path}"):
        continue
    seen.add(p)
print("\\n".join(sorted(seen)))
`;

let backendPaths;
try {
  const out = execFileSync(resolve(repo, "venv/bin/python"), ["-c", PY], {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  backendPaths = new Set(out.trim().split("\n").filter(Boolean));
} catch {
  // 只装了前端（比如 CI 的前端 job）时拿不到后端，跳过而不是让构建失败。
  console.log("⊙ 跳过路由冲突检查：拿不到后端路由表");
  process.exit(0);
}

// 前端路由：从 router.tsx 里抓 path: "..."，把 :id 归一成 {id}
const src = readFileSync(resolve(front, "src/app/router.tsx"), "utf8");
const frontendPaths = [...src.matchAll(/path:\s*"([^"]+)"/g)]
  .map((m) => m[1])
  .filter((p) => p !== "*")
  .map((p) => (p.startsWith("/") ? p : `/${p}`))
  .map((p) => p.replace(/:(\w+)/g, "{$1}"));

const clashes = frontendPaths.filter((p) => backendPaths.has(p));

if (clashes.length > 0) {
  console.error("\n✗ 前端路由与后端路由完整路径撞车，这些前端路由永远到不了浏览器：\n");
  for (const c of clashes) console.error(`    ${c}`);
  console.error(
    "\n  解决：改前端路由名（用户可见的地址优先），或者改后端路由路径。\n" +
      "  已有先例：旧前端 /info 与后端 /info/* 撞车，前端改成了 /about。\n",
  );
  process.exit(1);
}

console.log(
  `✓ 路由无冲突（前端 ${frontendPaths.length} 条 / 后端 ${backendPaths.size} 条）`,
);
