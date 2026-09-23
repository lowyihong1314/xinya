/**
 * SSE 实时订阅助手 —— Socket.IO 下线后**唯一**的实时入口。
 *
 * 契约见 docs/flask_to_fastAPI/12-SSE改造方案.md §2，服务端实现是 core/realtime.py。
 *
 *   GET {API_BASE}{BASE_PATH}/{app}/realtime?room=a&room=b
 *
 * ★ 路径里**没有 /api 这一段**：BASE_PATH（如 /UTBA_DEMO）已经把项目区分开了，
 *   再套一层 /api 不带任何信息量。这一条和 REST 保持一致，别自作主张加回去。
 *
 * ── 为什么是 EventSource 而不是 fetch+ReadableStream ─────────────────────
 * EventSource 自带断线重连和帧解析，代价是**带不了自定义请求头**，也就永远发不出
 * `Authorization: Bearer`。所以 D8 已定：SSE 一律走 Cookie 认证，**APK 也不例外**
 * （APK 是跨域到 utbabuddha.com，withCredentials 要求后端回
 * `Access-Control-Allow-Credentials: true` 且 `Access-Control-Allow-Origin`
 * 必须是具体来源、不能是 `*` —— socket.io 握手那套 CORS 配置不自动适用于这里）。
 *
 * ── 一个页面只开一条连接（硬约束，不是口号）────────────────────────────
 * HTTP/1.1 下浏览器对同一域名最多 6 个并发连接，一条 SSE 永久占住一个；占满之后
 * 普通 API 请求开始排队，表现为「页面莫名其妙卡住」且极难排查（12 文档 §5 坑 1）。
 * 现存三处天然会超标：
 *   ① MemberPortalPage 和它渲染的 TerminalScorePanel 订同一个 form_score 房间；
 *   ② useFormWorkspace 同时要 wait_register 和 group_score 两个房间；
 *   ③ 相册网格里每个 CacheMediaPlayer 实例各订一次转码进度。
 * 所以本助手按 (app + 额外查询参数) 做**引用计数复用**：同一页面里多次订阅会合并
 * 成一条 EventSource，房间取并集（服务端支持重复的 ?room=）。房间集合变了就重开
 * 连接 —— 代价只是重新收一遍 snapshot，而 snapshot 本来就是「重连即自愈」的设计。
 *
 * ── 为什么要自己接管重连 ────────────────────────────────────────────────
 * 浏览器只在「2xx + text/event-stream 的流被掐断」时自动重连；收到 403/404 会
 * **永久放弃且不报错**，表现为「页面静静地不更新」。而 403/404 在本项目是常态：
 * ScorePanelPage 要等 data.form_id 到位、mirror 的 guest 要先 POST join 才在花名册里、
 * 后端 REGISTRY 在模块接线完成前一律 404。所以 onerror 里一旦发现浏览器已经
 * 放弃（readyState === CLOSED），就由我们自己做指数退避重连，并把失败次数暴露给
 * 调用方，让 UI 能回落到轮询而不是假装一切正常。
 */

// API_ROOT === API_BASE + BASE_PATH（origin + 项目前缀）。不自己拼这两段，是为了让
// 归一化规则只活在 basePath.ts 一处：前缀差一个斜杠的表现是 `//quiz/realtime` 或
// `/UTBA_DEMOquiz/realtime`，而 SSE 连不上时浏览器不报错，排查成本极高。
import { API_ROOT } from "./basePath";

// ── 与服务端对齐的硬限制（core/realtime.py）──────────────────────────────
// 超限的后果不同：房间数超了服务端会静默截断（只有日志），房间 id 超长会被静默丢弃。
// 两种都表现为「订阅了但收不到」，所以在客户端先吵出来，省得到线上才查。
const MAX_ROOMS_PER_CONNECTION = 20;
const MAX_ROOM_ID_LENGTH = 200;
// 服务端 register() 用同一条正则校验 app 名，所以是 quiz_game / changyou_room，
// 不能写成带连字符的 quiz-game（写错的表现是一直 404 + 无限退避）。
const APP_NAME_RE = /^[a-z][a-z0-9_]*$/;

