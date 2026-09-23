/**
 * 这台设备叫什么 —— 报给服务端在下拉里显示。
 *
 * 服务端认不出设备，只做长度截断，所以名字**完全由客户端决定**。
 * 目标是让人一眼认出「哪个是我现在看的这个」，不是精确识别机型。
 */
import { IS_APK } from "@/shared/config/env";

function browserName(ua: string): string {
  // 顺序有讲究：Edge 的 UA 里有 Chrome，Chrome 的 UA 里有 Safari。
  // 从最具体的往回判，否则全都会认成 Safari。
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "浏览器";
}

function platformName(ua: string): string {
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Mac OS X/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  if (/Linux/.test(ua)) return "Linux";
  return "";
}

export function currentDeviceName(): string {
  if (typeof navigator === "undefined") return "未知设备";
  const ua = navigator.userAgent || "";
  if (IS_APK) return `心芽 APK · ${platformName(ua) || "手机"}`;
  const platform = platformName(ua);
  return platform ? `${browserName(ua)} · ${platform}` : browserName(ua);
}

export function currentDeviceKind(): "apk" | "web" {
  return IS_APK ? "apk" : "web";
}
