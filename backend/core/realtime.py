"""SSE 实时推送基础设施（替代 Socket.IO）。

设计见 docs/flask_to_fastAPI/12-SSE改造方案.md §4。这里只有地基，不含任何业务逻辑：
各模块通过 register() 注册自己的 authorize / snapshot 回调，通过 publish() 发消息。

整体数据流（4 个 uvicorn worker，SSE 连接分散在不同进程）：

    POST {BASE}/quiz/{token}/tap  ──publish()──→  Redis PUBLISH rt:quiz:abc
                                                      │
                        ┌─────────────────────────────┼──────────────────┐
                     worker A                      worker B           worker C
                 一条 psubscribe rt:*           一条 psubscribe        无人订阅，丢弃
                        │                             │
                 进程内扇出到 asyncio.Queue      扇出到对应队列
                        │                             │
                  SSE 客户端 1、2                SSE 客户端 3

★ 每个 worker 只开 **一条** Redis 订阅连接，在进程内扇出。
  绝不能每个 SSE 客户端开一条 Redis 连接 —— 上千客户端会直接打爆 Redis 的
  maxclients，而且每条连接在 Redis 侧都有独立的输出缓冲区，内存也扛不住。

── 房间命名的硬约定（这一步定错，所有模块的 room 解析都要返工）──────────────

Redis 频道是 ``rt:{app}:{room_id}``，而 **room_id 必须是不带模块前缀的裸 id**：

    正确：app="quiz"  room_id="abc123"        → rt:quiz:abc123
    错误：app="quiz"  room_id="quiz:abc123"   → rt:quiz:quiz:abc123（前缀重复）

旧 Socket.IO 的房间名本身带前缀（``quiz:{token}``、``media:{event_code}``、
``fahui:board-terminal:{user_id}``），迁移时要把前缀剥掉交给 {app} 承担。
扇出时只剥掉 ``rt:`` 前缀、剩下的整段当房间键，不去切 room_id 里的冒号，
所以 room_id 内部含冒号（如 fahui 的 ``board-terminal:{user_id}``）也不会歧义；
前提是 app 名不含冒号（已在 register 校验）。

── 同步 / 异步两套发送端 ────────────────────────────────────────────────

publish() 是 async 版，给 FastAPI 的路由处理器用；
publish_sync() 是同步版，给 **后台线程和子进程** 用 —— 它们碰不到事件循环：
  · app/media/services.py 的 ffmpeg 转码线程（每 0.5 秒一条进度）
  · app/fahui/YLP/paiwei_job.py 的 threading.Thread
  · event / form_agent / ai_grouping 三个 `python -m app.xxx_worker` 子进程
这三类只能走同步 redis 客户端，不能 await 任何东西。
"""

from __future__ import annotations

import asyncio
import inspect
import json
import logging
import re
import time
import uuid
from collections import defaultdict
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Annotated, Any, Callable, Iterable

import redis
import redis.asyncio as aioredis
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from starlette.responses import StreamingResponse

from backend.core.config import settings

log = logging.getLogger("backend.core.realtime")

# ── 可调参数 ──────────────────────────────────────────────────────────────
CHANNEL_PREFIX = "rt:"
CHANNEL_PATTERN = CHANNEL_PREFIX + "*"

# 每客户端队列长度。满了就丢消息（见 _offer 的注释），不是阻塞。
QUEUE_MAXSIZE = 64

# 心跳间隔：15 秒没消息就发一行注释帧，用途有三个 ——
# ① 探活：写失败才能让服务端发现客户端已经走了；
# ② 防 nginx proxy_read_timeout 掐断；
# ③ 防手机运营商/中间设备回收"看起来空闲"的连接。
KEEPALIVE_SECONDS = 15

# 一条连接最多订多少房间。统一端点的卖点就是"一个页面一条连接订多个房间"，
# 但也得防着 ?room= 刷几百个把 snapshot 查询打爆（每个房间首帧都要查一次库）。
MAX_ROOMS_PER_CONNECTION = 20

MAX_ROOM_ID_LENGTH = 200

# 等 psubscribe 就绪的上限。Redis 挂了也要让 SSE 连上并推出 snapshot（降级可用），
# 而不是把请求卡死在这里。
FANOUT_READY_TIMEOUT = 2.0

# ── Redis 超时：**不给默认值就是没有上限** ────────────────────────────────
# redis-py 的 socket_timeout / socket_connect_timeout 默认都是 None：
#   · 连不上（对端主机掉电、安全组改了规则）→ 等内核的 TCP 重试，Linux 默认 ~130 秒；
#   · 连上了但对端不再回包（半开连接、NAT 表被回收）→ 读操作**永远不返回**。
# 后者在这个文件里是致命的：publish_sync() 是 ffmpeg 转码线程每 0.5 秒调一次的，
# 那条线程会就这么挂死（上面那个 try/except 捕不到「挂住」，只能捕异常）；
# publish() 则会把一个 HTTP 请求永远挂在那里，连接数只增不减。
REDIS_CONNECT_TIMEOUT = 3.0
REDIS_SOCKET_TIMEOUT = 5.0

# 扇出循环的轮询间隔。为什么必须轮询而不是 pubsub.listen()，见 _fanout_loop。
PUBSUB_POLL_SECONDS = 10.0

# 订阅连接的健康检查间隔（发一个 PING）。见 _fanout_loop 的注释：
# 它只在 **每次 parse_response 之前** 才有机会触发，所以必须配合轮询用。
PUBSUB_HEALTH_CHECK_SECONDS = 30

