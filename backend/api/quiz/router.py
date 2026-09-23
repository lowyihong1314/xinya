"""抢答（快速抢答墙）的 HTTP 路由。原 app/quiz/routes.py（Flask Blueprint，挂在 /api/quiz）。

只做框架适配：装饰器、参数提取、响应构造、以及把出向广播从 Socket.IO 换成 SSE。
校验顺序、状态码、错误文案、响应体的键名与嵌套形状**逐字照搬** —— 前端
frontend/src/quiz/ 下的主持台和抢答页按 status / reason 分支，改一个键就是线上故障。

URL 变化（BASE_PATH 由 nginx 剥掉，应用内部一律写裸路径；/api 这一段没了）：

    POST /api/quiz/session                  → POST /quiz/session
    GET  /api/quiz/session?token=xxx        → GET  /quiz/session?token=xxx
    GET  /api/quiz/session/<token>          → GET  /quiz/session/{token}
    POST /api/quiz/session/<token>          → POST /quiz/session/{token}
    POST /api/quiz/session/<token>/publish  → POST /quiz/session/{token}/publish
    POST /api/quiz/session/<token>/reset    → POST /quiz/session/{token}/reset
    POST /api/quiz/session/<token>/close    → POST /quiz/session/{token}/close

Flask 里 GET /session 和 GET /session/<token> 是**同一个视图函数的两个 rule**
（``token = token or request.args.get("token")``）。FastAPI 这边拆成两个函数：
带默认值的路径参数在不同版本里行为不一致，而 Flask 的两条 rule 本来就走不同的取值口径，
拆开反而是逐字对应 —— 两条最终都落到同一个 ``_session_snapshot_response``。

★ 三条硬性约束（违反会启动即失败或线上事故），详见 api/permission_mgmt/router.py 顶部：
  ① 本文件**不能**写 ``from __future__ import annotations``：core.auth.login_required
     用 functools.wraps 包过，FastAPI 求值注解时用的是 core/auth.py 的命名空间，
     开了这行会在那里找不到 Optional 而 NameError。
  ② 路由一律 ``def``（同步）：底下全是同步 Redis 调用，async def 会焊死 worker 的事件循环。
  ③ 装饰器顺序 ``@router.post(...)`` 在上、``@login_required`` 在下。


═══════════ 出向广播：Socket.IO → SSE ═══════════

原来是 ``socket_broker.emit(event_name, snapshot, to=services.socket_room(token))``，
现在是 ``publish_sync("quiz", token, event_name, snapshot)``。

⚠️ room_id 传的是**裸 room_token**，不是 ``services.socket_room()`` 拼出来的
``quiz:{token}`` —— core.realtime.channel_of 自己会拼成 ``rt:quiz:{token}``，
传拼好的进去会变成 ``rt:quiz:quiz:{token}``，订阅端永远收不到。

事件名（``quiz:config_updated``）在线上不变：前端 EventSource 的 addEventListener
按这个名字挂监听，改了等于所有主持台都收不到配置更新。

📌 与 Flask 的**一处行为差异**（有意为之）：
   ``socket_broker.emit`` 走 Socket.IO 的 Redis message queue，Redis 挂掉时会**抛异常**，
   于是被下面的 ``except Exception`` 接住 → 接口回 500「抢答服务错误」。
   而 ``publish_sync`` 内部自己吞异常、只返回 bool，所以 Redis 挂掉时
   **配置已经存进 Redis 了（存也会失败，实际会在前一步就抛）**、广播丢了、接口仍回 200。
   这个差异是 realtime 层的设计决定（广播失败不该让写操作看起来失败，
   客户端重连会重新拉 snapshot 自愈），不在本次迁移里改。


═══════════ 还没搬的东西：socket_events.py 里 8 个 quiz:* 入向事件 ═══════════

本次**只搬 HTTP 路由 + 出向推送**。app/socket_events.py 里下面这 8 个入向事件原样留着，
下一批统一转成 POST 接口。对应关系（给下一批的人）：

    quiz:host:join        → 不需要新接口。订阅 GET {BASE}/quiz/realtime?room={token} 即可，
                            首帧 snapshot 由 RealtimeApp.snapshot 回调推，
                            等价于原来 join_room + emit("quiz:snapshot", to=sid)。
    quiz:guest:join       → POST /quiz/session/{token}/guests
                            body {guest_id, guest_name}；空 guest_name 回 400 missing_guest_name。
                            presence 的登记/注销更适合挂在 RealtimeApp 的
                            on_connect/on_disconnect 上（见下面的规约），
                            这个 POST 只负责校验名称 + 广播 quiz:snapshot。
    quiz:host:save_config → **已经有了**：POST /quiz/session/{token}（本文件）。socket 版是重复入口，直接删。
    quiz:host:publish     → **已经有了**：POST /quiz/session/{token}/publish。
    quiz:host:reset       → **已经有了**：POST /quiz/session/{token}/reset。
    quiz:host:close       → **已经有了**：POST /quiz/session/{token}/close。
    quiz:guest:tap        → POST /quiz/session/{token}/tap
                            body {guest_id, guest_name, client_clicked_at_ms}；
                            这是**唯一真正缺的路由**（service.record_tap 已经就位）。
                            成功：publish_sync("quiz", token, "quiz:leaderboard", snapshot)；
                            失败：QuizError 直接按 {"reason", "message"} 回给调用方
                            （原来是 emit("quiz:tap_rejected", …, to=request.sid)，
                            SSE 没有「只发给我」，所以这条必须走 HTTP 响应体回去）。
    quiz:time:ping        → POST /quiz/time
                            body {client_sent_at_ms} → {"client_sent_at_ms": …, "server_now_ms": …}。
                            ⚠️ 这个是**对时**，抢答排名全靠它。别做成 GET —— 会被
                            浏览器/nginx 缓存，缓存住的 server_now_ms 会让所有人的偏移算错。

出向事件一览（前端监听的名字，搬的时候别改）：
    quiz:config_updated（本次已接 SSE）、quiz:snapshot、quiz:leaderboard、
    quiz:tap_rejected（改走 HTTP 响应）、quiz:error（改走 HTTP 状态码）、quiz:time:pong（同上）。


═══════════ RealtimeApp 规约（先写出来，本次**不 register**）═══════════

等入向事件搬完再在这里 register 一次。形状是：

    from backend.core.realtime import RealtimeApp, publish_sync, register

    def _authorize(room_id, user, params):
        # 房间 token 本身就是凭证：6 位随机 + 24h TTL，Socket.IO 时代也是
        # 「谁知道 token 谁就能 join_room」，主持人和观众不做区分。
        # 这里**不区分 user 是否登录** —— 抢答页就是给未登录的现场观众用的。
        try:
            token = service.normalize_token(room_id)
        except service.QuizError:
            # ⚠️ 必须吞掉：authorize 里抛异常会变成 500，而非法 room_id
            #    只是「这个房间不给订」，返回 False 让 realtime 静默剔除它。
            return False
        return service.get_session(token) is not None

    def _snapshot(room_id, user, params):
        # 用 get_session 判空而不是 build_snapshot 直接上：后者内部 require_session
        # 会抛 QuizError，而 snapshot 回调抛异常 = 整条 SSE 连接建不起来。
        # 房间刚好过期时应该是「没有首帧」（返回 None），不是 500。
        session = service.get_session(room_id)
        return service.build_snapshot(session) if session else None

    def _on_connect(conn):
        # guest_id 在客户端 localStorage 里，不在 user 里，所以从查询参数取：
        #   前端连 {BASE}/quiz/realtime?room={token}&as={guest_id}
        # conn.id 顶替原来的 sid（quiz:sid_map 那张 hash 的键）。
        guest_id = conn.params.get("as")
        if not guest_id:
            return  # 主持台不带 as，不进 guests 集合，不计入 player_count
        for room_id in conn.rooms:
            service.add_guest(room_id, guest_id, sid=conn.id)
            publish_sync("quiz", room_id, "quiz:snapshot", service.build_snapshot(room_id))

    def _on_disconnect(conn):
        token = service.remove_guest_by_sid(conn.id)
        if token:
            publish_sync("quiz", token, "quiz:snapshot", service.build_snapshot(token))

    register(RealtimeApp(
        name="quiz",
        authorize=_authorize,
        snapshot=_snapshot,
        on_connect=_on_connect,
        on_disconnect=_on_disconnect,
    ))

⚠️ on_disconnect 只是兜底：SSE 的断开发现得比 Socket.IO 晚（要等下一次心跳写失败，
   手机锁屏最坏十几秒起步）。人数的正路是 guests_key 上已有的 GUEST_TTL_SECONDS（2 小时）
   自己过期 —— 别把 player_count 当强一致的数。
"""