// 退避参数：首次 1 秒，翻倍到 30 秒封顶，带 ±20% 抖动避免所有客户端同时重连把后端
// 打出一个尖峰（服务端重启后几百个页面同时回来就是这种场景）。
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

// EventSource.CLOSED 的字面量。不直接用静态常量是因为个别老 WebView 上
// EventSource 构造器缺这几个静态属性，取到 undefined 会让判断永远为假。
const ES_CLOSED = 2;

export type RealtimeStatus = "connecting" | "open" | "closed";

/** 拆完信封之后交给业务回调的一条消息。 */
export interface RealtimeMessage<T = any> {
  /** SSE 的 event: 行。**不带模块前缀**（模块信息已经在 URL 里）。 */
  event: string;
  /** 裸房间 id（不含 app 前缀）。一条连接订多个房间时靠它分流。 */
  room: string;
  /** 业务负载。旧代码 `socket.on("quiz:snapshot", fn)` 里 fn 拿到的就是这一层。 */
  data: T;
  /** 服务端毫秒时间戳。 */
  ts: number;
  /** 发出这条广播的连接 id（旧 skip_sid 的替代品），广播非定向时为 null。 */
  sender: string | null;
}

export type RealtimeHandler<T = any> = (msg: RealtimeMessage<T>) => void;

/**
 * 事件名 → 回调。键就是 SSE 的 event: 行，例如 snapshot / leaderboard / progress。
 *
 * ⚠️ 两个注意点：
 *   · `ready` 是保留事件（助手自己消费，用来拿 connection_id），写在这里不会被调用，
 *     要用 options.onReady；
 *   · 事件名必须显式列出来 —— EventSource 只把帧派发给**同名**监听器，没有通配符。
 */
export type RealtimeHandlers = Record<string, RealtimeHandler>;

export interface RealtimeStatusInfo {
  status: RealtimeStatus;
  /** 连续失败次数。>0 就意味着「实时暂时不可用」，UI 可以据此回落到轮询。 */
  failures: number;
  /** 距离下次重连的毫秒数；0 表示不在我们的退避里（要么已连上，要么浏览器自己在重试）。 */
  retryInMs: number;
}

export interface RealtimeReadyInfo {
  /** 本条连接的 id。POST 动作要带上它，服务端广播时放进 sender，用于丢弃自己的回声。 */
  connectionId: string;
  /** 服务端实际接受的房间（鉴权不过的会被剔除，所以可能比请求的少）。 */
  rooms: string[];
}

export interface RealtimeOptions {
  /**
   * room 以外的查询参数，原样透传给服务端的模块回调：
   *   · mirror / quiz_game 的匿名 guest 用 `{ as: guestId }` 认人（snapshot 按人不同）；
   *   · fahui 第二显示器是未登录终端，用 `{ token }` 鉴权。
   * ⚠️ 参数不同的订阅**不能共用连接**（服务端会因此返回不同的快照），
   *    所以它和 app 一起构成连接复用的键。
   */
  params?: Record<string, string | number | null | undefined>;
  /** 连接状态变化时回调，用于「已连接」指示灯或回落轮询。 */
  onStatus?: (info: RealtimeStatusInfo) => void;
  /** 收到 ready 帧时回调。重连后会**再触发一次**，且 connectionId 是新的。 */
  onReady?: (info: RealtimeReadyInfo) => void;
  /**
   * 是否接收自己发出的回声。默认 false：丢弃 sender === 本连接 id 的帧，
   * 等价于旧 Socket.IO 的 skip_sid（parental_sign_sync、changyou_push_song 依赖它）。
   */
  echo?: boolean;
}