# 停机时等断连清理的上限。见 stop_fanout。
CLEANUP_DRAIN_TIMEOUT = 3.0

# publish 失败时完整堆栈的最小间隔（秒），见 _log_publish_failure。
PUBLISH_ERROR_LOG_INTERVAL = 30.0

_APP_NAME_RE = re.compile(r"^[a-z][a-z0-9_]*$")


# ── 注册表 ────────────────────────────────────────────────────────────────

@dataclass
class Connection:
    """一条 SSE 连接。

    ★ id 是 Socket.IO 里 sid 的替代品。quiz / quiz_game / mirror 的在线人数原本
    完全建立在 sid 上（Redis hash quiz:sid_map 等，disconnect 时按 sid 清理），
    SSE 没有 sid，所以这里生成一个 connection_id 顶上，并在生成器结束时回调
    on_disconnect —— 否则 player_count 只增不减。

    ⚠️ 但 SSE 的"断开"没有 Socket.IO 那么及时：客户端崩溃或手机锁屏时，服务端
    要等到下一次心跳写失败才会发现（最坏 15 秒起步，经过 nginx 可能更久）。
    对"人数必须准"的场景，on_disconnect 只是兜底，正路还是给 presence key 加 TTL
    让它自己过期。
    """

    id: str
    app: str
    rooms: list[str]
    user: Any = None
    params: dict[str, str] = field(default_factory=dict)
    connected_at_ms: int = 0


@dataclass
class RealtimeApp:
    """一个模块的实时能力声明。各模块只需要提供这几个回调。

    ★ 回调签名是 (room_id, user, params)，比设计文档 §4.2 的 (room_id, user) 多一个
    params —— 这是实测逼出来的，不是为了"更通用"：
      · mirror 的 player_snapshot(session, member) 和 quiz_game 的
        player_snapshot(session, player) 是 **按人不同** 的，而这些人是匿名 guest，
        身份在客户端 localStorage 的 guest_id 里，根本不在 user 里。
        → 前端连 {BASE}/mirror/realtime?room={token}&as={guest_id}，回调从 params["as"] 取。
      · fahui 的第二显示器（fahui:board-terminal:{user_id}）是未登录终端，
        凭 Redis 里的 30 天 token 进入。
        → authorize 从 params["token"] 解析出 user_id，不能用 current_user。

    回调可以是同步函数，也可以是 async 函数：
      · async 的直接 await；
      · 同步的自动丢进线程池（snapshot 内部全是同步 Redis/DB 调用，绝不能直接在
        事件循环里跑，见下面 _call 的警告）。
    """

    name: str
    # (room_id, user, params) -> bool；返回 False 的房间会被静默剔除
    authorize: Callable[..., Any]
    # (room_id, user, params) -> dict | None；None 表示这个房间没有首帧可推
    snapshot: Callable[..., Any] | None = None
    # (Connection) -> None；SSE 建立时调用，用来登记 presence
    on_connect: Callable[..., Any] | None = None
    # (Connection) -> None；SSE 断开时调用，用来清理 presence
    on_disconnect: Callable[..., Any] | None = None


REGISTRY: dict[str, RealtimeApp] = {}


def register(spec: RealtimeApp) -> RealtimeApp:
    """注册一个模块。在各模块的 routes.py 导入时调用一次即可。"""
    if not _APP_NAME_RE.match(spec.name):
        # app 名进 Redis 频道当第二段，含冒号会让 partition 切歧义。
        raise ValueError(f"非法的 realtime app 名：{spec.name!r}（只允许小写字母、数字、下划线）")
    if spec.name in REGISTRY:
        # 热重载时会重复导入，覆盖即可，但要留痕 —— 两个模块重名是配置事故。
        log.warning("realtime app %s 被重复注册，后者覆盖前者", spec.name)
    REGISTRY[spec.name] = spec
    return spec


# ── 进程内房间表 ──────────────────────────────────────────────────────────
# key 是 "{app}:{room_id}"，value 是订阅该房间的客户端队列集合。
# 一个客户端订 N 个房间时，同一个队列会出现在 N 个 set 里（一条连接一个队列）。
_rooms: dict[str, set[asyncio.Queue]] = defaultdict(set)

# 扇出循环丢给队列的关闭信号：让客户端的生成器正常收尾并断开，
# EventSource 会自动重连并重新拉 snapshot（见 §4.3「重连即自愈」）。
_CLOSE = object()

_fanout_task: asyncio.Task | None = None
_fanout_ready = asyncio.Event()
_stopping = False

# 断连清理用的游离任务。必须持强引用，否则可能被 GC 掉（asyncio 只持弱引用）。
_cleanup_tasks: set[asyncio.Task] = set()

_stats = {"published": 0, "received": 0, "delivered": 0, "dropped": 0}


def now_ms() -> int:
    return int(time.time() * 1000)


def room_key(app: str, room_id: str) -> str:
    return f"{app}:{room_id}"


def channel_of(app: str, room_id: str) -> str:
    return f"{CHANNEL_PREFIX}{app}:{room_id}"