from typing import Optional

from fastapi import APIRouter, Body

from backend.api.quiz import service
from backend.core.auth import current_user, login_required
from backend.core.config import settings
from backend.core.realtime import publish_sync
from backend.core.responses import json_response

# prefix 用 settings.api_prefix 拼而不是写死：api_prefix 今天是空串
# （BASE_PATH 已经区分了项目，再套一层 /api 不带信息量），留着是为了需要时还能整体加回来。
router = APIRouter(prefix=f"{settings.api_prefix}/quiz", tags=["quiz"])

# 对应 Flask 的 ``request.get_json(silent=True) or {}``：没有 body / body 是 null 时
# 落到 None，路由里 ``payload or {}`` 补成空字典，后面的校验分支自然会回 400。
_JSON_BODY = Body(default=None)

# realtime 的 app 名。与 core.realtime.channel_of 拼频道用的第一段一致，
# 也和前端 EventSource 连的 {BASE}/quiz/realtime 里那个 quiz 是同一个值。
_REALTIME_APP = "quiz"


def _json_error(error):
    """把异常翻成响应。逐字照搬原 routes.py 的 _json_error。

    ★ 注意默认分支是 500 + 「抢答服务错误」/ server_error，**不是** 400：
    非 QuizError 的异常都是我们自己的 bug，不该让前端以为是它参数传错了。
    """
    if isinstance(error, service.QuizError):
        return json_response(
            {"status": "error", "message": str(error), "reason": error.reason},
            error.status_code,
        )
    return json_response({"status": "error", "message": "抢答服务错误", "reason": "server_error"}, 500)


