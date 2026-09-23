/**
 * 路由表的**唯一**定义处。
 *
 * ★ 顶层路径段受后端约束：后端占着 38 个顶层路径（/members /form /music /gl …），
 *   而 nginx 把 {BASE}/* 全部转给后端、由后端兜底发 SPA 外壳。
 *   也就是说，**前端路由的第一段不能和后端路由的第一段重名**，
 *   重名的那条前端路由永远到不了浏览器（后端先把请求接走了）。
 *   scripts/check-route-collisions.mjs 会在构建前检查，撞了就让构建失败。
 *
 * 已知的一次改名：旧前端的 /info（关于我们）与后端 /info/* 撞车，
 * 前端改成 /about —— 用户可见的地址优先，接口地址是机器看的。
 */

/** 前端占用的顶层路径段。新增路由时**必须**同步到这里，检查脚本读的是它。 */
export const FRONTEND_TOP_SEGMENTS = [
  "login",
  "about",
  "profile",
  "event",
  "image",
  "changyou",
  "changyou-room",
  "lamp-registration",
  "ylp-registration",
  "ylp-shared",
  "ylp-board-terminal",
  "payment-voucher-sign",
  "forbidden",
  "not-found",
] as const;