# ── Redis 客户端 ──────────────────────────────────────────────────────────
# 注意：这是本项目的第三套 Redis 配置（另两套是 app/redis_client.py 的硬编码
# StrictRedis 和 app/extensions.py 的 XINYA_REDIS_URL）。迁移期三套并存，
# 最终前两套会随 Socket.IO 一起删掉。这里一律从 settings 读，不碰 os.environ。
#
# decode_responses=True 是刻意的：redis.asyncio 的 pubsub 默认返回 bytes，
# 扇出时每条消息都要手动 decode；打开它以后 channel/data 直接是 str，
# 也和现有业务代码（app/redis_client.py 同样是 True）的习惯一致。
_async_client: aioredis.Redis | None = None
_sync_client: redis.Redis | None = None


def _async_redis() -> aioredis.Redis:
    global _async_client
    if _async_client is None:
        _async_client = aioredis.from_url(
            settings.redis_url,
            decode_responses=True,
            # 长时间没流量的订阅连接会被中间设备悄悄掐断，靠 PING 及早发现。
            # ⚠️ 光配这个没用：redis-py 只在 parse_response 的开头查一次「该 PING 了吗」，
            #    而 pubsub.listen() 是**一直卡在** parse_response 里面的，永远查不到。
            #    所以扇出循环必须改成 get_message(timeout=...) 轮询，见 _fanout_loop。
            health_check_interval=PUBSUB_HEALTH_CHECK_SECONDS,
            socket_connect_timeout=REDIS_CONNECT_TIMEOUT,
            # socket_timeout 不会影响订阅的阻塞读：get_message(timeout=N) 会把 N
            # 显式传给 read_response，显式值优先，超时只是返回 None、不断连接。
            socket_timeout=REDIS_SOCKET_TIMEOUT,
        )
    return _async_client


def _sync_redis() -> redis.Redis:
    global _sync_client
    if _sync_client is None:
        # 懒建连接很重要：agent 那几个 worker 是 fork/spawn 出来的子进程，
        # 若在导入期就建好连接，父子共用同一个 socket 会互相踩。
        # ★ 超时必须给：调用方是 ffmpeg 转码线程和 worker 子进程，
        #   它们没有任何看门狗，一旦卡在 socket 读上就是一条永远不回来的线程。
        _sync_client = redis.from_url(
            settings.redis_url,
            decode_responses=True,
            socket_connect_timeout=REDIS_CONNECT_TIMEOUT,
            socket_timeout=REDIS_SOCKET_TIMEOUT,
            # 池子里的连接可能已经闲置很久（两次转码之间），取出来先探活，
            # 免得第一条进度消息必定失败。
            health_check_interval=PUBSUB_HEALTH_CHECK_SECONDS,
        )
    return _sync_client


# ── SSE 打包 ──────────────────────────────────────────────────────────────

def sse_pack(event: str, data: Any) -> str:
    """打成一帧 SSE：event: 行 + data: 行 + 空行（空行是帧结束符，少了就永远不触发）。"""
    # 事件名里出现换行会把这一帧撕成两半，直接吃掉。
    safe_event = str(event).replace("\r", " ").replace("\n", " ")
    if isinstance(data, str):
        # SSE 规范里 \r\n、\r、\n 都算换行，而下面只按 \n 切。
        # 不先统一的话，字符串里一个裸 \r 会被客户端当成换行，把这一帧从中间撕开
        # （后半截变成一个没有 data: 前缀的野行，整帧作废）。
        # 非字符串走 json.dumps，\r 已经被转义成 \\r，不受影响。
        body = data.replace("\r\n", "\n").replace("\r", "\n")
    else:
        # ensure_ascii=False：中文不转义，省一半带宽（SSE 规定就是 UTF-8）。
        # default=str：snapshot 里万一混进 datetime/Decimal 也不至于整条流炸掉。
        body = json.dumps(data, ensure_ascii=False, default=str)
    lines = [f"event: {safe_event}"]
    # data 里含换行时必须逐行加前缀，否则后面的行会被当成新字段。
    lines.extend(f"data: {chunk}" for chunk in body.split("\n"))
    return "\n".join(lines) + "\n\n"


def _keepalive_frame() -> str:
    # 以冒号开头的是 SSE 注释行，客户端会忽略，但它确实走了一次 TCP 写。
    return ": keepalive\n\n"


# ── 发送端 ────────────────────────────────────────────────────────────────

def _payload(app: str, room_id: str, event: str, data: Any, sender: str | None) -> str:
    """Redis 上传输的信封。event 在顶层，扇出时会被拆到 SSE 的 event: 行。

    sender 是 Socket.IO 里 skip_sid 的替代品：两处旧代码（parental_sign_sync、
    changyou_push_song）的语义是"广播给房间里除发送者以外的人"。SSE 是服务端
    单向扇出、拿不到"谁是发送者"，所以把发起方的 connection_id 原样带在信封里，
    由客户端自己丢掉 sender == 自己的那一帧。**现在加比以后加便宜。**
    """
    return json.dumps(
        {
            "event": event,
            "room": room_id,
            "ts": now_ms(),
            "data": data,
            "sender": sender,
        },
        ensure_ascii=False,
        default=str,
    )


# 上一次打完整堆栈的时间。多线程并发读写这个 float 不加锁是故意的：
# 最坏结果只是同一秒多打一两份堆栈，为它上锁不划算。
_last_publish_error_at = 0.0


