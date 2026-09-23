/**
 * 环境与路径基座。**全仓唯一**一处读 import.meta.env，别在别处再读一遍。
 *
 * 三个值的关系：
 *   API_BASE   请求的 origin。网页版是空串（同源）；APK 版必须是绝对地址，
 *              因为 APK 里 location.origin 是 capacitor://localhost。
 *   BASE_PATH  本项目挂在域名下的哪一段（如 /UTBA_DEMO）。nginx 用它区分多个项目，
 *              这样新项目不用再加 CNAME 记录。
 *   API_ROOT   = API_BASE + BASE_PATH，请求根。绕过 http 客户端自己拼 URL 的地方
 *              （img src、下载直链、EventSource）用它。
 *
 * ⚠️ 后端路径里**没有 /api 这一段**：BASE_PATH 已经区分了项目，再套一层不带信息量。
 *    接口就是 {API_ROOT}/members、{API_ROOT}/songbook/list 这样。
 */

/** 归一化前缀：去掉尾斜杠、补上前导斜杠。空值返回空串。 */
function normalizeBasePath(raw: unknown): string {
  const text = String(raw ?? "").trim();
  if (!text || text === "/") return "";
  const withLead = text.startsWith("/") ? text : `/${text}`;
  return withLead.replace(/\/+$/, "");
}

export const API_BASE: string = String(import.meta.env.VITE_API_BASE ?? "")
  .trim()
  .replace(/\/+$/, "");

export const BASE_PATH: string = normalizeBasePath(import.meta.env.VITE_BASE_PATH);

/** 请求根 = origin + 前缀。 */
export const API_ROOT: string = `${API_BASE}${BASE_PATH}`;

/**
 * 是不是 APK/iOS 壳里跑。
 * 判据是「配了绝对 API_BASE」——网页版永远同源，只有壳里才需要指向远端。
 */
export const IS_APK: boolean = Boolean(API_BASE);

/**
 * 路由模式。网页版用真实路径（地址干净、能被收录、分享链接好看）；
 * APK 里页面是 file:// 或 capacitor:// 加载的本地文件，没有服务端做
 * try_files 兜底，刷新/深链会直接 404，所以壳里必须用 hash。
 * 构建时由 VITE_ROUTER 决定，默认跟着 IS_APK 走。
 */
export const ROUTER_MODE: "browser" | "hash" =
  (import.meta.env.VITE_ROUTER as "browser" | "hash") || (IS_APK ? "hash" : "browser");

/** 对外分享用的 origin（二维码、短链）。配置优先，因为 APK 里 location.origin 扫不开。 */
export const PUBLIC_ORIGIN: string =
  String(import.meta.env.VITE_PUBLIC_ORIGIN ?? "").trim().replace(/\/+$/, "") ||
  API_BASE ||
  (typeof window !== "undefined" ? window.location.origin : "");

export const IS_DEV: boolean = import.meta.env.DEV;