def _broadcast_snapshot(event_name, session_or_token):
    """重算 snapshot 并广播给房间里所有人，返回这份 snapshot 给调用方当响应体。

    ★ 返回的和广播的是**同一个对象**，这是原代码的关键性质，别拆成两次 build_snapshot：
    snapshot 里有 ``server_now_ms``，两次算会差几毫秒，
    而主持台同时收到 HTTP 响应和 SSE 推送，两份对不上时倒计时会跳一下。
    """
    snapshot = service.build_snapshot(session_or_token)
    # room_id 传裸 token：频道前缀由 realtime 自己拼，传 socket_room() 的返回值会拼重。
    publish_sync(_REALTIME_APP, snapshot["room_token"], event_name, snapshot)
    return snapshot


@router.post("/session")
@login_required
def create_quiz_session():
    try:
        session = service.create_session(getattr(current_user, "id", None))
        snapshot = service.build_snapshot(session)
        # 响应里 session 和 token 是冗余的（token 就是 snapshot["room_token"]），
        # 但前端两处都在读，不能省。
        return json_response({"status": "success", "session": snapshot, "token": session["room_token"]})
    except Exception as exc:
        return _json_error(exc)


def _session_snapshot_response(token):
    """GET 的两条 rule 共用的实现。token 为 None 时由 normalize_token 回 400 missing_token。"""
    try:
        snapshot = service.build_snapshot(token)
        return json_response({"status": "success", "session": snapshot})
    except Exception as exc:
        return _json_error(exc)


@router.get("/session")
def get_quiz_session_by_query(token: Optional[str] = None):
    # 对应 Flask 的 ``request.args.get("token")``。声明成 Optional 带默认值，
    # **不能写成必填** —— 必填会让缺参数时回 FastAPI 的 422，
    # 而原来走的是 normalize_token 的 400 + 「缺少抢答 token」/ missing_token。
    return _session_snapshot_response(token)


@router.get("/session/{token}")
def get_quiz_session(token: str):
    # 这条不鉴权：抢答页给未登录的现场观众用，token 本身就是凭证。
    return _session_snapshot_response(token)


@router.post("/session/{token}")
@login_required
def save_quiz_session(token: str, payload: Optional[dict] = _JSON_BODY):
    try:
        data = payload or {}
        # ``payload.get("config") or payload``：兼容两种前端写法 ——
        # 新版发 {"config": {...}}，旧版把 title / wait_seconds 平铺在顶层。
        # 注意是 ``or`` 不是 ``if "config" in``：{"config": {}} 会落回整个 payload，
        # 于是空配置被当成平铺格式解析，title 取不到而回退成空串。
        # TODO(迁移): 看着像 bug，但前端确实有依赖平铺格式的老页面，本次原样保留。
        session = service.save_config(token, data.get("config") or data)
        snapshot = _broadcast_snapshot("quiz:config_updated", session)
        return json_response({"status": "success", "session": snapshot})
    except Exception as exc:
        return _json_error(exc)


@router.post("/session/{token}/publish")
@login_required
def publish_quiz_session(token: str):
    try:
        session = service.publish_session(token)
        # ★ 发布 / 重置 / 关闭三条推的都是 ``quiz:config_updated``，不是各自的事件名 ——
        #   snapshot 里带 status，客户端只认状态不认动作。别「顺手」拆成三个事件名，
        #   前端只挂了这一个监听。
        snapshot = _broadcast_snapshot("quiz:config_updated", session)
        return json_response({"status": "success", "session": snapshot})
    except Exception as exc:
        return _json_error(exc)


@router.post("/session/{token}/reset")
@login_required
def reset_quiz_session(token: str):
    try:
        session = service.reset_session(token)
        snapshot = _broadcast_snapshot("quiz:config_updated", session)
        return json_response({"status": "success", "session": snapshot})
    except Exception as exc:
        return _json_error(exc)


@router.post("/session/{token}/close")
@login_required
def close_quiz_session(token: str):
    try:
        session = service.close_session(token)
        snapshot = _broadcast_snapshot("quiz:config_updated", session)
        return json_response({"status": "success", "session": snapshot})
    except Exception as exc:
        return _json_error(exc)