/**
 * 取消订阅函数，同时挂着连接状态 —— 这样既能直接 `useEffect(() => subscribeRealtime(...))`
 * 当清理函数用，又能在 UI 里读 `.status`。它也是旧代码里 `Socket` 类型标注的替代品：
 * `let socket: Socket | null` → `let handle: RealtimeHandle | null`。
 */
export type RealtimeHandle = (() => void) & {
  /** 与直接调用等价，给 `handle.close()` 这种写法留的别名。 */
  close: () => void;
  readonly status: RealtimeStatus;
  /** 当前连接 id；未就绪或断开时为 null。**每次重连都会变**，用的时候现取别缓存。 */
  readonly connectionId: string | null;
  readonly failures: number;
  /** 本次订阅声明的房间（不是连接上的并集）。 */
  readonly rooms: string[];
  /**
   * 等 ready 帧拿到 connection_id，用于「必须带 sender 的 POST」（抢答、评分、
   * parental_sign_sync）。超时或已退订返回 null —— 调用方自己决定是照发还是放弃。
   */
  whenReady: (timeoutMs?: number) => Promise<string | null>;
};

/** 拼实时订阅 URL。导出只为调试和测试对拍，业务代码用 subscribeRealtime。 */
export function buildRealtimeUrl(
  app: string,
  rooms: string[],
  params?: RealtimeOptions["params"],
): string {
  const qs = rooms.map((r) => `room=${encodeURIComponent(r)}`);
  for (const [k, v] of Object.entries(normalizeParams(params))) {
    qs.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  // BASE_PATH 为空字符串时结果就是 `/quiz/realtime?...`，与本地开发（不起 nginx）
  // 现在的行为完全一致 —— 这是 11 文档选「前缀由外层注入」路线的主要理由。
  // 形状里**没有 /api**，见文件头。
  return `${API_ROOT}/${app}/realtime?${qs.join("&")}`;
}

// ── 内部状态 ──────────────────────────────────────────────────────────────

interface Subscriber {
  rooms: string[];
  roomSet: Set<string>;
  handlers: RealtimeHandlers;
  echo: boolean;
  onStatus?: (info: RealtimeStatusInfo) => void;
  onReady?: (info: RealtimeReadyInfo) => void;
  closed: boolean;
}

interface ReadyWaiter {
  resolve: (id: string | null) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

interface Pool {
  key: string;
  app: string;
  params: Record<string, string>;
  subs: Set<Subscriber>;
  es: EventSource | null;
  /** 当前 EventSource 实际订的房间（已排序），用来判断要不要重开。 */
  openedRooms: string[];
  /** 已在当前 EventSource 上注册过监听的事件名。 */
  eventNames: Set<string>;
  status: RealtimeStatus;
  connectionId: string | null;
  failures: number;
  retryInMs: number;
  retryAt: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  syncTimer: ReturnType<typeof setTimeout> | null;
  readyWaiters: ReadyWaiter[];
}

const POOLS = new Map<string, Pool>();

function normalizeParams(params?: RealtimeOptions["params"]): Record<string, string> {
  const out: Record<string, string> = {};
  if (!params) return out;
  // 键排序：连接复用的键由它算出来，顺序不稳定会让同一组参数算出两个键，白白多开一条连接。
  for (const k of Object.keys(params).sort()) {
    const v = params[k];
    if (v === null || v === undefined || v === "") continue;
    if (k === "room") {
      console.warn("[realtime] params 里不能放 room，请用 rooms 参数");
      continue;
    }
    out[k] = String(v);
  }
  return out;
}

function sanitizeRooms(app: string, rooms: string[] | string | null | undefined): string[] {
  const list = Array.isArray(rooms) ? rooms : rooms ? [rooms] : [];
  const out: string[] = [];
  for (const raw of list) {
    if (raw === null || raw === undefined) continue;
    const room = String(raw);
    if (!room) continue;
    if (room.length > MAX_ROOM_ID_LENGTH) {
      // 服务端直接静默跳过，不报错，所以这里必须吵。
      console.warn(`[realtime] app=${app} 房间 id 超过 ${MAX_ROOM_ID_LENGTH} 字符，已丢弃`, room);
      continue;
    }
    if (out.indexOf(room) < 0) out.push(room);
  }
  return out;
}

function poolKeyOf(app: string, params: Record<string, string>): string {
  // params 进键：?as={guestId} 不同的两条订阅拿到的 snapshot 不同，绝不能合并。
  return `${app}\u0000${JSON.stringify(params)}`;
}

function statusInfo(pool: Pool): RealtimeStatusInfo {
  return {
    status: pool.status,
    failures: pool.failures,
    retryInMs: pool.retryAt ? Math.max(0, pool.retryAt - Date.now()) : 0,
  };
}

function setStatus(pool: Pool, status: RealtimeStatus): void {
  pool.status = status;
  const info = statusInfo(pool);
  for (const sub of Array.from(pool.subs)) {
    if (sub.closed || !sub.onStatus) continue;
    try {
      sub.onStatus(info);
    } catch (err) {
      console.error("[realtime] onStatus 回调抛错", err);
    }
  }
}

function flushReadyWaiters(pool: Pool, id: string | null): void {
  const waiters = pool.readyWaiters;
  pool.readyWaiters = [];
  for (const w of waiters) {
    if (w.timer) clearTimeout(w.timer);
    try {
      w.resolve(id);
    } catch (err) {
      console.error("[realtime] whenReady 回调抛错", err);
    }
  }
}

// ── EventSource 生命周期 ──────────────────────────────────────────────────

function bindEvent(pool: Pool, name: string): void {
  const es = pool.es;
  if (!es) return;
  es.addEventListener(name, (ev: Event) => {
    // 旧连接上迟到的帧要丢掉，否则重开连接后会把过期状态盖到新状态上。
    if (pool.es !== es) return;
    handleFrame(pool, name, ev as MessageEvent);
  });
}

function ensureEventName(pool: Pool, name: string): void {
  if (pool.eventNames.has(name)) return;
  pool.eventNames.add(name);
  bindEvent(pool, name);
}

function handleFrame(pool: Pool, event: string, ev: MessageEvent): void {
  let envelope: any;
  try {
    envelope = JSON.parse(ev.data);
  } catch (err) {
    // 一帧坏数据不该让整条流失效（服务端 default=str 兜过底，正常不会走到这）。
    console.warn("[realtime] 无法解析的帧", event, ev.data);
    return;
  }

  if (event === "ready") {
    // ready 先于 snapshot 到达，带着这条连接的 connection_id。
    pool.connectionId = envelope?.connection_id || null;
    pool.failures = 0;
    pool.retryInMs = 0;
    pool.retryAt = 0;
    setStatus(pool, "open");
    flushReadyWaiters(pool, pool.connectionId);
    const info: RealtimeReadyInfo = {
      connectionId: pool.connectionId,
      rooms: Array.isArray(envelope?.rooms) ? envelope.rooms : [],
    };
    for (const sub of Array.from(pool.subs)) {
      if (sub.closed || !sub.onReady) continue;
      try {
        sub.onReady(info);
      } catch (err) {
        console.error("[realtime] onReady 回调抛错", err);
      }
    }
    return;
  }

  // ★ 拆信封：服务端送来的是 {room, ts, data, sender}，而 30 个调用点的旧回调
  // 直接吃的是 data 本体。信封在这里拆一次，业务侧的 handler 才不用一个个改。
  const msg: RealtimeMessage = {
    event,
    room: typeof envelope?.room === "string" ? envelope.room : "",
    data: envelope?.data,
    ts: typeof envelope?.ts === "number" ? envelope.ts : 0,
    sender: envelope?.sender ?? null,
  };

  for (const sub of Array.from(pool.subs)) {
    if (sub.closed) continue;
    // 一条连接订了多个房间时，别把别人房间的消息塞给只订了 A 房的订阅者。
    if (msg.room && sub.roomSet.size && !sub.roomSet.has(msg.room)) continue;
    // 默认丢弃自己发出的回声（旧 skip_sid 语义）。
    if (!sub.echo && msg.sender && pool.connectionId && msg.sender === pool.connectionId) continue;
    const fn = sub.handlers[event];
    if (typeof fn !== "function") continue;
    try {
      fn(msg);
    } catch (err) {
      // 一个页面的回调抛错不能带崩共用同一条连接的其他订阅者。
      console.error(`[realtime] ${pool.app}/${event} 回调抛错`, err);
    }
  }
}

function teardownEventSource(pool: Pool): void {
  if (pool.es) {
    try {
      pool.es.close();
    } catch (err) {
      /* 关闭失败没什么可做的 */
    }
  }
  pool.es = null;
  pool.openedRooms = [];
  pool.connectionId = null;
  // 事件名要留着：重开连接时照原样绑回新的 EventSource。
}

function openEventSource(pool: Pool, rooms: string[]): void {
  teardownEventSource(pool);
  if (typeof EventSource === "undefined") {
    // 理论上不该发生（现代浏览器和 WebView 都有），但真没有时要说清楚，
    // 而不是留一个永远连不上的黑洞。
    console.error("[realtime] 当前环境没有 EventSource，实时功能不可用");
    setStatus(pool, "closed");
    return;
  }
  const url = buildRealtimeUrl(pool.app, rooms, pool.params);
  // withCredentials: true —— SSE 走 Cookie 认证（D8），APK 跨域同样靠它带上会话。
  const es = new EventSource(url, { withCredentials: true });
  pool.es = es;
  pool.openedRooms = rooms;
  for (const name of Array.from(pool.eventNames)) bindEvent(pool, name);

  es.onopen = () => {
    if (pool.es !== es) return;
    // 200 已经拿到，说明鉴权过了；真正的 connection_id 等 ready 帧。
    pool.failures = 0;
    pool.retryInMs = 0;
    pool.retryAt = 0;
    setStatus(pool, "open");
  };
  es.onerror = () => {
    if (pool.es !== es) return;
    pool.failures += 1;
    if (es.readyState === ES_CLOSED) {
      // 浏览器已经彻底放弃 —— 非 2xx（403 没有可订阅的房间 / 404 模块还没注册 / 500）
      // 都走这条路，且不会再自己重试。由我们接管退避重连。
      teardownEventSource(pool);
      scheduleReconnect(pool);
      setStatus(pool, "closed");
    } else {
      // readyState === CONNECTING：流被掐断，浏览器自己在重连（网络抖动、服务端重启、
      // nginx 超时）。不插手，只把状态和失败次数报上去。
      pool.connectionId = null;
      setStatus(pool, "connecting");
    }
  };

  setStatus(pool, "connecting");
}

function scheduleReconnect(pool: Pool): void {
  if (pool.retryTimer) clearTimeout(pool.retryTimer);
  const exp = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * Math.pow(2, Math.max(0, pool.failures - 1)));
  // ±20% 抖动：服务端重启后几百个页面会同时回来，同步重连就是自己给自己造尖峰。
  const delay = Math.round(exp * (0.8 + Math.random() * 0.4));
  pool.retryInMs = delay;
  pool.retryAt = Date.now() + delay;
  pool.retryTimer = setTimeout(() => {
    pool.retryTimer = null;
    pool.retryAt = 0;
    syncPool(pool);
  }, delay);
}

function retryNow(pool: Pool): void {
  // 用于「网络回来了」「标签页切回前台」这类明确信号：没必要再等退避走完。
  if (!pool.retryTimer) return;
  clearTimeout(pool.retryTimer);
  pool.retryTimer = null;
  pool.retryAt = 0;
  syncPool(pool);
}

// ── 连接池 ────────────────────────────────────────────────────────────────

function scheduleSync(pool: Pool): void {
  // 合并同一轮渲染里的多次订阅/退订。父组件和它渲染的子组件（MemberPortalPage 与
  // TerminalScorePanel）的 effect 在同一个任务里跑完，攒到微任务里一起算，才只开一条
  // 连接；立刻开的话会先开一条、再因为房间并集变了立刻重开。
  // 退订同理：React StrictMode 的「挂载→卸载→再挂载」也在同一轮，延后处理就不会
  // 白白断一次连接。
  if (pool.syncTimer) return;
  pool.syncTimer = setTimeout(() => {
    pool.syncTimer = null;
    syncPool(pool);
  }, 0);
}

function syncPool(pool: Pool): void {
  if (pool.subs.size === 0) {
    if (pool.retryTimer) clearTimeout(pool.retryTimer);
    pool.retryTimer = null;
    pool.retryAt = 0;
    teardownEventSource(pool);
    pool.status = "closed";
    flushReadyWaiters(pool, null);
    POOLS.delete(pool.key);
    return;
  }

  // 房间并集：一条连接订所有人要的房间（服务端支持重复的 ?room=）。
  const union: string[] = [];
  for (const sub of Array.from(pool.subs)) {
    for (const room of sub.rooms) {
      if (union.indexOf(room) < 0) union.push(room);
    }
  }
  union.sort(); // 排序只为比较稳定，服务端不关心顺序
  if (union.length > MAX_ROOMS_PER_CONNECTION) {
    console.warn(
      `[realtime] app=${pool.app} 订阅了 ${union.length} 个房间，超过服务端上限 ` +
        `${MAX_ROOMS_PER_CONNECTION}，多出来的会被服务端截断`,
    );
  }

  if (union.length === 0) {
    // 没有房间就别连：服务端会 400/403，而 403 会让 EventSource 永久放弃重连。
    // ScorePanelPage 这种「房间 id 要等接口返回」的页面，先传空数组即可。
    if (pool.es) {
      teardownEventSource(pool);
      setStatus(pool, "closed");
    }
    return;
  }

  if (pool.es && sameRooms(pool.openedRooms, union)) return; // 房间没变，复用现有连接
  if (pool.retryTimer) return; // 正在退避里等着，别抢跑
  openEventSource(pool, union);
}

function sameRooms(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

let wakeupBound = false;

function bindWakeupListeners(): void {
  // 手机锁屏 10 分钟再解锁、隧道里断网再出来：这两个信号比退避计时器更准，
  // 收到就立刻重试一次，省得用户盯着一个不更新的页面等 30 秒。
  if (wakeupBound || typeof window === "undefined") return;
  wakeupBound = true;
  const wake = () => {
    for (const pool of Array.from(POOLS.values())) retryNow(pool);
  };
  window.addEventListener("online", wake);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) wake();
    });
  }
}

