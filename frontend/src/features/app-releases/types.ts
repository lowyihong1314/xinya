/** 后端 /app/* 的数据形状。见 backend/api/app_release/router.py。
 *
 *  形状已用 scripts/api-shape.mjs 实测：GET /app/releases →
 *  {"releases":[{filename,size_bytes,size_label,download_url}]}，**裸字典不套信封**
 *  （后端那边特意没用 ok()，注释里写了理由：套一层 data 会让老前端解不出来）。
 */

/** 一个 APK 安装包。键名与后端 list_releases() 里拼的字典逐字对应。 */
export interface AppRelease {
  /** 形如 UTBA_BETA_v1.5.1_b10_20260701_1257.apk，也是列表的稳定 key。 */
  filename: string;
  size_bytes: number;
  /** 后端算好的可读大小（"8.2 MB"）。不要在前端再算一遍 —— 两套算法（1000 还是 1024）
   *  迟早对不上，同一个包在两个页面显示两种大小。 */
  size_label: string;
  /** 下载地址，后端已过 public_url()，**自带项目前缀**（/UTBA_DEMO/app/download/…）。
   *  前端仍要再过一次 apiPath()，理由见 api.ts 的 downloadHref()。 */
  download_url: string;
  [key: string]: unknown;
}

export interface AppReleaseListResponse {
  releases: AppRelease[];
}
