/**
 * 抢答。后端 backend/api/quiz/router.py（挂载前缀 /quiz）。
 *
 * ⚠️ 前端页面地址 /quiz 和 /quiz/host 都**不冲突**：后端只有 /quiz/session、
 *    /quiz/session/{token}、/quiz/realtime 这些完整路径，没有 /quiz 本身。
 *    （/quiz?token=… 这个地址是老主持台印在二维码里的，沿用它，已发出去的码还能扫。）
 *
 * ── 全部 10 条路由 ─────────────────────────────────────────────────────
 *    POST /quiz/session                    新建        需登录
 *    GET  /quiz/session?token=…            读快照      公开
 *    GET  /quiz/session/{token}            读快照      公开
 *    POST /quiz/session/{token}            存配置      需登录
 *    POST /quiz/session/{token}/publish    发布        需登录
 *    POST /quiz/session/{token}/reset      退回发布页  需登录
 *    POST /quiz/session/{token}/close      关闭        需登录
 *    POST /quiz/guest/join                 观众入场    公开
 *    POST /quiz/guest/tap                  ★ 抢答      公开
 *    POST /quiz/time/ping                  对时        公开
 *
 * ⚠️ **还差一件**：后端没有 core.realtime.register(RealtimeApp("quiz", …))
 *    —— 那段还在 router.py 的文档字符串里。所以 GET /quiz/realtime?room={token}
 *    现在回 404（实测），SSE 订阅连不上，页面靠 useQuizSession 里的轮询兜底。
 *    连带影响：拿不到 connection_id，下面几个 POST 因此发不出 sender
 *    （自己的广播会绕回来 —— 眼下没订上，所以还看不出问题）；
 *    断线时也没人把 guest 从在场集合里摘掉，只能等 2 小时 TTL 自己过期。
 */
import { http } from "@/shared/api/client";
import { ApiError } from "@/shared/api/errors";

import type {
  QuizConfig,
  QuizCreateResponse,
  QuizErrorReason,
  QuizSessionResponse,
  QuizSnapshot,
  QuizTimePingResponse,
} from "./types";

export const quizKeys = {
  all: ["quiz"] as const,
  session: (token: string) => [...quizKeys.all, "session", token] as const,
  /** 与服务端的时钟差。整个应用共用一份，不按房间分 —— 时钟是全局的事。 */
  clock: () => [...quizKeys.all, "clock"] as const,
};

/**
 * 实时订阅的 app 名。与 core.realtime.channel_of 拼频道用的第一段一致，
 * 房间传**裸 room_token** —— 写成 "quiz:abc" 会被拼成 rt:quiz:quiz:abc，永远收不到。
 */
export const QUIZ_REALTIME_APP = "quiz";

/**
 * 出向事件名。★ 三条推的都是同一份 snapshot，也就是说
 * 「发布 / 重置 / 关闭」都走 quiz:config_updated，客户端只认 snapshot 里的 status、
 * 不认是哪个动作。名字线上不能改：老主持台的 addEventListener 按这个名字挂着。
 */
export const QUIZ_EVENTS = {
  configUpdated: "quiz:config_updated",
  snapshot: "quiz:snapshot",
  leaderboard: "quiz:leaderboard",
} as const;

