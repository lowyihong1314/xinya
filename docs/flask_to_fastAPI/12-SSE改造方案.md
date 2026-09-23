# 12 · Socket.IO 全面下线，改 SSE（统一 `/{app}/realtime`）

> 这是本次迁移的**真正动机**，也是技术含量最高的一块。FastAPI 只是载体。

## 1. 先认清一件事：SSE 是单向的

Server-Sent Events 只能 **服务器 → 客户端**。现有 35 个 Socket.IO 事件里：

| 方向 | 数量 | 改造方式 |
|---|---:|---|
| 客户端 → 服务器（`@socketio.on`） | **22**（除去 connect/disconnect/ping 等基建事件） | **改成普通 POST 接口** |
| 服务器 → 客户端（`emit`） | 23 种事件名 | **并进统一的 SSE 流** |

所以这不是"把 socket.io 换成 SSE"，而是**拆成两半**：

```
以前：  客户端 ⇄ Socket.IO 双向长连接（/socket.io/）
以后：  客户端 ──POST──→ 服务器            （动作：抢答、评分、主持人控制）
        客户端 ←──SSE──── {BASE}/api/{app}/realtime   （广播：排行榜、状态、进度）
```

## 2. 统一契约：`/{app}/realtime`

**所有实时订阅只有这一种形状**，每个模块不再自己发明路径。

```http
GET {BASE}/api/{app}/realtime?room=<id>&room=<id2>
Accept: text/event-stream
```

| 部分 | 说明 |
|---|---|
| `{BASE}` | 项目路径前缀，见 [11-BASE_PATH.md](11-BASE_PATH.md) |
| `{app}` | 模块名：`quiz` `quiz_game` `mirror` `changyou_room` `form` `media` `fahui` `event` |
| `room` | 房间标识，**可重复**（一条连接订多个房间） |

响应事件统一信封：

```
event: snapshot
data: {"room":"abc123","ts":1789131343795,"data":{...整份状态...}}

event: leaderboard
data: {"room":"abc123","ts":1789131343891,"data":{...}}

: keepalive
```

- **连上先推 `snapshot`**（每个 room 一条），之后才是增量事件
- 事件名沿用现有语义（`snapshot` / `config` / `leaderboard` / `players` / `progress` / `question` / `reveal` / `podium` / `state` / `error`），只是不再带模块前缀 —— 模块信息已经在 URL 里

### 统一带来的三个实在好处

1. **一个页面一条连接**。现在一个页面可能同时要订「表单报名」和「AI 进度」两个房间，
   统一入口下 `?room=form:12&room=agent:12` 走同一条 SSE —— 直接缓解浏览器
   每域名 6 连接的上限问题（见 §5 坑 1）。
2. **nginx 只需一条规则**。SSE 要关缓冲、要长超时，统一路径后：
   ```nginx
   location ~ /realtime$ { proxy_buffering off; proxy_read_timeout 3600s; ... }
   ```
   而不是给每个模块各配一遍、漏一个就是"消息延迟几十秒"的玄学问题。
3. **一套代码**。所有模块共用同一个 SSE 端点实现，各模块只提供三个回调
   （鉴权、房间解析、快照），见 §4.2。

## 3. 逐个功能的改造映射

### 3.1 抢答 quiz（`app/quiz/`）

| 现在 | 改成 |
|---|---|
| `quiz:host:join` / `quiz:guest:join` | `GET /api/quiz/realtime?room={token}` |
| `quiz:host:publish` / `reset` / `close` / `save_config` | 已有同名 REST 接口，**socket 版直接删** |
| `quiz:guest:tap` ★ | `POST /api/quiz/{token}/tap` |
| `quiz:time:ping` / `pong` | `GET /api/time` → `{"server_now_ms": ...}` |
| `quiz:snapshot` / `config_updated` / `leaderboard` | SSE 事件 `snapshot` / `config` / `leaderboard` |

★ **抢答公平性**：名次由服务器收到请求的时刻决定（`now_ms()`），POST 与 socket 帧
在这点上没有区别 —— 前提是**连接已复用**（HTTP/2 或 keep-alive），不会每次重建 TCP。
验收时要实测 10 台手机同抢的结果与旧版一致。

### 3.2 问答游戏 game（`app/quiz_game/`）

`game:guest:answer` → `POST /api/quiz_game/{token}/answer`；
主持人 start/next/reveal/podium/reset/kick 六个动作 → 六个 POST；
`game:question`/`reveal`/`podium`/`players`/`progress` → SSE 事件。
**服务端"全员答完自动揭晓"的逻辑不变**，只是改由 POST 处理器触发广播。

### 3.3 别人眼中的我 mirror（`app/mirror/`）

`mirror:guest:rate` → `POST /api/mirror/{token}/rate`；
`mirror:host:start/reveal/reset/kick` → 四个 POST；
`mirror:*:sync` → **删掉**，SSE 连上就推 snapshot，重连自动重来一次。

### 3.4 唱游房间 changyou（`app/changyou_room/`）