// ── 对外入口 ──────────────────────────────────────────────────────────────

/**
 * 订阅一个模块的实时流。返回取消订阅函数（同时带着连接状态，见 RealtimeHandle）。
 *
 * ```ts
 * useEffect(() => subscribeRealtime("quiz", [token], {
 *   snapshot: ({ data }) => applySnapshot(data),
 *   leaderboard: ({ data }) => applySnapshot(data),
 * }, { onStatus: ({ status }) => setLive(status === "open") }), [token]);
 * ```
 *
 * @param app    模块名，必须匹配 /^[a-z][a-z0-9_]*$/（quiz / quiz_game / mirror /
 *               changyou_room / form / media / fahui / event）。
 * @param rooms  **裸房间 id**，不带模块前缀 —— 旧房间名 `quiz:{token}` 里的前缀由
 *               app 承担，写成 `["quiz:abc"]` 会变成 rt:quiz:quiz:abc，订阅键对不上，
 *               表现是「连上了但永远只有 snapshot、没有增量」。
 *               room_id 内部允许有冒号（fahui 的 `order:42`）。
 *               传空数组表示「条件还没就绪，先别连」。
 * @param handlers 事件名 → 回调。回调拿到的是拆过信封的消息，`msg.data` 就是旧
 *               `socket.on(...)` 里的那一层。
 */