/** 后端 service.normalize_token 的前端版：大写和空格是扫码/手输最常见的两种脏数据。 */
export function normalizeQuizToken(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * 读一场活动的快照。
 *
 * 用路径形式而不是 ?token=：两条落到同一个实现，但路径形式在 token 为空时根本发不出去，
 * 不会白白换回一个 400 missing_token。**调用方自己保证 token 非空**（见 useQuizSession 的 enabled）。
 */
export const fetchQuizSession = async (token: string): Promise<QuizSnapshot> =>
  (await http.get<QuizSessionResponse>(`/quiz/session/${encodeURIComponent(token)}`)).session;

/** 新建一场。返回体外层还有个冗余的 token，这里只取 session（=== session.room_token）。 */
export const createQuizSession = async (): Promise<QuizSnapshot> =>
  (await http.post<QuizCreateResponse>("/quiz/session")).session;

/**
 * 存配置（标题 + 倒数秒数）。
 *
 * ⚠️ 必须包成 {"config": {...}}：后端是 ``payload.get("config") or payload``，
 *    传 {"config": {}} 会因为空字典是假值而**落回整个 payload** 去按平铺格式解析 ——
 *    所以这里永远传完整的 config，别传半个。
 *    校验（3~600 秒、标题 240 字）也全在后端，文案以它为准。
 */
export const saveQuizConfig = async (token: string, config: QuizConfig): Promise<QuizSnapshot> =>
  (await http.post<QuizSessionResponse>(`/quiz/session/${encodeURIComponent(token)}`, { config }))
    .session;

/** 发布：开始倒数。★ 会**清空这一轮的榜单**（service.publish_session 里 _clear_entries）。 */
export const publishQuizSession = async (token: string): Promise<QuizSnapshot> =>
  (await http.post<QuizSessionResponse>(`/quiz/session/${encodeURIComponent(token)}/publish`))
    .session;

/** 退回发布页：清掉发布时刻、截止时刻和整张榜，状态回 draft。不可撤销。 */
export const resetQuizSession = async (token: string): Promise<QuizSnapshot> =>
  (await http.post<QuizSessionResponse>(`/quiz/session/${encodeURIComponent(token)}/reset`))
    .session;

/** 关闭：状态置 closed，榜单留着。之后只能 reset 回 draft 重开一轮。 */
export const closeQuizSession = async (token: string): Promise<QuizSnapshot> =>
  (await http.post<QuizSessionResponse>(`/quiz/session/${encodeURIComponent(token)}/close`))
    .session;

// ─────────────────────── 参与者动作（公开，不需要登录）───────────────────────

export interface QuizGuestIdentity {
  guest_id: string;
  guest_name: string;
}

/**
 * 入场登记：把自己记进在场集合，主持台的人数会跟着动。
 *
 * 幂等（后端 add_guest 是"有就更新"），断线重连重发一次是安全的。
 * 名字为空回 400 missing_guest_name「请先输入名称」—— 文案用后端的。
 *
 * TODO(connection_id)：等 quiz 的 RealtimeApp 注册上以后，这里要把 SSE 的
 * connection_id 一起带上：服务端原样塞进广播信封的 sender，客户端才能丢掉
 * 自己的回声（否则本地刚更新的状态会被自己的广播再盖一次，界面回跳）。
 * 现在 shared/realtime 的 useRealtime 只返回状态、拿不到 connectionId，见 README/blockers。
 */
export const joinQuiz = async (token: string, guest: QuizGuestIdentity): Promise<QuizSnapshot> =>
  (await http.post<QuizSessionResponse>("/quiz/guest/join", { room_token: token, ...guest }))
    .session;

/**
 * 抢答。
 *
 * ★ **不幂等**，而且不能自动重试 —— 重试等于替用户多按一次。
 *   mutation 的全局默认就是 retry: false，别在调用处覆盖它。
 * 被拒绝时后端回 409/400 + {"reason","message"}：
 *   already_tapped 你已经抢答过了 / too_early 还在倒数 / not_published 还没发布 /
 *   closed 已关闭 / missing_guest_name 没填名字。
 *   页面按 reason 决定要不要当成"错"（比如 already_tapped 其实是正常的重复点）。
 *
 * client_clicked_at_ms 只是**展示用**：名次由后端按收到的时刻排，
 * 客户端时间改得动，不作数。
 */
export const tapQuiz = async (
  token: string,
  guest: QuizGuestIdentity,
  clientClickedAtMs: number,
): Promise<QuizSnapshot> =>
  (
    await http.post<QuizSessionResponse>("/quiz/guest/tap", {
      room_token: token,
      ...guest,
      client_clicked_at_ms: clientClickedAtMs,
    })
  ).session;

/** 对时。回显 client_sent_at_ms，客户端拿往返延迟折半估时钟差。 */
export const pingQuizTime = (clientSentAtMs: number) =>
  http.post<QuizTimePingResponse>("/quiz/time/ping", { client_sent_at_ms: clientSentAtMs });

/**
 * 取后端错误里的 reason。
 *
 * 文案（message）足够给用户看，reason 是给**分支**用的：比如 missing_token 要提示
 * "请从活动页进入"而不是弹一个红色错误。errors.ts 留着 ApiError.body 就是为了这种场合。
 */
export function quizErrorReason(error: unknown): QuizErrorReason | null {
  if (!(error instanceof ApiError)) return null;
  const body = error.body;
  if (!body || typeof body !== "object") return null;
  const reason = (body as { reason?: unknown }).reason;
  return typeof reason === "string" ? (reason as QuizErrorReason) : null;
}
