import { IS_APK } from "../../../js/apiBase";

const DEVICE_ID_KEY = "xinya.music.device.id";

function randomId() {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 网页端设备 id：存在 localStorage，同一浏览器保持不变。 */
export function getWebPlaybackDeviceId() {
  try {
    const stored = window.localStorage.getItem(DEVICE_ID_KEY);
    if (stored) return stored;
    const next = `web-${randomId()}`;
    window.localStorage.setItem(DEVICE_ID_KEY, next);
    return next;
  } catch {
    return `web-session-${randomId()}`;
  }
}

/** 从 UA 推一个人看得懂的设备名，例如「Chrome · Windows」。 */
export function getWebPlaybackDeviceName() {
  if (IS_APK) return "Android 手机";
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua) && !/Chrome/.test(ua)
          ? "Safari"
          : /Firefox\//.test(ua)
            ? "Firefox"
            : "浏览器";
  const os = /iPhone|iPad/.test(ua)
    ? "iPhone"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "Mac"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} · ${os}` : browser;
}