export function subscribeRealtime(
  app: string,
  rooms: string[] | string | null | undefined,
  handlers: RealtimeHandlers,
  options?: RealtimeOptions,
): RealtimeHandle {
  if (!APP_NAME_RE.test(app || "")) {
    // 服务端 register() 用同一条正则，写错这里只会静默 404 + 无限重连。
    console.error(`[realtime] 非法的 app 名：${app}（只允许小写字母、数字、下划线）`);
  }
  bindWakeupListeners();

  const params = normalizeParams(options?.params);
  const key = poolKeyOf(app, params);
  let pool = POOLS.get(key);
  if (!pool) {
    pool = {
      key,
      app,
      params,
      subs: new Set<Subscriber>(),
      es: null,
      openedRooms: [],
      // ready 永远要听：它带着 connection_id，是回声过滤和 POST 动作的前提。
      eventNames: new Set<string>(["ready"]),
      status: "closed",
      connectionId: null,
      failures: 0,
      retryInMs: 0,
      retryAt: 0,
      retryTimer: null,
      syncTimer: null,
      readyWaiters: [],
    };
    POOLS.set(key, pool);
  }

  const wanted = sanitizeRooms(app, rooms);
  const sub: Subscriber = {
    rooms: wanted,
    roomSet: new Set(wanted),
    handlers: handlers || {},
    echo: options?.echo === true,
    onStatus: options?.onStatus,
    onReady: options?.onReady,
    closed: false,
  };
  pool.subs.add(sub);
  for (const name of Object.keys(sub.handlers)) ensureEventName(pool, name);
  scheduleSync(pool);

  const activePool = pool;
  const unsubscribe = (() => {
    if (sub.closed) return;
    sub.closed = true;
    activePool.subs.delete(sub);
    // 延后一轮再算：StrictMode 的卸载/重挂、以及路由切换时的「先挂新页再卸旧页」，
    // 都能因此复用同一条连接而不是断了重连。
    scheduleSync(activePool);
  }) as RealtimeHandle;

  Object.defineProperties(unsubscribe, {
    close: { value: unsubscribe },
    status: { get: () => (sub.closed ? "closed" : activePool.status) },
    connectionId: { get: () => (sub.closed ? null : activePool.connectionId) },
    failures: { get: () => activePool.failures },
    rooms: { get: () => sub.rooms.slice() },
    whenReady: {
      value: (timeoutMs?: number) =>
        new Promise<string | null>((resolve) => {
          if (sub.closed) return resolve(null);
          if (activePool.connectionId) return resolve(activePool.connectionId);
          const ms = typeof timeoutMs === "number" ? timeoutMs : 8000;
          const waiter: ReadyWaiter = { resolve, timer: null };
          // 不给超时的话，后端 404（模块还没接线）时这个 Promise 会永远挂着，
          // 上层 await 它的 POST 就彻底不发了 —— 宁可返回 null 让调用方自己决定。
          waiter.timer = setTimeout(() => {
            const i = activePool.readyWaiters.indexOf(waiter);
            if (i >= 0) activePool.readyWaiters.splice(i, 1);
            resolve(null);
          }, ms);
          activePool.readyWaiters.push(waiter);
        }),
    },
  });

  return unsubscribe;
}

/** 调试用：当前活跃的连接数与各自的房间。一个页面应当只看到一条。 */
export function realtimeDebugSnapshot(): Array<{
  app: string;
  params: Record<string, string>;
  rooms: string[];
  status: RealtimeStatus;
  subscribers: number;
  failures: number;
}> {
  return Array.from(POOLS.values()).map((pool) => ({
    app: pool.app,
    params: pool.params,
    rooms: pool.openedRooms.slice(),
    status: pool.status,
    subscribers: pool.subs.size,
    failures: pool.failures,
  }));
}
