/**
 * 一场抢答的"当前状态"。主持台和抢答页共用，所以放在模块根上，不塞进某个页面。
 *
 * 它把三件事合成一件：
 *   ① 用 TanStack Query 取 snapshot（唯一的数据源，页面不再自己 useState 存一份）；
 *   ② 订 SSE，把推来的 snapshot 直接写进同一个缓存键 —— 于是"推送"和"取数"走同一条路，
 *      页面只认 query.data 一个东西；
 *   ③ 实时没连上时**回落到轮询**，并把这件事说出来（live 状态）而不是假装一切正常。
 *
 * ★ 为什么 ③ 现在一定会生效：后端 quiz 模块还没 register(RealtimeApp(...))，
 *   GET /quiz/realtime?room={token} 实测回 404。EventSource 遇到非 2xx 会**永久放弃**，
 *   shared/realtime 的客户端接管后会指数退避重连 —— 页面因此需要轮询兜底，
 *   否则榜单永远不动。等后端注册完，live 会自己变成 open，轮询自动停掉，这里不用改。
 *
 * ★ 一个页面只开一条 SSE 连接：本 hook 在一个页面里只调一次；shared/realtime 内部
 *   还会按 (app + 参数) 做引用计数合并，所以就算哪天被调了两次也不会开两条。
 */
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { useApiQuery } from "@/shared/api/useApiQuery";
import { useRealtime } from "@/shared/realtime";

import { fetchQuizSession, pingQuizTime, QUIZ_EVENTS, QUIZ_REALTIME_APP, quizKeys } from "./api";
import type { QuizSnapshot, QuizStatus } from "./types";

/** 实时不可用时的轮询间隔。3 秒是"看得见的实时感"和"别把后端打穿"之间的折中。 */
const FALLBACK_POLL_MS = 3000;

/**
 * 时钟偏移变化小于这个值就不写 state。
 * 每帧 snapshot 都会算出一个略有不同的偏移（网络抖动），不设阈值的话倒计时组件
 * 每秒被重挂好几次，数字会肉眼可见地抖。
 */
const OFFSET_EPSILON_MS = 250;

/**
 * 重新对时的间隔。30 秒够了：手机的时钟不会一直漂，而 POST /quiz/time/ping
 * 是一次真实的往返，太密只会给后端添活。
 */
const CLOCK_RESYNC_MS = 30_000;

/** 没有 token 时传给 useRealtime 的空房间。提成常量只为引用稳定。 */
const NO_ROOMS: readonly string[] = [];

/**
 * 量一次时钟差：`服务端此刻 + 单程延迟 − 本地此刻`。
 *
 * 单程延迟按往返的一半估（Socket.IO 时代那 6 处 handlePong 就是这么算的）。
 * ⚠️ HTTP 的往返比 WebSocket 抖，估出来的偏移会差个几十毫秒 —— 够显示倒计时，
 *    **不够**用来判名次。名次永远由后端按 server_received_at_ms 排。
 */
async function measureClockOffset(): Promise<number> {
  const sentAt = Date.now();
  const pong = await pingQuizTime(sentAt);
  const receivedAt = Date.now();
  // 用后端回显的那个值算往返，而不是本地闭包里的 sentAt：两者相等才说明这条响应
  // 对应的就是这次请求（http 客户端有 30 秒超时，慢响应不会张冠李戴，但回显是白送的保险）。
  const roundTripMs = receivedAt - (pong.client_sent_at_ms ?? sentAt);
  return pong.server_now_ms + roundTripMs / 2 - receivedAt;
}

