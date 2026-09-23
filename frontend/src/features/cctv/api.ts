/**
 * 监控（CCTV）。后端 backend/api/camera/router.py（挂载前缀 /move_camera）。
 *
 * ★★★ 视频本身**不走我们的后端**。两条链路都是 nginx 挂在**域名根目录**上的
 *      location，不在 BASE_PATH 底下：
 *
 *        直播  wss://{host}/cctv_go2rtc/api/ws?src=cam1   → go2rtc (127.0.0.1:1984)
 *        回放  https://{host}/cctv_rec/cam1/*.mp4         → alias /srv/cctv/rec/cam1/
 *
 *      所以这两个地址**不能过 apiPath()/apiUrl()** —— 拼成 /UTBA_DEMO/cctv_rec/… 就是 404。
 *      只能用 API_BASE（请求 origin；网页版是空串 = 同源）。
 *
 *      而 `/cctv_go2rtc/api/ws` 里的 `/api` 是 **go2rtc 自己的**接口前缀，不是我们的
 *      —— 我们的后端在 v3 里已经没有 /api 这一段了，但这条不能跟着去掉，去掉就 404。
 *
 *      两条链路都由 nginx 的 `auth_request /cctv_authz` 把关，它背后就是本模块的
 *      /move_camera/authz（只看状态码：204 放行 / 401 / 403 拒绝）。它认的是**会话 Cookie**，
 *      所以 APK 那套 Bearer 在这里不算数（详见页面里的说明和交接备注）。
 */
import { http } from "@/shared/api/client";
import { ApiError } from "@/shared/api/errors";
import { API_BASE } from "@/shared/config/env";
import { isAbsoluteUrl } from "@/shared/config/paths";

import type { PtzResponse, Recording, RecordingsResponse } from "./types";

/** 只有一路摄像头。加第二路要先动 go2rtc 配置和 nginx 的 location，不是前端改个常量的事。 */
export const CAMERA_SRC = "cam1";

export const cctvKeys = {
  all: ["cctv"] as const,
  recordings: () => [...cctvKeys.all, "recordings"] as const,
};

/**
 * 直播信令的 WebSocket 地址。
 * http→ws、https→wss 靠替换前 4 个字符（"https" 也被覆盖，剩下的 "s" 留在原处）。
 */
export function streamWsUrl(src: string = CAMERA_SRC): string {
  const origin = API_BASE || window.location.origin;
  return `${origin.replace(/^http/, "ws")}/cctv_go2rtc/api/ws?src=${encodeURIComponent(src)}`;
}

/**
 * 录像的可播放/可下载地址。
 * 后端给的是根目录相对路径，网页版直接能用；APK 里 location.origin 是
 * capacitor://localhost，相对路径会指到壳内部，所以要补上真实 origin。
 */
export function recordingUrl(recording: Recording): string {
  return isAbsoluteUrl(recording.url) ? recording.url : `${API_BASE}${recording.url}`;
}

/** 录像列表，最新的在最前面（后端已经 reverse 过，前端不要再排一次）。 */
export async function fetchRecordings(): Promise<Recording[]> {
  const res = await http.get<RecordingsResponse>("/move_camera/recordings");
  // 后端出错是 500 + {ok:false,error}，http 客户端已经抛成 ApiError 了。
  // 这里防的是「200 但 ok:false」—— 真出现时别让页面拿着空列表显示「暂无录像」，
  // 那会让人以为录像没了，其实是列目录失败。
  if (!res.ok) throw new ApiError(res.error || "录像列表加载失败", 200, res);
  return res.items ?? [];
}

/** 云台速度向量，范围 −1 ~ 1。x 左右、y 上下、z 变焦；不传的轴按 0 算。 */
export interface PtzVector {
  x?: number;
  y?: number;
  z?: number;
}

/**
 * 云台移动。
 *
 * ★ 这是**持续移动**指令：后端发完 ContinuousMove 会起一个 100 秒的兜底 stop 定时器，
 *   松手时必须自己发 ptzStop()，否则镜头会一直转到那个定时器到点。
 *
 * ⚠️ dev 机上 system_config.env 的 CAM_USER / CAM_PASSWORD 是空的，这条会稳定回 503
 *    （文案是 ONVIF 的异常字符串）—— 那是配置没填，不是前端或迁移写坏了。
 */
export const ptzMove = (v: PtzVector) =>
  http.post<PtzResponse>("/move_camera/ptz/move", { x: v.x ?? 0, y: v.y ?? 0, z: v.z ?? 0 });

/** 云台停止（松手即停）。后端这条不读请求体。 */
export const ptzStop = () => http.post<PtzResponse>("/move_camera/ptz/stop");
