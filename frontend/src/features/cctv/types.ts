/**
 * 后端 /move_camera/* 的数据形状。见 backend/api/camera/router.py。
 *
 * ★ 形状来自后端代码，未实测。这几条接口都挂了 `@permission_required("cctv")`，
 *   而那个装饰器**未登录时返回 500**（文案「无法验证用户权限，请联系管理员。」，
 *   见 backend/core/auth.py 顶部第 19 行的说明），所以
 *   `node scripts/api-shape.mjs /move_camera/recordings` 这种匿名探测看不到成功体 ——
 *   探到的只有那句 500。键名是逐字抄 router.py 里 `json_response({...})` 的字面量。
 */

/** 一段已保存、可播放的录像。正在写入的那一段后端不会给（moov 未落盘，播不了）。 */
export interface Recording {
  /** 文件名，形如 2026-07-22_15-20-36.mp4。全局唯一，列表用它当 key。 */
  name: string;
  /** 开始时间，ISO8601 **带 UTC 时区标记**（文件名是服务器 UTC 时间）。解析不出来是 null。 */
  start: string | null;
  /** 时长（秒）= 下一段开始 − 本段开始。算不出来是 null，界面要能接受没有时长。 */
  duration: number | null;
  /** 字节数。 */
  size: number;
  /**
   * 可播放地址，形如 /cctv_rec/cam1/2026-07-22_15-20-36.mp4。
   * ★ 这是**域名根目录**上的 nginx location，不在 BASE_PATH 底下 ——
   *   后端特意没过 public_url()，前端也不能再拼前缀。取地址一律走 api.ts 的 recordingUrl()。
   */
  url: string;
}

/** 录像列表。失败时是 {ok:false, error} + 500，已被 http 客户端抛成 ApiError。 */
export interface RecordingsResponse {
  ok: boolean;
  items?: Recording[];
  error?: string;
}

/** 云台指令的回执。成功只有 {ok:true}，没有别的字段。 */
export interface PtzResponse {
  ok: boolean;
  error?: string;
}