def _log_publish_failure(where: str, app: str, room_id: str, event: str) -> None:
    """Redis 掉线时 publish 会 **每一条消息** 失败一次。

    ffmpeg 转码线程每 0.5 秒一条、排位 job 也在推，原样 log.exception 就是
    每秒往日志里拍好几份 traceback。这有两个实打实的代价：
      ① 格式化 traceback 不便宜，而 logging 写文件是**同步 I/O** ——
         publish() 在 async 路径上，这就是货真价实的事件循环停顿；
      ② 一次 Redis 长时间不可用足以把磁盘刷满，那才是真的全站停摆。
    所以窗口内只留一份完整堆栈，其余降成一行。
    """
    global _last_publish_error_at
    now = time.monotonic()
    if now - _last_publish_error_at >= PUBLISH_ERROR_LOG_INTERVAL:
        _last_publish_error_at = now
        log.exception("realtime %s 失败 app=%s room=%s event=%s", where, app, room_id, event)
    else:
        log.warning("realtime %s 失败 app=%s room=%s event=%s（堆栈已限流）",
                    where, app, room_id, event)


async def publish(app: str, room_id: str, event: str, data: Any = None,
                  sender: str | None = None) -> bool:
    """异步发送端，给 FastAPI 路由处理器用。"""
    payload = _payload(app, room_id, event, data, sender)
    try:
        await _async_redis().publish(channel_of(app, room_id), payload)
    except Exception:  # noqa: BLE001
        # 实时推送是尽力而为：Redis 抽风不该让一笔已经写库成功的业务回滚。
        # 客户端下次重连会重新拉 snapshot，状态自愈。
        _log_publish_failure("publish", app, room_id, event)
        return False
    _stats["published"] += 1
    return True


def publish_sync(app: str, room_id: str, event: str, data: Any = None,
                 sender: str | None = None) -> bool:
    """同步发送端 —— 后台线程 / 子进程专用，见模块 docstring。

    这些调用点碰不到事件循环，也绝不能 await：
    ffmpeg 转码线程每 0.5 秒一条进度，asyncio.run() 在那里每次建一个新循环是灾难。
    """
    payload = _payload(app, room_id, event, data, sender)
    try:
        _sync_redis().publish(channel_of(app, room_id), payload)
    except Exception:  # noqa: BLE001
        _log_publish_failure("publish_sync", app, room_id, event)
        return False
    _stats["published"] += 1
    return True


# ── 扇出：每个 worker 一条订阅连接 ────────────────────────────────────────

def _offer(queue: asyncio.Queue, item: Any, force: bool = False) -> bool:
    """往客户端队列塞一条，满了就丢。

    ★ 队列满意味着这个客户端读得比我们写得慢（弱网、锁屏、标签页被挂起）。
    此时**丢消息而不是阻塞**：阻塞一个慢客户端就等于阻塞扇出循环，
    进而拖垮这个 worker 上所有 SSE 连接。宁可丢也不能拖垮整个 worker。
    丢了也不致命 —— 下一条事件带的就是新状态，真怕漏就让客户端重连拉 snapshot。
    """
    try:
        queue.put_nowait(item)
        return True
    except asyncio.QueueFull:
        if not force:
            _stats["dropped"] += 1
            return False
        # 关闭信号必须送达，挤掉最老的一条给它腾位。
        try:
            queue.get_nowait()
            queue.put_nowait(item)
            return True
        except Exception:  # noqa: BLE001
            return False


def _dispatch(channel: str, payload: str) -> None:
    """把一条 Redis 消息扇出到本进程内订阅该房间的所有队列。"""
    if not channel or not channel.startswith(CHANNEL_PREFIX):
        return
    # "rt:quiz:abc" → key = "quiz:abc"。只剥 "rt:" 前缀，剩下的整段直接当房间键，
    # 不再拆 app / room_id —— 所以 room_id 内部含冒号（fahui 的
    # board-terminal:{user_id}）也能原样对上 subscribe() 登记的键。
    key = channel[len(CHANNEL_PREFIX):]
    subscribers = _rooms.get(key)
    if not subscribers:
        return  # 这个 worker 上没人订，正常情况，直接丢

    try:
        envelope = json.loads(payload)
    except Exception:  # noqa: BLE001
        log.warning("realtime 收到无法解析的消息 channel=%s", channel)
        return

    event = envelope.pop("event", None) or "message"
    # ★ 整帧只打包一次，再把同一个字符串放进 N 个队列。
    # 一个房间几百人时，per-client 序列化是纯浪费。
    frame = sse_pack(event, envelope)
    _stats["received"] += 1
    for queue in list(subscribers):
        if _offer(queue, frame):
            _stats["delivered"] += 1


def _close_all_subscribers() -> None:
    """让本进程所有 SSE 客户端断开重连。

    只在和 Redis 断联时调用：订阅断了以后这些连接虽然"还开着"，但收不到任何消息，
    是最坏的一种故障（页面看着正常、数据永远停在过去）。主动断开让 EventSource
    自动重连并重新拉 snapshot，比装作没事更诚实。
    """
    # 先去重：一条连接订了 N 个房间就会出现在 N 个 set 里，逐个塞会给它塞 N 个哨兵，
    # 而 force=True 每次都要挤掉一条待发帧 —— 客户端只认第一个哨兵，后面全是白挤。
    targets = {id(q): q for subscribers in _rooms.values() for q in subscribers}
    for queue in targets.values():
        _offer(queue, _CLOSE, force=True)