`changyou_join_room` → `GET /api/changyou_room/realtime?room={room_id}`；
`changyou_push_song` → `POST /api/changyou_room/{room_id}/push`。

### 3.5 表单实时（`app/form/`）

`new_register`、考勤、AI 分组进度、计分板 —— **全是服务器→客户端**，纯 SSE。
`parental_sign_sync` 是客户端→服务器 → 改 POST。

### 3.6 相册/媒体（`app/media/`）

`media_room_update`（上传完成、转码进度）—— 纯 SSE。
后台转码线程改成把消息写 Redis，SSE 端点消费（线程里不能直接碰 asyncio 队列）。

### 3.7 法会终端（`app/fahui/`）

`fahui:board_highlight` 推给某个用户的终端 → `room = f"terminal:{user_id}"`。

### 3.8 AI Agent 进度（`app/event/agent.py`、`app/form/form_agent.py`）

**SSE 最正统的用法**。这两处可以不走房间机制，直接让 agent 接口返回
`StreamingResponse` 边算边吐；只有需要多端同看时才用 `/realtime`。

## 4. 基础设施设计

### 4.1 多 worker 的广播（必须解决）

4 个 uvicorn worker，SSE 连接分散在不同进程。POST 落在 worker A，
要通知连在 worker B 的客户端 —— **进程内 `asyncio.Queue` 不够**。
复用现有 Redis（本来就是 socket.io 的 message queue）：

```
POST /api/quiz/{token}/tap ──→ Redis PUBLISH rt:quiz:abc123
                                      │
                ┌─────────────────────┼─────────────────────┐
             worker A              worker B              worker C
          （一个订阅任务）       （一个订阅任务）       （一个订阅任务）
                │                     │                     │
        进程内扇出到匹配房间      扇出到对应队列           无人订阅，丢弃
         的 asyncio.Queue
                │                     │
          SSE 客户端 1、2         SSE 客户端 3
```

**每个 worker 只开一条 Redis 订阅连接**（`psubscribe rt:*`），在进程内扇出。
绝不能每个 SSE 客户端开一条 Redis 连接 —— 上千客户端会打爆 Redis 连接数。

```python
# core/realtime.py（骨架）
import asyncio, json
from collections import defaultdict

_rooms: dict[str, set[asyncio.Queue]] = defaultdict(set)

async def redis_fanout():                      # 每个 worker 启动时跑一个
    pubsub = redis.pubsub()
    await pubsub.psubscribe("rt:*")
    async for msg in pubsub.listen():
        if msg["type"] != "pmessage":
            continue
        room = msg["channel"].decode().removeprefix("rt:")
        for q in list(_rooms.get(room, ())):
            try:
                q.put_nowait(msg["data"])
            except asyncio.QueueFull:
                pass                           # 慢客户端丢消息，不拖垮其他人

async def publish(app: str, room_id: str, event: str, data: dict):
    payload = json.dumps({"event": event, "room": room_id, "ts": now_ms(), "data": data})
    await redis.publish(f"rt:{app}:{room_id}", payload)
```

⚠️ 队列满时**丢消息而不是阻塞** —— 因为下一次事件到来时客户端反正会收到新状态；
真怕漏就让客户端重连拉 snapshot。宁可丢也不能让一个卡住的客户端拖垮整个 worker。

### 4.2 统一端点：各模块只注册三个回调

```python
# core/realtime.py
@dataclass
class RealtimeApp:
    name: str
    authorize: Callable[[str, Any], bool]        # (room_id, user) -> 能不能订
    snapshot: Callable[[str, Any], dict | None]  # (room_id, user) -> 首帧全量状态

REGISTRY: dict[str, RealtimeApp] = {}

@router.get("/api/{app}/realtime")
async def realtime(app: str, request: Request, room: list[str] = Query(default=[])):
    spec = REGISTRY.get(app) or raise_404()
    user = current_user_of(request)
    rooms = [r for r in room if spec.authorize(r, user)]
    if not rooms:
        raise HTTPException(403, ...)

    async def gen():
        # 1) 每个房间先推一份 snapshot —— 重连即自愈，不做增量补发
        for r in rooms:
            snap = await run_in_threadpool(spec.snapshot, r, user)
            if snap is not None:
                yield sse_pack("snapshot", {"room": r, "ts": now_ms(), "data": snap})
        # 2) 再转发增量
        async with subscribe([f"{app}:{r}" for r in rooms]) as q:
            while not await request.is_disconnected():
                try:
                    yield sse_pack_raw(await asyncio.wait_for(q.get(), timeout=15))
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",     # 双保险：即使 nginx 忘了关缓冲
    })
```

各模块注册：

```python
REGISTRY["quiz"] = RealtimeApp(
    name="quiz",
    authorize=lambda room, user: quiz_services.get_session(room) is not None,
    snapshot=lambda room, user: quiz_services.build_snapshot(room),
)
```

