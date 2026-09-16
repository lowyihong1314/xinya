const VISITOR_TOKEN_KEY = "xinya.visitorToken";

/**
 * 未登录访客的浏览器标识：相册爱心这类「一人一次」的动作用它认人。
 * 登录用户以账号为准，这个 token 只是访客的兜底身份。
 */
export function getVisitorToken(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.localStorage.getItem(VISITOR_TOKEN_KEY);
    if (existing) return existing;
    const next = `v_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    window.localStorage.setItem(VISITOR_TOKEN_KEY, next);
    return next;
  } catch {
    // 隐私模式下 localStorage 可能直接抛错：没 token 就按不了，但页面照常看
    return "";
  }
}