async def _fanout_loop() -> None:
    """worker 级的唯一订阅循环：psubscribe rt:* 然后在进程内扇出。

    ★ 为什么是 get_message(timeout=...) 轮询，不是 `async for msg in pubsub.listen()`：

    listen() 会一直卡在 parse_response 的阻塞读里。而 redis-py 的健康检查
    （health_check_interval 那个 PING）恰恰只在 **进入 parse_response 之前** 查一次
    「该 PING 了吗」—— 一条一整天没消息的订阅连接，就一整天不会发 PING。
    于是中间设备（运营商 NAT、云上的 LB、conntrack 超时）把这条 TCP 悄悄回收之后，
    服务端这边什么都不知道：listen() 继续安静地等一个永远不会来的字节。

    这正好是本模块 docstring 里点名最坏的那种故障 ——
    **SSE 客户端全都好好连着、心跳照发，但再也收不到任何事件，页面永远停在过去。**
    没有异常、没有日志、监控也是绿的。

    改成轮询之后：每 PUBSUB_POLL_SECONDS 秒回到 parse_response 一次，健康检查就有机会
    触发；PING 发不出去或者回不来会抛异常，下面的 except 接住，重连自愈。
    轮询超时本身不是错误 —— redis-py 在「调用方显式给了 timeout」时只返回 None，
    不会断连接、也不会丢缓冲区里的数据。
    """
    delay = 1.0
    while not _stopping:
        pubsub = None
        try:
            pubsub = _async_redis().pubsub(ignore_subscribe_messages=True)
            await pubsub.psubscribe(CHANNEL_PATTERN)
            _fanout_ready.set()
            delay = 1.0
            log.info("realtime 扇出已就绪，pattern=%s", CHANNEL_PATTERN)
            while not _stopping:
                msg = await pubsub.get_message(
                    ignore_subscribe_messages=True, timeout=PUBSUB_POLL_SECONDS
                )
                if msg is None:
                    continue  # 轮询超时或被吃掉的订阅确认/PONG，都不是错误
                if msg.get("type") != "pmessage":
                    continue
                try:
                    _dispatch(msg.get("channel"), msg.get("data"))
                except Exception:  # noqa: BLE001
                    # 单条消息出问题不能让订阅循环退出，否则整个 worker 的实时就哑了。
                    log.exception("realtime 扇出单条消息失败")
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            log.exception("realtime 订阅连接中断，%.0f 秒后重连", delay)
        finally:
            _fanout_ready.clear()
            if pubsub is not None:
                try:
                    await pubsub.aclose()
                except Exception:  # noqa: BLE001
                    pass
        if _stopping:
            break
        _close_all_subscribers()
        await asyncio.sleep(delay)
        delay = min(delay * 2, 30.0)  # 指数退避，别在 Redis 重启时把它 DDoS 了


async def _ensure_fanout() -> None:
    """保证本进程的扇出循环活着。第一个订阅者到来时自动拉起。"""
    global _fanout_task
    if _stopping:
        # 已经在停机流程里了，别再拉起一个注定立刻退出的循环 ——
        # 那只会让排水期的每个请求白等一个 FANOUT_READY_TIMEOUT。
        return
    if _fanout_task is None or _fanout_task.done():
        _fanout_task = asyncio.create_task(_fanout_loop(), name="realtime-fanout")
    if not _fanout_ready.is_set():
        try:
            await asyncio.wait_for(_fanout_ready.wait(), timeout=FANOUT_READY_TIMEOUT)
        except asyncio.TimeoutError:
            # 不抛错：Redis 没起来时仍然让客户端连上并收到 snapshot（只是收不到增量），
            # 好过整个页面 500。
            log.warning("realtime 扇出未在 %.1fs 内就绪，本条连接先降级为只有首帧",
                        FANOUT_READY_TIMEOUT)


async def start_fanout() -> None:
    """在 FastAPI 的 lifespan 启动时调用（可选：第一个订阅者也会自动拉起）。"""
    global _stopping
    _stopping = False
    await _ensure_fanout()


async def stop_fanout() -> None:
    """在 FastAPI 的 lifespan 关闭时调用：先踢客户端，再收连接。"""
    global _stopping, _fanout_task, _async_client
    _stopping = True
    _close_all_subscribers()
    if _fanout_task is not None:
        _fanout_task.cancel()
        try:
            await _fanout_task
        except asyncio.CancelledError:
            pass  # 这就是我们自己 cancel 出来的，预期之内
        except Exception:  # noqa: BLE001
            # 真异常要留痕，否则扇出循环是怎么死的永远查不出来。
            log.exception("realtime 扇出任务收尾时抛异常")
        _fanout_task = None
    # 断连清理是游离任务，没人等它。停机时不等一下，最后一批 presence 就永远留在
    # Redis 里（只能靠 TTL 过期），重启后前几分钟人数是虚高的。
    # 给个上限：不能让一个卡住的回调把整个停机流程无限拖住 ——
    # gunicorn 的 graceful timeout 一到会直接 SIGKILL，那才是真的什么都没清掉。
    # 清理任务要用 Redis，所以必须排在下面 aclose() 之前。
    if _cleanup_tasks:
        _, pending = await asyncio.wait(set(_cleanup_tasks), timeout=CLEANUP_DRAIN_TIMEOUT)
        if pending:
            log.warning("realtime 停机时还有 %d 个断连清理没跑完", len(pending))
    if _async_client is not None:
        try:
            await _async_client.aclose()
        except Exception:  # noqa: BLE001
            pass
        _async_client = None


