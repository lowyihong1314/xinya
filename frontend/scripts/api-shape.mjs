/**
 * 打印后端某条接口的真实响应形状，用来核对 types.ts。
 *
 *   node scripts/api-shape.mjs /songbook/list
 *   node scripts/api-shape.mjs /songbook/entry/457
 *
 * 为什么需要它：响应形状**只能从真实响应看**，不能从后端代码猜，也不能从
 * 列表接口的形状推详情接口。已经踩过一次：/songbook/list 返回 {entries:[...]}，
 * 而 /songbook/entry/{id} 返回 {entry:{...}} —— 按列表的形状写详情类型，
 * 编译通过、运行时 undefined。
 *
 * 默认打到 dev 站；用 XINYA_API 指向别处。
 */
const base = process.env.XINYA_API || "https://yukang.utbabuddha.com/UTBA_DEMO";
const path = process.argv[2];

if (!path) {
  console.error("用法: node scripts/api-shape.mjs /songbook/list");
  process.exit(2);
}

/** 递归描述形状：只记类型和键名，不打印真实数据（可能含个人信息）。 */
function shape(value, depth = 0) {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[${shape(value[0], depth + 1)}]  (${value.length} 项)`;
  }
  if (typeof value === "object") {
    if (depth > 2) return "{…}";
    const entries = Object.entries(value).map(
      ([k, v]) => `${"  ".repeat(depth + 1)}${k}: ${shape(v, depth + 1)}`,
    );
    return `{\n${entries.join("\n")}\n${"  ".repeat(depth)}}`;
  }
  return typeof value;
}

const res = await fetch(`${base}${path}`);
const text = await res.text();
console.log(`${res.status} ${res.headers.get("content-type") ?? ""}`);
try {
  console.log(shape(JSON.parse(text)));
} catch {
  console.log(text.slice(0, 200));
}
