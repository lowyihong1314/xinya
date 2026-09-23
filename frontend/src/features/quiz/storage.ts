/**
 * 抢答的本地记忆。三个键都沿用老前端的名字，这样重写前后**同一台设备不丢身份**：
 * 主持人刷新不会丢掉手上这场活动，观众重新进来还是同一个 guest_id（榜上不会出现两个自己）。
 *
 * 为什么 guest 身份在 localStorage 而不在会话里：抢答页是给现场**未登录**的观众用的，
 * 没有账号可挂。token 本身就是凭证，身份只需要"同一台设备是同一个人"这点强度。
 */

/** 主持人手上这场活动的 token。 */
const HOST_TOKEN_KEY = "xinya.quiz.hostToken";
/** 观众的匿名 id —— 后端拿它做 hsetnx 的键，一人一次就是按它算的。 */
const GUEST_ID_KEY = "xinya.quiz.guestId";
/** 观众上次填的名字，省得每场都重打。 */
const GUEST_NAME_KEY = "xinya.quiz.guestName";

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // 隐私模式 / 禁用站点数据时，访问 localStorage 本身就会抛。
    return null;
  }
}

function safeSet(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* 存不下就当没存：退化成"刷新后要重新扫码"，比整页崩掉好。 */
  }
}

export const quizStorage = {
  getHostToken: () => safeGet(HOST_TOKEN_KEY) ?? "",
  setHostToken: (token: string | null) => safeSet(HOST_TOKEN_KEY, token),

  getGuestName: () => safeGet(GUEST_NAME_KEY) ?? "",
  setGuestName: (name: string) => safeSet(GUEST_NAME_KEY, name),

  /** 取 guest_id，没有就现生一个并记下来。 */
  getOrCreateGuestId(): string {
    const existing = safeGet(GUEST_ID_KEY);
    if (existing) return existing;
    // 够用即可：它不是凭证，只是"这台设备是谁"。crypto.randomUUID 在老 WebView 上可能没有。
    const next = `g_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    safeSet(GUEST_ID_KEY, next);
    return next;
  },
};