def stats() -> dict:
    """给健康检查/排查用。dropped 一直涨就说明有慢客户端或队列太小。"""
    return {
        **_stats,
        "rooms": len(_rooms),
        "subscribers": sum(len(s) for s in _rooms.values()),
        "fanout_ready": _fanout_ready.is_set(),
        "apps": sorted(REGISTRY),
    }


# ── 订阅 ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def subscribe(room_keys: Iterable[str], maxsize: int = QUEUE_MAXSIZE):
    """订阅若干房间，得到一个 asyncio.Queue（一条连接一个队列）。

    room_keys 是 "{app}:{room_id}" 形式，用 room_key() 拼。
    退出时同步清理，**不做任何 await** —— 这个上下文管理器会在生成器被取消
    （客户端断线）时退出，那时候再 await 会立刻再次抛 CancelledError。
    """
    await _ensure_fanout()
    queue: asyncio.Queue = asyncio.Queue(maxsize=maxsize)
    keys = list(dict.fromkeys(room_keys))
    for key in keys:
        _rooms[key].add(queue)
    try:
        yield queue
    finally:
        for key in keys:
            subscribers = _rooms.get(key)
            if subscribers is None:
                continue
            subscribers.discard(queue)
            if not subscribers:
                _rooms.pop(key, None)  # 空房间要删掉，否则 _rooms 只增不减


# ── 用户解析 ──────────────────────────────────────────────────────────────
# SSE 走 Cookie 认证（D8：EventSource 不能自定义请求头，APK 也统一改 Cookie）。
# 具体怎么从请求解析出 user 是 core/auth.py 的事，这里只留一个挂钩，
# 避免 realtime 反向依赖 auth 的实现细节。
_user_resolver: Callable[..., Any] | None = None

# 回落解析器只查一次就缓存。_MISSING 表示"查过了、core.auth 给不出来"，
# 用它把结果钉死，否则每条 SSE 连接都要吃一次 ImportError（异常不便宜，
# 而且日志会被刷屏）。
_MISSING = object()
_fallback_resolver: Any = _MISSING


def set_user_resolver(fn: Callable[..., Any]) -> None:
    """由应用启动代码注入 (request) -> user。同步函数会被丢进线程池。"""
    global _user_resolver
    _user_resolver = fn


def _get_fallback_resolver() -> Callable[..., Any] | None:
    """没人注入时，回落到 core.auth 的公开入口。

    用 get_current_user_optional 而不是 resolve_user：前者先读 ContextVar，
    AuthContextMiddleware 已经解析过的请求就不会再查一次库；语义也正好是
    "登录了就认、没登录也放行"，剩下的准入交给各模块的 authorize。
    """
    global _fallback_resolver
    if _fallback_resolver is _MISSING:
        try:
            from backend.core.auth import get_current_user_optional  # 延迟导入，避免循环依赖
        except Exception:  # noqa: BLE001
            _fallback_resolver = None
            log.warning("realtime 没有可用的用户解析器，所有 SSE 连接按匿名处理")
        else:
            _fallback_resolver = get_current_user_optional
    return _fallback_resolver


async def _resolve_user(request: Request) -> Any:
    fn = _user_resolver if _user_resolver is not None else _get_fallback_resolver()
    if fn is None:
        return None  # 还没接 auth：一切按匿名处理，authorize 自己决定放不放行
    try:
        return await _call(fn, request)
    except Exception:  # noqa: BLE001
        # 身份解析炸了（会话过期、DB 抖动）不该让 SSE 直接 500。
        # 降级成匿名 → authorize 多半会拒 → 客户端拿到 403 而不是 500，
        # 这是**失败关闭**，不是放行。
        log.exception("realtime 解析用户失败，本条连接按匿名处理")
        return None


# ── 统一端点 ──────────────────────────────────────────────────────────────

async def _call(fn: Callable[..., Any] | None, *args: Any) -> Any:
    """调用模块回调：async 的直接 await，同步的丢线程池。

    ⚠️ 这条规则是本文件最要命的地方。SSE 端点是 async def，
    **任何同步的 DB / Redis 查询直接在里面跑，都会卡住这个 worker 上
    所有 SSE 连接和所有普通请求**（单线程事件循环）。
    实测 mirror 的 host_snapshot 一次要读 4 个以上的 key 并遍历 roster，
    quiz_game 的 host_snapshot 要读 players+answers 还排两次序 ——
    100 人同时重连时这就是最先炸的地方。
    反过来，线程池名额默认只有 40，所以 snapshot 也必须快，必要时加缓存。
    """
    if fn is None:
        return None
    if inspect.iscoroutinefunction(fn):
        return await fn(*args)
    result = await run_in_threadpool(fn, *args)
    if inspect.isawaitable(result):  # 回调是返回协程的 lambda / partial
        return await result
    return result


# ── 数据库连接：SSE 必须自己还，中间件还不了 ──────────────────────────────
# core/middleware.py 的 DBSessionMiddleware 是纯 ASGI 中间件，它的 finally 要等
# **响应体全部发完** 才跑 —— 对一条挂一小时的 SSE 连接，就是一小时。
# 作用域本身是惰性的不占连接，但只要 authorize / snapshot 查过一次库，
# 那条 PG 连接就被这个 Session 一直握着不放。
# 池子是 pool_size=8 + max_overflow=4 = 12 条/worker：**十几条 SSE 就能占满**，
# 之后这个 worker 的每一个请求（不只是 SSE）都堵在等连接上，表现是「整站转圈」。
# 这一条 DBSessionMiddleware 的 docstring 里已经点名说「由 core/realtime.py 自己补」。

