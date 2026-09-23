/**
 * 构建前检查：前端引用的权限名在后端真实存在。
 *
 * 权限清单是**后端代码里的常量**（backend/core/permissions.py 的 permission_names），
 * 不是库里的行。前端写错一个字的症状是「这个菜单项/按钮该显示却不显示」——
 * 没有任何报错，只是那个人永远看不到那个功能，而且他会以为是没给他开权限。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const front = resolve(here, "..");
const repo = resolve(front, "..");

let known;
try {
  const out = execFileSync(
    resolve(repo, "venv/bin/python"),
    ["-c", "import sys;sys.path.insert(0,'.');from backend.core.permissions import permission_names;print('\\n'.join(sorted(permission_names)))"],
    { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  known = new Set(out.trim().split("\n").filter(Boolean));
} catch {
  // 只装了前端（比如 CI 的前端 job）时拿不到后端，跳过而不是让构建失败。
  console.log("⊙ 跳过权限校验：拿不到后端的 permission_names");
  process.exit(0);
}

const src = readFileSync(resolve(front, "src/app/navigation.ts"), "utf8");
const used = new Set();
for (const group of src.matchAll(/anyOf:\s*\[([^\]]*)\]/g)) {
  for (const m of group[1].matchAll(/"([^"]+)"/g)) used.add(m[1]);
}

const unknown = [...used].filter((p) => !known.has(p));
if (unknown.length > 0) {
  console.error("\n✗ 这些权限名在后端不存在，引用它们的菜单项永远不会显示：\n");
  for (const p of unknown) console.error(`    ${p}`);
  console.error(`\n  后端现有的 ${known.size} 个：\n    ${[...known].join(" ")}\n`);
  process.exit(1);
}

console.log(`✓ 权限名全部存在（用了 ${used.size} 个 / 后端共 ${known.size} 个）`);
