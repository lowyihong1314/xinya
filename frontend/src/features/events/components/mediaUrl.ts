/**
 * 相册文件的访问地址。
 *
 * 两步：
 *   ① GET /media/get_event_image/{fileId}/{type} → {ready, path}
 *      type 只认 "cache"（缩略/转码后）等几个值，传别的回 {"status":"error","message":"Invalid type"}。
 *      视频要转码，没转完时后端返回 202 + ready:false，要过一会儿再问。
 *   ② 拿到的 path 是 DATA_ROOT 下的**相对路径**，拼成 {API_ROOT}/media_file/{path}。
 *
 * ⚠️ 必须用 API_ROOT（= origin + BASE_PATH），不能裸写 "/media_file/..."：
 *    · APK 里没有同源概念，裸路径会去找 capacitor://localhost/media_file/…，图全是裂的；
 *    · 加了 BASE_PATH 部署后，裸路径少一段前缀，同样 404。
 *    旧前端的 mediaUrl() 就是 `${API_BASE}/media_file/${path}` —— 少了 BASE_PATH，
 *    这是搬过来时顺手修掉的一个既有 bug。
 */
import { http } from "@/shared/api/client";
import { API_ROOT } from "@/shared/config/env";

export interface MediaPathResponse {
  status: string;
  /** false 表示还在转码，稍后重试。 */
  ready: boolean;
  kind?: string;
  cache?: boolean;
  path?: string;
}

/** 相对路径 → 可直接放进 <img src> 的地址。 */
export function mediaUrl(path: string): string {
  return `${API_ROOT}/media_file/${String(path).replace(/^\/+/, "")}`;
}

export const fetchMediaPath = (fileId: number, type: "cache" = "cache") =>
  http.get<MediaPathResponse>(`/media/get_event_image/${fileId}/${type}`);
