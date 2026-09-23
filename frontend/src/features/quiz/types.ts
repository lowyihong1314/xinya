/**
 * 后端 /quiz/* 的数据形状。见 backend/api/quiz/router.py 与 service.build_snapshot。
 *
 * ★ 每个字段都对着真实响应核过（scripts/api-shape.mjs）：
 *     GET /quiz/session/{token}    和    GET /quiz/session?token=…
 *   两条是**同一个**返回体 {"status":"success","session":{…}} —— Flask 时代它们本来
 *   就是一个视图函数的两条 rule，FastAPI 拆成两个函数后仍落到同一个 _session_snapshot_response。
 *   唯一没实测到的是新建接口外层多出来的 token 字段（要登录，401 下看不到形状），
 *   已在下面单独标注。
 */

/**
 * 活动状态。语义是**倒计时**，不是"开放时长"（见 service._status_for_session）：
 *   draft    还没发布，或被主持人退回发布页
 *   waiting  已发布，倒数中 —— 还不能抢
 *   open     到了 cutoff，可以抢；★ 永不自动关闭，只能主持人 reset / close
 *   closed   主持人关了
 * 状态是后端**每次现算**的（拿 server_now_ms 和 cutoff_at_ms 比），不是存下来的字段，
 * 所以 waiting → open 这一步不会有推送 —— 客户端只能靠下一帧 snapshot 或轮询看到。
 */
export type QuizStatus = "draft" | "waiting" | "open" | "closed";

export interface QuizConfig {
  title: string;
  /** 倒数秒数：发布后多少秒变成可抢。后端限 3~600，超范围回 400 invalid_wait_seconds。 */
  wait_seconds: number;
}

/** 榜上一行。后端用 hsetnx 保证一个 guest_id 只会有一条。 */
export interface QuizEntry {
  /** 1 起算，按 server_received_at_ms 排序后编的号。 */
  rank: number;
  guest_id: string;
  guest_name: string;
  /** 客户端点下去的时刻。参数没传或者传了个非数字时后端存 null。 */
  client_clicked_at_ms: number | null;
  /** 服务端收到的时刻 —— ★ 名次只按它排，不看客户端时间（客户端时间能改）。 */
  server_received_at_ms: number;
  /** 比截止时刻晚了多少毫秒，榜上显示的 "+123ms" 就是它。 */
  delta_from_cutoff_ms: number;
}

export interface QuizSnapshot {
  /** 6 位小写字母数字。token 本身就是凭证：谁拿到谁能看，主持人和观众不做区分。 */
  room_token: string;
  status: QuizStatus;
  /** 服务端此刻的毫秒时间戳。★ 倒计时必须拿它校准本地时钟，现场手机差几十秒很常见。 */
  server_now_ms: number;
  config: QuizConfig;
  /** 截止时刻 = published_at_ms + wait_seconds*1000。未发布时 null。 */
  cutoff_at_ms: number | null;
  published_at_ms: number | null;
  /**
   * 在场人数。Redis 抖动时后端把异常吞成 0（service.guest_count），
   * 而且登记/注销挂在 SSE 的连接生命周期上、断开发现得很慢 —— **别当强一致的数**。
   */
  player_count: number;
  leaderboard: QuizEntry[];
  /** token 的 24h TTL 到期时刻。整场活动只在 Redis 里，过期即消失，没有表可查。 */
  token_expires_at_ms: number | null;
}

/**
 * 读快照的两条 GET、保存/发布/重置/关闭四条 POST、以及参与者的
 * /quiz/guest/join 与 /quiz/guest/tap —— **八条的成功响应都是这个外层**。
 * （join 和 tap 的 200 体实测过：一样是 {"status":"success","session":{…}}。）
 */
export interface QuizSessionResponse {
  status: string;
  session: QuizSnapshot;
}

/**
 * POST /quiz/session（新建）。比上面多一个顶层 token。
 *
 * ⚠️ **形状来自后端代码（router.py create_quiz_session 的 return），未实测** ——
 *    这条要登录，未登录只拿得到 401。内层 session 与上面同一个 build_snapshot，
 *    已实测；顶层 token 是冗余字段（=== session.room_token），后端注释说前端两处都在读。
 */
export interface QuizCreateResponse extends QuizSessionResponse {
  token: string;
}

/**
 * POST /quiz/time/ping（对时）。
 *
 * client_sent_at_ms 是**原样回显**客户端送上来的那个值 —— 客户端据此算
 * 往返延迟并折半，估出自己与服务端的时钟差。
 * ⚠️ 必须是 POST：做成 GET 会被浏览器/nginx 缓存住，缓存下来的 server_now_ms
 *    会让所有人的偏移一起算错。
 */
export interface QuizTimePingResponse {
  status: string;
  server_now_ms: number;
  /** 后端原样回显；客户端没传就是 null。 */
  client_sent_at_ms: number | null;
}

/**
 * 出错时后端在 {"status":"error","message":"中文"} 之外还带一个 reason，
 * 页面按它分支（http 客户端把整个响应体原样放在 ApiError.body 里）。
 *
 * 实测过 missing_token（GET /quiz/session 不带 token）、invalid_token、session_not_found
 * 和 already_tapped（POST /quiz/guest/tap 重复抢，409）。
 *
 * ★ 抢答的四个拒绝理由文案上有重叠：not_published 和 too_early 都是「抢答还未开始」，
 *   只有 reason 不同（后者是"发布了但还在倒数"）。要分开说就按 reason 分支，
 *   别指望 message 不一样。
 */
export type QuizErrorReason =
  | "missing_token"
  | "invalid_token"
  | "session_not_found"
  | "invalid_wait_seconds"
  | "token_generation_failed"
  | "server_error"
  | "closed"
  | "not_published"
  | "too_early"
  | "already_tapped"
  | "missing_guest_name";