⚠️ **SSE 端点必须 `async def` 且内部零阻塞调用。**
任何 DB/Redis 同步查询一律 `run_in_threadpool(...)`，否则一个慢查询会卡住
**这个 worker 上所有 SSE 连接和请求**。全项目最需要 code review 的地方就是这里。

### 4.3 重连：不补发，直接重拉快照

SSE 自带 `Last-Event-ID`，但**我们不用**。现有代码本来就是 snapshot 语义
（`quiz:snapshot`、`mirror:player`、`game:host` 都是全量状态）。

> **规则：SSE 流连上的第一件事就是每个房间推一份完整 snapshot。**
> 断线 → `EventSource` 自动重连 → 收到新 snapshot → 状态自愈。
> 不做增量补发，不维护消息历史 —— 实现简单一个数量级。

代价是 snapshot 比增量大。本项目一个房间几十人，无所谓。

## 5. 三个会咬人的坑

### 坑 1 ★ 浏览器每域名 6 连接上限（HTTP/1.1）

HTTP/1.1 下浏览器对同一域名最多 6 个并发连接，一条 SSE **永久占一个**。
开 3 个标签页 = 3 条 SSE，剩下的 API 请求开始排队，
**表现为"页面莫名其妙卡住"且极难排查**。

**解法：必须启用 HTTP/2**（多路复用，同一连接上无限流）。

```nginx
listen 443 ssl;
http2 on;        # nginx ≥ 1.25.1
```

- [ ] 上线前用 DevTools 确认协议列是 `h2`
- [ ] APK WebView 同样确认
- [ ] 统一 `/{app}/realtime` 后，**一个页面应当只开一条 SSE**（多房间用重复 `room=`），
      code review 要盯住"一个组件一个 EventSource"的写法

### 坑 2 nginx 会缓冲掉 SSE

默认 `proxy_buffering on` 会把消息攒着，表现为"延迟几十秒"或"一次性涌一堆"。

```nginx
location ~ /realtime$ {
    proxy_pass http://127.0.0.1:5006;
    proxy_http_version 1.1;
    proxy_buffering off;           # ★
    proxy_cache off;
    proxy_read_timeout 3600s;      # 默认 60s 会掐断长连接
    proxy_send_timeout 3600s;
}
```

统一路径的价值在这里体现：**一条 location 管全部**。

### 坑 3 超时与线程池

- gunicorn/uvicorn 的 `--timeout` 对长连接语义要确认，配错会周期性掐断
- SSE 端点里的 `run_in_threadpool` 会占线程池名额（默认 40）。
  100 个客户端同时重连、同时拉 snapshot 会排队 → **snapshot 查询必须快**，
  必要时加 Redis 缓存

## 6. 前端改造

21 个文件用了 socket.io-client，统一收敛成一个助手：

```ts
// frontend/src/js/realtime.ts
export function subscribeRealtime(
  app: string,
  rooms: string[],
  handlers: Record<string, (msg: { room: string; data: any }) => void>,
): () => void {
  const qs = rooms.map((r) => `room=${encodeURIComponent(r)}`).join("&");
  const es = new EventSource(`${API_BASE}${BASE_PATH}/api/${app}/realtime?${qs}`, {
    withCredentials: true,
  });
  for (const [event, fn] of Object.entries(handlers)) {
    es.addEventListener(event, (e) => fn(JSON.parse((e as MessageEvent).data)));
  }
  return () => es.close();
}
```

⚠️ **`EventSource` 不能自定义请求头**，没法带 `Authorization: Bearer`。
APK 走 Bearer 认证，所以三选一：
1. `/realtime` 接受查询参数里的短期 token（`?access_token=...`）
2. APK 侧改用 Cookie 认证
3. 用 `fetch` + `ReadableStream` 自己解析 SSE（可带头，但要自己实现重连）

**动手前必须定**，它影响 APK 的认证架构 → [09-待决事项.md](09-待决事项.md) D7。

改完后 `package.json` 移除 `socket.io-client`。

## 7. 验收清单

每个实时功能都在**真机 + 弱网**下验：

- [ ] 抢答：10 台手机同抢，名次与旧版一致；断网重连状态自愈
- [ ] 问答游戏：全员答完自动揭晓、提前揭晓、踢人
- [ ] 别人眼中的我：评分进度实时；最后一票自动公布
- [ ] 唱游房间：推歌到投影
- [ ] 表单：新报名实时进列表；AI 分组进度条
- [ ] 相册：上传完成刷新；视频转码进度
- [ ] 法会终端：板位高亮
- [ ] **一个页面只有一条 SSE 连接**（DevTools 核实）
- [ ] **多标签页**：开 4 个带 SSE 的页面，API 请求不排队（验 HTTP/2）
- [ ] **挂机 30 分钟**连接不断（验心跳与 nginx 超时）
- [ ] **手机锁屏 10 分钟解锁**：自动重连并拉到最新状态
- [ ] **服务端重启**：客户端自动重连，无需手动刷新
- [ ] `grep -rn "socket.io" app frontend/src` 为空