export function useQuizSession(token: string) {
  const qc = useQueryClient();

  /** 把一帧 snapshot 写进缓存。SSE 推来的和 POST 返回的都走这里。 */
  const adopt = useCallback(
    (next: unknown) => {
      const snap = next as QuizSnapshot | null | undefined;
      // 坏帧（解析出来不是对象、或者少了 room_token）直接丢，别拿它盖掉好数据。
      if (!snap || typeof snap.room_token !== "string") return;
      qc.setQueryData(quizKeys.session(snap.room_token), snap);
    },
    [qc],
  );

  // 订阅放在取数**前面**：下面那条 query 的轮询间隔要看这里的连接状态。
  const live = useRealtime(
    token ? QUIZ_REALTIME_APP : null,
    token ? [token] : NO_ROOMS,
    {
      // 三个事件名**带 quiz: 前缀**，因为后端 publish_sync 就是这么发的，
      // 而 EventSource 只把帧派发给同名监听器，差一个字就静默收不到。
      [QUIZ_EVENTS.snapshot]: (msg) => adopt(msg.data),
      [QUIZ_EVENTS.configUpdated]: (msg) => adopt(msg.data),
      [QUIZ_EVENTS.leaderboard]: (msg) => adopt(msg.data),
    },
  );

  const query = useApiQuery(quizKeys.session(token), () => fetchQuizSession(token), {
    // token 为空就别发：后端会回 400「缺少抢答 token」，而那不是"出错"，
    // 是"用户还没从活动页进来"，页面自己会提示。
    enabled: Boolean(token),
    // 覆盖全局的 30 秒：一场抢答的 snapshot 每秒都在变，缓存 30 秒等于看旧榜。
    staleTime: 0,
    refetchInterval: (q) => {
      // 400/404 再怎么轮询也是同一个结果，只会每 3 秒往控制台刷一条红的。
      if (q.state.status === "error") return false;
      // SSE 真连上了就停轮询 —— 两条路同时开着，等于把后端的量翻一倍换不到任何东西。
      return live === "open" ? false : FALLBACK_POLL_MS;
    },
    // 全局默认是 false。这里打开：手机锁屏再解锁、或者从主持台切回来时，
    // 先拉一帧最新的，别让人盯着一张过期的榜。
    refetchOnWindowFocus: true,
  });

  // ── 对时 ────────────────────────────────────────────────────────────────
  // 现场用的是别人的手机，系统时间差几十秒是常态；直接拿 Date.now() 和 cutoff_at_ms
  // 比，倒计时会一上来就是 0 或者停在几十秒不动。
  //
  // 正路是 POST /quiz/time/ping（带往返补偿）。用 query 而不是自己写定时器，
  // 是为了白拿它的去重、重试和"回到前台先刷一次"。
  const clock = useApiQuery(quizKeys.clock(), measureClockOffset, {
    enabled: Boolean(token),
    refetchInterval: CLOCK_RESYNC_MS,
    staleTime: CLOCK_RESYNC_MS,
    // 锁屏再解锁时系统可能刚校过时间，回前台先重新量一次。
    refetchOnWindowFocus: true,
  });

  // 兜底：对时这一条失败（断网、或者哪天后端把它下掉了）时，
  // 退回用 snapshot 里的 server_now_ms 减去"本地收到这份数据的时刻"估一个。
  // 精度差半个往返，但比完全不校准好得多。
  const [snapshotOffsetMs, setSnapshotOffsetMs] = useState(0);
  const offsetRef = useRef(0);
  const serverNowMs = query.data?.server_now_ms;
  const dataUpdatedAt = query.dataUpdatedAt;

  useEffect(() => {
    if (!serverNowMs || !dataUpdatedAt) return;
    const next = serverNowMs - dataUpdatedAt;
    if (Math.abs(next - offsetRef.current) < OFFSET_EPSILON_MS) return;
    offsetRef.current = next;
    setSnapshotOffsetMs(next);
  }, [serverNowMs, dataUpdatedAt]);

  // ── waiting → open 的本地翻牌 ───────────────────────────────────────────
  // 这一步**后端不会推**：status 是每次请求现算的（service._status_for_session
  // 拿 now 和 cutoff 比），没有任何事件对应它。光等下一帧 snapshot 的话，
  // 界面最晚慢 3 秒（一个轮询周期）才变 —— 抢答慢 3 秒等于白抢。
  // 所以本地按 cutoff 掐一个定时器，到点自己翻。早翻也没用：后端会按 too_early 拒掉，
  // 这里只是别比后端还慢。
  const cutoffAtMs = query.data?.cutoff_at_ms ?? null;
  const [cutoffPassed, setCutoffPassed] = useState(false);
  const offsetMs = clock.data ?? snapshotOffsetMs;

  useEffect(() => {
    setCutoffPassed(false);
    if (!cutoffAtMs) return;
    const delay = cutoffAtMs - (Date.now() + offsetMs);
    if (delay <= 0) {
      // 和上面的 setCutoffPassed(false) 在同一次执行里，React 会合并，不会闪一下。
      setCutoffPassed(true);
      return;
    }
    const timer = window.setTimeout(() => setCutoffPassed(true), delay);
    return () => window.clearTimeout(timer);
  }, [cutoffAtMs, offsetMs]);

  const snapshot = query.data;
  const status: QuizStatus = snapshot
    ? snapshot.status === "waiting" && cutoffPassed
      ? "open"
      : snapshot.status
    : "draft";

  return {
    /** 当前快照。没取到（首帧还没回来 / 出错）时是 undefined。 */
    snapshot,
    /**
     * 界面该认的状态：除了"本地已经过了 cutoff 所以提前放行"这一种，
     * 其余一律等于 snapshot.status。**页面显示和按钮都用它**，不要直接读 snapshot.status。
     */
    status,
    /** 原始 query，页面用它判 isPending / isError 和重试。 */
    query,
    /** SSE 连接状态。不是 "open" 就意味着页面在靠轮询活着。 */
    live,
    /** 服务端时钟 − 本地时钟，毫秒。倒计时用；对时失败时退回 snapshot 估的那个。 */
    offsetMs,
    /** 把一帧 snapshot 写进缓存（写接口的返回值直接喂给它）。 */
    adopt,
  };
}
