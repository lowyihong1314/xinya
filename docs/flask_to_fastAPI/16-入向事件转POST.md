# Socket.IO 入向事件 → POST 接口

> 出向（服务端→客户端）已经改完：各模块的 `socket_broker.emit(...)` 都换成了
> `core.realtime.publish_sync(app, room, event, data)`，客户端用 SSE 收。
> 这份文档管**入向**（客户端→服务端）那 22 个事件。

## 一、转换规则

Socket.IO 的 handler 有三件事，转成 HTTP 之后各归各位：

| Socket.IO | HTTP |
|---|---|
| `emit(..., to=request.sid)` 只回发送者 | **就是 HTTP 响应体** |
| `emit(..., to=room)` 广播给房间 | `publish_sync(app, room, event, data)` |
| `join_room(room)` | **不需要**。客户端订阅 SSE 时带 `?room=xxx` 即可 |
| `request.sid` 会话标识 | SSE 的 `connection_id`（`ready` 事件里下发） |
| 抛异常 → `emit("xxx:error", ...)` | 抛 `HTTPException` / 返回错误信封 |

**两件事都要做**：POST 既要把结果**返回给调用者**，也要 `publish_sync` 给房间。
只做后者的话，发起动作的人要等 SSE 绕一圈才看到自己的操作生效，手感明显发飘。

## 二、`sender` 与回声

`publish_sync(..., sender=connection_id)` 会把发送者的连接 id 放进推送信封。
前端 `subscribeRealtime` 收到 `sender === 自己的 connectionId` 的消息会丢弃 ——
因为发起者已经从 HTTP 响应里拿到结果了，再应用一次推送会导致**状态回跳**
（本地乐观更新 → 服务端响应 → 又被自己的广播覆盖一遍）。

所以客户端发 POST 时要带上自己的 `connection_id`，服务端原样传给 `publish_sync`。
约定：请求体里的 `connection_id` 字段。

## 三、路径命名

事件名里的冒号换成路径段，动作归到模块前缀下：

```
quiz:host:join          → POST {BASE}/quiz/host/join
quiz:host:save_config   → POST {BASE}/quiz/host/save_config
quiz:host:publish       → POST {BASE}/quiz/host/publish
quiz:host:reset         → POST {BASE}/quiz/host/reset
quiz:host:close         → POST {BASE}/quiz/host/close
quiz:guest:join         → POST {BASE}/quiz/guest/join
quiz:guest:tap          → POST {BASE}/quiz/guest/tap
quiz:time:ping          → POST {BASE}/quiz/time/ping
changyou_join_room      → （删掉：SSE 订阅就是加入）
changyou_push_song      → POST {BASE}/changyou_room/room/{id}/push（HTTP 版已存在）
```

`mirror`（9 个）和 `quiz_game`（10 个）同理，见各自模块的 router.py。

## 四、几个不能照搬的地方

### 1. `connect` / `disconnect` 没有对应物

SSE 的连接生命周期由 `core/realtime.py` 的 `RealtimeApp.on_connect` / `on_disconnect`
回调管。presence（谁在线）要在那里登记和清理，**不是**在 POST 里。

原 `handle_disconnect` 做的事（`remove_guest_by_sid`、`mark_offline_by_sid`）
要搬进各模块的 `on_disconnect` 回调。

### 2. `quiz:time:ping` 是对时，不是心跳

它用来估算客户端与服务端的时钟差（抢答要按服务端时间排序）。
HTTP 的往返延迟比 WebSocket 大且抖动更明显，**对时精度会下降**。
抢答排序本来就以服务端收到的时刻为准（`record_tap` 里记的是服务端时间），
客户端时钟只用于界面上显示"你的反应时间"，精度下降可以接受。
如果实测不可接受，再考虑把对时挪到 SSE 的 keepalive 帧里带时间戳。

### 3. 幂等

Socket.IO 断线重连时客户端常会把 join 重发一遍。POST 版本同样要能重复调用：
`add_guest` 已经是「存在就更新」的语义，照搬即可。
**但 `guest:tap` 不是幂等的** —— 它记一次抢答。客户端不能盲目重试，
失败时要让用户自己再点（这与 Socket.IO 时代一致，那时候也没有重试）。

## 五、前端怎么发

```ts
import { http } from "@/shared/api/client";

// connectionId 来自 useRealtime 的 onReady
await http.post("/quiz/guest/tap", {
  room_token: token,
  guest_id: guestId,
  client_clicked_at_ms: Date.now(),
  connection_id: connectionId,   // 让服务端广播时标记 sender，自己好丢弃回声
});
```
