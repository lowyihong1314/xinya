/**
 * APK 发布（下载 App）。后端 backend/api/app_release/router.py（挂载前缀 /app）。
 *
 * ★ 后端这两条路由**都不鉴权**（照搬 Flask 现状，router.py 顶上写了理由），
 *   所以这一页放在 PublicLayout 下：扫码进来的人不用先登录，也不该被送去登录页。
 *
 * ⚠️ 前端页面地址是 /download，不是 /app/releases —— 后者会被后端先接走，
 *    用户点开只会看到一坨 JSON。/app 本身后端没占，但 /download 对用户更直白。
 */
import { http } from "@/shared/api/client";
import { IS_APK } from "@/shared/config/env";
import { apiPath, publicUrl } from "@/shared/config/paths";

import type { AppRelease, AppReleaseListResponse } from "./types";

export const appReleaseKeys = {
  all: ["app-releases"] as const,
  list: () => [...appReleaseKeys.all, "list"] as const,
};

/** 列出所有可下载的 APK。后端已按文件修改时间倒序，**第一个就是最新包**。
 *  这里剥掉外层的 {releases: …}，让页面直接拿数组 —— 少一层 `?.` 就少一处运行时 undefined。 */
export const fetchAppReleases = async (): Promise<AppRelease[]> =>
  (await http.get<AppReleaseListResponse>("/app/releases")).releases ?? [];

/**
 * 下载直链（给 <a href> 用）。
 *
 * ★ **不要**走 http 客户端把 APK 读成 blob 再存：8MB 起步的包要整个进内存，
 *   手机浏览器上足够把标签页打爆；而且那样会丢掉 Range —— 后端 FileResponse
 *   是流式的、支持断点续传，交给浏览器自己下最省事。
 *   附件下载所需的 Content-Disposition 后端已经带了，不需要前端做什么。
 *
 * apiPath() 是幂等的：后端 public_url() 拼过前缀时原样返回；万一后端那边
 * 读不到 X-Forwarded-Prefix（前缀退化成空），这里补上。两边都不会拼出双前缀。
 */
export function downloadHref(release: AppRelease): string {
  // APK 壳里页面是 capacitor://localhost 加载的，相对地址会落到壳自己身上（必 404），
  // 必须给绝对地址。publicUrl() 内部也走 apiPath()，同样幂等。
  return IS_APK ? publicUrl(release.download_url) : apiPath(release.download_url);
}