_db_scope_factory: Any = _MISSING


def _get_db_scope_factory():
    """拿 core.db.db_session_scope。延迟导入，免得 realtime 硬依赖 db 层。"""
    global _db_scope_factory
    if _db_scope_factory is _MISSING:
        try:
            from backend.core.db import db_session_scope
        except Exception:  # noqa: BLE001
            _db_scope_factory = None
            log.warning("realtime 取不到 core.db，SSE 不再管数据库连接的归还")
        else:
            _db_scope_factory = db_session_scope
    return _db_scope_factory


def _release_db_connection() -> None:
    """把本请求 Session 占着的 PG 连接还回池子。**必须在工作线程里调**（它会走网络）。

    用 rollback 而不是 session.remove()：
      · remove() 会 close 掉 Session，把 user 等 ORM 对象 **detach** 掉，
        后面回调再碰属性就是 DetachedInstanceError；
      · rollback() 只是结束事务、把连接交还池子，对象仍然挂在 Session 上
        （属性被 expire，下次访问自动重查、自动再要一条连接）。
    没提交的改动会被丢弃 —— 这和请求结束时 close_scope 的行为一致，不改变语义。
    """
    try:
        from backend.core.db import session as db_session
    except Exception:  # noqa: BLE001
        return
    try:
        db_session.rollback()
    except RuntimeError:
        # 当前上下文压根没开作用域（core.db 的 _scopefunc 会这么抛），没什么可还的。
        pass
    except Exception:  # noqa: BLE001
        log.exception("realtime 归还数据库连接失败")


def _call_sync_in_own_db_scope(fn: Callable[..., Any], *args: Any) -> Any:
    """在**自己**的数据库会话作用域里跑一个同步回调。只给断连清理用。

    ★ 不这么做会漏连接，而且是无声的：

    断连清理是个游离任务，create_task 复制的是请求上下文的**快照**——
    里面那个作用域键还在，可请求侧的中间件早就 close_scope 过了，
    scoped_session 的 registry 里对应的 Session 已经被摘掉。
    这时候回调一查库，scoped_session 会拿那个**已经作废的键**新建一个 Session
    塞回 registry，而之后再没有任何人会为这个键调 remove()：
      · registry 里多一条永不回收的记录（键是 uuid4，每条连接都不一样 → 无限增长）；
      · 池子里少一条永不归还的 PG 连接。
    12 条池子，十几次断连就干净了，整个 worker 卡死在等连接上。

    所以这里先开一个属于自己的作用域，跑完立刻关掉。
    （async 的 on_disconnect 套不上这个同步上下文管理器 —— 它要是碰同步 DB，
      请自己 `with db_session_scope():`。）
    """
    factory = _get_db_scope_factory()
    if factory is None:
        return fn(*args)
    with factory():
        return fn(*args)


def _spawn_cleanup(spec: RealtimeApp, conn: Connection) -> None:
    """把断连清理丢成一个游离任务。

    不能在生成器的 finally 里 await：客户端断线时 Starlette 是 **取消** 这个任务，
    finally 里再 await 会立刻又吃到 CancelledError，presence 就清不掉了。
    """
    fn = spec.on_disconnect
    if fn is None:
        return

    async def _run():
        try:
            if inspect.iscoroutinefunction(fn):
                await fn(conn)
            else:
                result = await run_in_threadpool(_call_sync_in_own_db_scope, fn, conn)
                if inspect.isawaitable(result):
                    await result
        except Exception:  # noqa: BLE001
            log.exception("realtime on_disconnect 失败 app=%s conn=%s", conn.app, conn.id)

    try:
        task = asyncio.get_running_loop().create_task(_run())
    except RuntimeError:
        return
    _cleanup_tasks.add(task)
    task.add_done_callback(_cleanup_tasks.discard)


