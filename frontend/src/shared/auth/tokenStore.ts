/**
 * APK 的令牌存储。
 *
 * 只有壳里用得着：网页版靠会话 Cookie，浏览器自己管，前端一个字都不用存。
 * 壳里 capacitor:// 与站点不同源，Cookie 不可靠，所以换成 Bearer。
 *
 * ⚠️ 存在 localStorage 里。这是既有方案，不是本次新决定的 —— 要提高安全性
 *    得改成 Capacitor 的安全存储，那是独立的一件事（会影响已发出去的 APK）。
 */
const ACCESS_KEY = "xinya.access_token";
const REFRESH_KEY = "xinya.refresh_token";

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // 隐私模式 / 禁用站点数据时 localStorage 访问本身会抛。
    return null;
  }
}

function safeSet(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* 存不下就当没有：退化成每次都要重新登录，比整个页面崩掉好。 */
  }
}

export const tokenStore = {
  getAccess: () => safeGet(ACCESS_KEY),
  getRefresh: () => safeGet(REFRESH_KEY),
  set(access: string | null, refresh: string | null) {
    safeSet(ACCESS_KEY, access);
    safeSet(REFRESH_KEY, refresh);
  },
  clear() {
    safeSet(ACCESS_KEY, null);
    safeSet(REFRESH_KEY, null);
  },
};
