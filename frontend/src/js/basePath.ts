import { API_BASE } from "./apiBase";

// ============================================================================
// 项目路径前缀（BASE_PATH）
// ----------------------------------------------------------------------------
// 多个项目共用一个域名之后，本项目住在 https://host/UTBA_DEMO/ 下面，
// 而不是住在 /。应用内部的路由表**不变**（还是 /account/... /event/...），
// 只在「要发到网络上去的 URL」这一刻补上前缀 —— 这样本地开发（前缀为空、
// 不起 nginx）和线上（前缀 /UTBA_DEMO）跑的是同一份代码。
//
// 值从 VITE_BASE_PATH 注入，**构建期**替换进包里。三条注入渠道互不覆盖：
//   网页构建 npm run build      → .env.production（scripts/gen_frontend_env.sh 生成）
//   APK 构建 npm run build:apk  → .env + .env.apk（读不到 .env.production）
//   本地 dev npm run dev        → 没有 .env 文件 → undefined → ""
//
// ★ 为什么单独一个模块，而不是并进 apiBase.ts 的 API_BASE：
//   apiBase.ts 的 `IS_APK = Boolean(API_BASE)` 是全仓「是不是 APK」的唯一判据。
//   网页构建一旦把 /UTBA_DEMO 写进 API_BASE，API_BASE 非空 → IS_APK=true →
//   网页版开始走原生响应缓存、原生音乐桥、native Authorization 头，并把同源请求
//   当跨域处理。所以 API_BASE 永远只装 origin，前缀住在这里。
// ============================================================================

/**
 * 归一化：有前导斜杠、无尾随斜杠、空值就是空字符串。
 *
 * 这套规则必须和另外两处**逐字一致**，否则拼出来的地址会差一个斜杠：
 *   - scripts/gen_frontend_env.sh（生成 .env.production 时先归一化一次）
 *   - 后端 core/config.py 的 APP_BASE_PATH
 * 差一个斜杠的表现是 `//members`（nginx 也许还能忍）或 `/UTBA_DEMOmembers`（直接死）。
 */
function normalizeBasePath(raw: unknown): string {
  const value = String(raw ?? "").trim();
  // 单个 "/" 等价于「没有前缀」：留着它会让每个 URL 多一个斜杠。
  if (!value || value === "/") return "";
  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  return withLeadingSlash.replace(/\/+$/, "");
}

/** 项目路径前缀，例如 `/UTBA_DEMO`；没配就是 `""`（＝行为与加前缀之前完全一致）。 */
export const BASE_PATH: string = normalizeBasePath(import.meta.env.VITE_BASE_PATH);

/**
 * 请求根 = origin + 前缀。
 * 网页版 API_BASE 为空 → API_ROOT 就是 `/UTBA_DEMO`（相对）；
 * APK 版 API_BASE 是 https://utbabuddha.com → API_ROOT 是绝对地址。
 * 绕过 apiFetch 自己拼 URL 的地方（img src / xhr.open / 下载直链）应当用它。
 */
export const API_ROOT: string = `${API_BASE}${BASE_PATH}`;

/** 绝对 URL（带协议或协议相对）一律原样放行：那是别人已经拼好的地址，再加工就是双前缀。 */
function isAbsoluteUrl(path: string): boolean {
  return path.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(path);
}

/**
 * 内部路径 → 带前缀的**相对路径**（给 fetch / EventSource 用）。
 *
 *   BASE_PATH = ""            apiPath("/claims") → "/claims"   （与现在逐字节一致）
 *   BASE_PATH = "/UTBA_DEMO"  apiPath("/claims") → "/UTBA_DEMO/claims"
 *
 * **幂等**：已经带前缀的路径不会再补一遍。多条链路会叠加（apiFetch 补一次、
 * APK 缓存层重拼 URL 又补一次；后端 public_url() 给的地址前端又拼一次），
 * 幂等是这里唯一的防线。
 */
export function apiPath(path: string): string {
  const raw = String(path ?? "");
  if (isAbsoluteUrl(raw)) return raw;

  // 统一成单个前导斜杠，免得 "members" 和 "/members" 拼出两种结果。
  const normalized = `/${raw.replace(/^\/+/, "")}`;
  if (!BASE_PATH) return normalized;
  if (normalized === BASE_PATH || normalized.startsWith(`${BASE_PATH}/`)) return normalized;
  return `${BASE_PATH}${normalized}`;
}

/**
 * 对外分享的 origin。优先级从高到低：
 *   1. VITE_PUBLIC_ORIGIN —— 配置里写死的对外域名，和后端 absolute_url() 用的是同一个值
 *   2. API_BASE          —— APK 里 window.location.origin 是 capacitor://localhost，
 *                           拿它拼二维码就是一张扫不开的码
 *   3. window.location.origin —— 网页版/本地 dev 的现状行为
 */
function publicOrigin(): string {
  const configured = String(import.meta.env.VITE_PUBLIC_ORIGIN ?? "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  if (API_BASE) return API_BASE.replace(/\/+$/, "");
  return typeof window !== "undefined" ? window.location.origin : "";
}

/**
 * 内部路径 → 可对外分享的**绝对 URL**（二维码、短链、分享链接、下载兜底都用它）。
 *
 *   BASE_PATH = ""            publicUrl("/mirror") → "http://localhost:5173/mirror"
 *   BASE_PATH = "/UTBA_DEMO"  publicUrl("/mirror") → "https://host/UTBA_DEMO/mirror"
 *
 * 前缀为空时结果和现在满仓写的 `${window.location.origin}${path}` 逐字节相同。
 * 注意 `/#/login` 这种：`#` 前面那个 `/` 是**文档根**不是路由，同样要带前缀，
 * 否则跳出本项目 —— HashRouter「不受前缀影响」只是说路由表不用改。
 */
export function publicUrl(path: string): string {
  const raw = String(path ?? "");
  // 后端返回的 share_url 之类往往已经是绝对地址（且已由 public_url() 带好前缀），
  // 约定：后端给的 URL 前端一律不再加工。
  if (isAbsoluteUrl(raw)) return raw;
  return `${publicOrigin()}${apiPath(raw)}`;
}