def make_realtime_router(prefix: str = "") -> APIRouter:
    """返回统一实时端点的路由：GET {BASE}/{app}/realtime?room=a&room=b

    这里**没有** /api 这一段：BASE_PATH（如 /UTBA_DEMO）已经区分了项目，
    再套一层 /api 不带信息量。完整形状见 11-BASE_PATH.md。

    BASE_PATH 不在这里拼，由 ASGI 的 root_path / nginx 负责。
    """
    router = APIRouter(prefix=prefix, tags=["realtime"])

    @router.get("/{app}/realtime")
    async def realtime(  # noqa: ANN202
        app: str,
        request: Request,
        room: Annotated[list[str], Query(description="房间 id，可重复")] = [],
    ):
        spec = REGISTRY.get(app)
        if spec is None:
            raise HTTPException(404, f"未知的实时模块：{app}")
        if not room:
            raise HTTPException(400, "至少要带一个 room 参数")

        # room 以外的查询参数原样交给回调 —— mirror/quiz_game 靠 ?as={guest_id}
        # 认人，fahui 终端靠 ?token= 鉴权，见 RealtimeApp 的注释。
        params = {k: v for k, v in request.query_params.items() if k != "room"}
        user = await _resolve_user(request)

        # ★ 上限要卡在"看过几个候选"，不是"收下几个房间"。
        # 只卡后者的话，?room= 刷一万个全部鉴权失败的 id，就是一万次 authorize、
        # 一万次线程池里的库查询 —— 一个 GET 请求就能把 40 个线程池名额占满。
        candidates = list(dict.fromkeys(room))[:MAX_ROOMS_PER_CONNECTION]  # 去重且保序
        if len(room) > len(candidates):
            log.warning("realtime 订阅房间数超限 app=%s 已截断到 %d 个",
                        app, MAX_ROOMS_PER_CONNECTION)
        rooms: list[str] = []
        for candidate in candidates:
            if not candidate or len(candidate) > MAX_ROOM_ID_LENGTH:
                continue
            if await _call(spec.authorize, candidate, user, params):
                rooms.append(candidate)
        if not rooms:
            raise HTTPException(403, "没有可订阅的房间")

        conn = Connection(
            id=uuid.uuid4().hex,
            app=app,
            rooms=rooms,
            user=user,
            params=params,
            connected_at_ms=now_ms(),
        )
        keys = [room_key(app, r) for r in rooms]

        async def gen():
            # ★ 只有真的建起了订阅才算「连过」，也才需要清理。
            # 不加这个标志的话有一条很容易踩的路径：Redis 挂着的时候
            # subscribe() 里的 _ensure_fanout() 要等满 FANOUT_READY_TIMEOUT，
            # 用户等不及一刷新，生成器在 __aenter__ 里就被取消 ——
            # 什么都还没登记，却照样触发一次 on_disconnect。
            # 对「进场登记 / 退场注销」成对的模块，这就是人数被减成负数。
            established = False
            try:
                # ★ 顺序是先订阅、后推 snapshot，和设计文档 §4.2 的示意相反。
                # 反过来的话，snapshot 查询期间（可能几十毫秒）发生的事件会掉进
                # 订阅还没建立的窗口里，客户端就会停在一个旧状态上直到下一次事件。
                async with subscribe(keys) as queue:
                    established = True
                    # 先告诉客户端它的 connection_id：
                    # ① POST 动作带上它，服务端广播时塞进信封的 sender，
                    #    客户端据此丢掉自己发出的回声（旧 skip_sid 的语义）；
                    # ② presence 心跳/keepalive 接口用它标识自己。
                    yield sse_pack("ready", {
                        "connection_id": conn.id,
                        "rooms": rooms,
                        "ts": now_ms(),
                    })

                    if spec.on_connect is not None:
                        try:
                            await _call(spec.on_connect, conn)
                        except Exception:  # noqa: BLE001
                            log.exception("realtime on_connect 失败 app=%s", app)

                    # 每个房间推一份完整 snapshot。
                    # 不做增量补发、不留消息历史：断线 → EventSource 自动重连 →
                    # 收到新 snapshot → 状态自愈。实现简单一个数量级，
                    # 代价是 snapshot 比增量大（本项目一个房间几十人，无所谓）。
                    #
                    # ⚠️ 残留竞态：先订阅换来的代价是，snapshot 查询期间排进队列的
                    # 增量可能**比 snapshot 还旧**，客户端会在新状态上盖一层旧的。
                    # 本项目的事件基本都是全量语义（leaderboard/players/state），
                    # 下一条就自己纠正回来。真要严格的模块，用信封里的 ts 比一下：
                    # 丢掉 ts < 本房间 snapshot.ts 的帧即可。
                    for r in rooms:
                        try:
                            snap = await _call(spec.snapshot, r, user, params)
                        except Exception:  # noqa: BLE001
                            log.exception("realtime snapshot 失败 app=%s room=%s", app, r)
                            continue
                        if snap is not None:
                            yield sse_pack("snapshot", {"room": r, "ts": now_ms(), "data": snap})

                    # ★★★ 进长等待之前，把 PG 连接还回池子。★★★
                    # 见 _release_db_connection 的注释：不还的话，一条 SSE 挂多久就占多久，
                    # 十几条就能把一个 worker 的 12 条连接池占干净，整站转圈。
                    #
                    # 位置必须在这里，不能塞进 _call 里「每个回调跑完就还」：
                    # snapshot 返回的 dict 里可能带着 ORM 对象，rollback 会把属性 expire 掉，
                    # 上面 sse_pack 序列化时就会触发 lazy 重查 —— 那是一次货真价实的
                    # **同步 DB 查询落在事件循环上**，比不还连接更糟。等全部序列化完再还。
                    #
                    # 也是同步调用，所以要丢线程池：rollback 要往 PG 发一个包。
                    await run_in_threadpool(_release_db_connection)

                    while True:
                        try:
                            item = await asyncio.wait_for(queue.get(), timeout=KEEPALIVE_SECONDS)
                        except asyncio.TimeoutError:
                            # 超时才检查断线：is_disconnected() 只是查状态、不会阻塞，
                            # 放在这里意味着最坏 15 秒发现一次，够用了 ——
                            # 真正的兜底是这一行 keepalive 写失败时抛出异常。
                            if await request.is_disconnected():
                                break
                            yield _keepalive_frame()
                            continue
                        if item is _CLOSE:
                            break  # 扇出断了，让客户端重连自愈
                        yield item
            finally:
                if established:
                    _spawn_cleanup(spec, conn)

        return StreamingResponse(
            gen(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache, no-transform",
                # 双保险：即使 nginx 那条 location 漏了 proxy_buffering off，
                # 这个头也能让 nginx 不缓冲（否则表现为"延迟几十秒"或"一次涌一堆"）。
                "X-Accel-Buffering": "no",
            },
        )

    return router
