"""「别人眼中的我」（匿名互评）的 HTTP 路由 + 实时规约。

原文件两份，这次一起搬：
  · backend/app/mirror/routes.py         —— 5 条 HTTP 路由（Flask Blueprint，挂在 {API_PREFIX}/mirror）
  · backend/app/mirror/socket_events.py  —— 9 个 ``mirror:*`` 入向事件，全部转成 POST

只做框架适配：装饰器、参数提取、响应构造、出向广播从 Socket.IO 换成 SSE。
校验顺序、状态码、中文文案、响应体的键名与嵌套形状**逐字照搬** ——
主持台和手机端都在按 status / reason 分支，改一个键就是线上故障。

★★ 这个模块的匿名性是在 service.py 的数据层保证的（评分只存在评分者自己的 hash 里、
   min_reveal_count 挡住样本太少的平均分、host_snapshot 里一个分数都没有）。
   本文件只负责把这些 snapshot 原样搬运，**不要**在任何响应或广播里补充
   「全场平均分」「谁给谁打了几分」之类的字段 —— 那是产品承诺，不是实现细节。

── URL 对照（旧 → 新）────────────────────────────────────────────────
``/api`` 这一段整体去掉了（BASE_PATH 已经区分项目，见 docs/flask_to_fastAPI/11），
其余路径一个字符没动：

    POST /api/mirror/session                              → POST /mirror/session
    GET  /api/mirror/session/<token>                      → GET  /mirror/session/{token}
    POST /api/mirror/session/<token>/photo                → POST /mirror/session/{token}/photo
    GET  /api/mirror/session/<token>/photo/<member_id>    → GET  /mirror/session/{token}/photo/{member_id}
    POST /api/mirror/session/<token>/config               → POST /mirror/session/{token}/config

── 四条搬迁硬约束（违反会启动即失败或线上事故）────────────────────────

  ① 本文件**不能写 ``from __future__ import annotations``**。core.auth 的装饰器用
     functools.wraps 包过，FastAPI 求值注解时用的是 core/auth.py 的命名空间，
     开了这一行会在那里找不到 ``Optional`` 而**启动即 NameError**。

  ② 路由函数一律 ``def``（同步）。底下全是同步 Redis 调用，写成 async def 会把
     worker 的事件循环焊死。FastAPI 会自动把 def 丢线程池。

  ③ 装饰器顺序 ``@router.post(...)`` 在上、``@login_required`` 在下。

  ④ ``{token}`` / ``{member_id}`` 不加 ``:int`` 转换器 —— 它们本来就是字符串，
     Flask 的 ``<token>`` 也是默认的 string 转换器（不匹配斜杠），一一对应。


═══════════ 入向事件：9 个 mirror:* → 9 条 POST ═══════════

规则见 docs/flask_to_fastAPI/16-入向事件转POST.md，参考 api/quiz/router.py 末尾。
事件名里的冒号换成路径段：

    mirror:host:join    → POST /mirror/host/join      （= host/sync，见下）
    mirror:host:sync    → POST /mirror/host/sync
    mirror:host:start   → POST /mirror/host/start
    mirror:host:reveal  → POST /mirror/host/reveal
    mirror:host:reset   → POST /mirror/host/reset
    mirror:host:kick    → POST /mirror/host/kick
    mirror:guest:join   → POST /mirror/guest/join
    mirror:guest:sync   → POST /mirror/guest/sync
    mirror:guest:rate   → POST /mirror/guest/rate

``host:join`` 和 ``host:sync`` 原来只差一个 ``join_room()``，而 join_room 在 SSE 里
不存在（订阅 ``{BASE}/mirror/realtime?room={token}`` 就是加入房间），所以两条 POST
的实现完全一样。**仍然两条都留着**：9 个事件 9 条路由，一一对得上，
前端改造时不用去记「哪个被合并了」。想省一次请求的话，主持台可以两条都不发 ——
SSE 的首帧 snapshot 就是 host_snapshot（见文件末尾的 RealtimeApp 规约）。

出向事件名（前端 EventSource 按名字挂监听，搬的时候一个字都不能改）：
``mirror:state``、``mirror:progress``；
``mirror:host`` / ``mirror:player`` / ``mirror:joined`` / ``mirror:rate_rejected`` /
``mirror:error`` 这几个原本就是「只发给发送者」的，现在**就是 HTTP 响应体**。

★ 这个模块的广播是**很薄的一个 ping**：``mirror:state`` 只带 status，
  ``mirror:progress`` 只带名单和进度数字，收到的人各自再去拉**自己那一份** snapshot。
  原因还是匿名性 —— 每个人看到的东西都不一样（评的人不同、结果只有自己的），
  所以房间里**永远不广播任何按人不同的内容**。别为了省一次往返把 snapshot 塞进广播。

★ 广播一律**不带 ``sender``**（16 号文档里那个「丢掉自己的回声」的机制这里不用）。
  两个原因：
    · Socket.IO 的 ``emit(..., to=room)`` 在 handler 里是**连发送者一起**发的，
      不带 sender 才是逐字对应；
    · ``/guest/rate`` 那条路真的**依赖**发送者收到自己的广播：最后一个人评完时
      自动揭晓，而他的 HTTP 响应体是在 ``reveal_results`` **之前**算好的
      （status 还是 "rating"），全靠随后那条 ``mirror:state`` 把他推进结果页。
      给它带上 sender，最后一个人就会永远卡在评分页。
  代价只是每个动作的发起者多拉一次自己的 snapshot —— 这里没有乐观更新，
  重复拉一次不会有状态回跳。
"""

from typing import Optional

from fastapi import APIRouter, Body
from starlette.responses import Response

from backend.api.mirror import service
from backend.core.auth import current_user, login_required
from backend.core.config import settings
from backend.core.realtime import RealtimeApp, publish_sync, register
from backend.core.responses import json_response

# prefix 用 settings.api_prefix 拼而不是写死 "/mirror"：api_prefix 今天是空串
# （BASE_PATH 已经区分了项目，再套一层 /api 不带信息量），留着是为了需要时还能整体加回来。
router = APIRouter(prefix=f"{settings.api_prefix}/mirror", tags=["mirror"])

# 对应 Flask 的 ``request.get_json(silent=True) or {}``：没有 body / body 是 null 时
# 落到 None，路由里 ``payload or {}`` 补成空字典，后面的校验分支自然会回 400。
# 📌 一处已知差异：body 是**坏掉的 JSON**（不是空的）时，Flask 的 silent=True 会
#    吞成 {} 继而回 400「缺少活动 token」，FastAPI 会先回 422。全项目一致
#    （api/quiz 等同款），属于框架层差异，不在本次逐字保留的范围内。
_JSON_BODY = Body(default=None)

# realtime 的 app 名。与 core.realtime.channel_of 拼频道用的第一段一致，
# 也和前端 EventSource 连的 {BASE}/mirror/realtime 里那个 mirror 是同一个值。
# ⚠️ 房间 id 传**裸 token**，不是 service.socket_room() 拼出来的 "mirror:{token}"。
_REALTIME_APP = "mirror"


# ─────────────────────── 错误出口 ───────────────────────
#
# 原来有两份几乎一样的实现（routes.py 的 _handle_exception、socket_events.py 的
# _emit_error），信封一模一样，只有 print 的前缀不同（"Mirror route error" /
# "Mirror socket error"）。这里**照样留两份** —— 那两行日志是线上 grep 的锚点，
# 合并会让「是 HTTP 打进来的还是实时动作打进来的」这个区分消失。


def _handle_exception(exc):
    """HTTP 路由的错误出口。逐字照搬原 routes.py 的 _handle_exception。

    ★ 默认分支是 500 + 「活动服务错误」/ server_error，**不是** 400：
    非 MirrorError 的异常都是我们自己的 bug，不该让前端以为是它参数传错了。
    """
    if isinstance(exc, service.MirrorError):
        return json_response(
            {"status": "error", "message": str(exc), "reason": exc.reason}, exc.status_code
        )
    print("⚠️ Mirror route error:", exc)
    return json_response({"status": "error", "message": "活动服务错误", "reason": "server_error"}, 500)


def _event_error(exc):
    """由 socket 事件转成的 POST 的错误出口。原 socket_events.py 的 _emit_error。

    原来 emit 的 payload 里还有一个 ``status_code`` 字段（Socket.IO 没有状态行，
    只能把它塞进 body）。HTTP 版里它**就是响应的状态行**，所以 body 里不再重复带 ——
    这是 16 号文档规定的映射，不是漏掉了。
    """
    if isinstance(exc, service.MirrorError):
        return json_response(
            {"status": "error", "message": str(exc), "reason": exc.reason}, exc.status_code
        )
    print("⚠️ Mirror socket error:", exc)
    return json_response({"status": "error", "message": "活动服务错误", "reason": "server_error"}, 500)


def _require_user():
    """主持人动作的登录校验。原 socket_events.py 的 _require_user，逐字照搬。

    ★ 这里**不用** @login_required：那个装饰器的拒绝出口是它自己写死的
      ``{"status":"error","message":"unauthorized"}``，而原实现抛的是
      「请先登录」+ reason="unauthorized"。换过去等于改掉给用户看的那句中文。
      （上面 5 条原本就是 HTTP 的路由里用的是 flask_login 的 @login_required，
        那边才对得上 core.auth.login_required，见各自的注释。）
    """
    if not getattr(current_user, "is_authenticated", False):
        raise service.MirrorError("请先登录", 401, "unauthorized")


# ─────────────────────── 广播 ───────────────────────


def _broadcast_state(session):
    """告诉房间「阶段变了」，每个客户端再各自去拉自己那一份。

    原 socket_events.py 的 _broadcast_state，payload 逐字照搬（只有 status 和 token）。
    """
    publish_sync(
        _REALTIME_APP,
        session["room_token"],
        "mirror:state",
        {"status": session.get("status", "lobby"), "room_token": session["room_token"]},
    )


def _broadcast_progress(session):
    """广播名单和进度。原 socket_events.py 的 _broadcast_progress，payload 逐字照搬。"""
    token = session["room_token"]
    members = service.member_list(token)
    publish_sync(
        _REALTIME_APP,
        token,
        "mirror:progress",
        {
            "members": members,
            "member_count": len(members),
            "finished_count": len(service.finished_ids(session, token)),
            "roster_count": len(session.get("roster") or []),
        },
    )


# ─────────────────────── 成员查找 ───────────────────────


def _lookup_member(token, guest_id):
    """按 guest_id 取成员，没有就 None。取值口径和原 _member_from 完全一致。

    注意是 ``str(...).strip()`` 而不是 service._clean_text —— 后者还会把中间的
    连续空白压成一个空格。guest_id 是客户端 localStorage 里的随机串，两者结果一样，
    但既然原代码写的是 strip，就按 strip 来。
    """
    return service._load_members(token).get(str(guest_id or "").strip())


def _member_from(token, guest_id):
    """原 socket_events.py 的 _member_from：找不到人就 409 not_joined。"""
    member = _lookup_member(token, guest_id)
    if not member:
        raise service.MirrorError("请先加入活动", 409, "not_joined")
    return member


# ════════════════════════════════════════════════════════════════════
#                     一、原本就是 HTTP 的 5 条路由
# ════════════════════════════════════════════════════════════════════


@router.post("/session")
@login_required
def create_mirror_session(payload: Optional[dict] = _JSON_BODY):
    try:
        data = payload or {}
        session = service.create_session(
            getattr(current_user, "id", None),
            title=data.get("title"),
            min_reveal_count=data.get("min_reveal_count"),
        )
        return json_response(
            {
                "status": "success",
                # token 和 session["room_token"] 是冗余的，但前端两处都在读，不能省。
                "token": session["room_token"],
                "session": service.host_snapshot(session),
            }
        )
    except Exception as exc:
        return _handle_exception(exc)


@router.get("/session/{token}")
def get_mirror_session(token: str):
    """公开：手机在加入之前先探一下这个房间还活着。

    ★ 不鉴权，和原实现一致 —— 参与者都是未登录的现场观众，token 本身就是凭证。
    ★ 回的是 base_meta（标题 / 阶段 / 揭晓门槛 / 人数），**不是** host_snapshot：
      名单和进度不给没进房间的人看。
    """
    try:
        session = service.require_session(token)
        snap = service.base_meta(session)
        snap["member_count"] = len(service.member_list(session["room_token"]))
        return json_response({"status": "success", "session": snap})
    except Exception as exc:
        return _handle_exception(exc)


@router.post("/session/{token}/photo")
def upload_mirror_photo(token: str, payload: Optional[dict] = _JSON_BODY):
    """公开：手机刚进房间就把自己的自拍 POST 上来。

    照片是 data URL（``data:image/jpeg;base64,...``），存进 Redis 的
    ``mirror:{token}:photos``，上限 400KB（超了 413 photo_too_large）。
    ★ 响应里只有 photo_at_ms —— 前端拿它当图片 URL 的 ``?v=`` 去刷缓存。
    """
    try:
        data = payload or {}
        _, member = service.save_photo(token, data.get("guest_id"), data.get("photo"))
        return json_response({"status": "success", "photo_at_ms": member.get("photo_at_ms")})
    except Exception as exc:
        return _handle_exception(exc)


@router.get("/session/{token}/photo/{member_id}")
def get_mirror_photo(token: str, member_id: str):
    """公开：房间里每个名字旁边的那张脸。"""
    try:
        found = service.get_photo(token, member_id)
        if not found:
            return json_response({"status": "error", "message": "没有照片", "reason": "photo_not_found"}, 404)
        blob, mime = found
        # 原 Flask 是 ``Response(blob, mimetype=mime)`` + 手工塞 Cache-Control。
        # 私密内容：一张脸绝不能躺进共享代理的缓存里，所以是 private 而不是 public。
        return Response(content=blob, media_type=mime, headers={"Cache-Control": "private, max-age=3600"})
    except Exception as exc:
        return _handle_exception(exc)


@router.post("/session/{token}/config")
@login_required
def save_mirror_config(token: str, payload: Optional[dict] = _JSON_BODY):
    try:
        data = payload or {}
        # ``data.get("config") or data``：兼容两种前端写法 —— 新版发 {"config": {...}}，
        # 旧版把 title / min_reveal_count 平铺在顶层。
        # 注意是 ``or`` 不是 ``if "config" in``：{"config": {}} 会落回整个 payload，
        # 于是 save_config 去顶层找 title / min_reveal_count，两个键都不在 → 配置不变。
        # TODO(迁移): 看着像 bug，但前端确实有依赖平铺格式的老页面，本次原样保留。
        session = service.save_config(token, data.get("config") or data)
        return json_response({"status": "success", "session": service.host_snapshot(session)})
    except Exception as exc:
        return _handle_exception(exc)


# ════════════════════════════════════════════════════════════════════
#          二、入向动作：9 个 Socket.IO 事件 → 9 条 POST 接口
# ════════════════════════════════════════════════════════════════════
#
# 对应关系（规则见 docs/flask_to_fastAPI/16-入向事件转POST.md）：
#   · 原 `emit(..., to=request.sid)`（只回发送者）→ **就是 HTTP 响应体**
#   · 原 `emit(..., to=room)`（广播房间）→ publish_sync
#   · 原 `join_room(room)` → **不需要**，客户端订阅 SSE 时带 ?room= 即可
#   · 原 `request.sid` → SSE 的 connection_id（ready 事件里下发，请求体里带回来）
#
# 响应信封统一成本模块 HTTP 那一套 ``{"status": "success", "session": <snapshot>}``：
# socket 时代发的是裸 snapshot（事件名区分 host / player），HTTP 只有一个出口，
# 得有个地方放 status 让前端分支成功/失败，所以套一层。
# 键名用 "session" 是跟着上面 5 条 HTTP 路由走的（它们本来就这么发）。


def _host_snapshot_response(payload):
    """host:join 和 host:sync 的共同实现：回一份 host_snapshot。

    原 handle_mirror_host_join 比 sync 多一个 ``join_room(_room(token))``，
    SSE 里没有这一步（订阅即加入），所以两者在 HTTP 上完全一样。
    """
    data = payload or {}
    try:
        # ``room_token`` 和 ``token`` 两个键都认，照搬原实现 —— 前端两种都发过。
        token = service.normalize_token(data.get("room_token") or data.get("token"))
        return json_response(
            {"status": "success", "session": service.host_snapshot(service.require_session(token))}
        )
    except Exception as exc:
        return _event_error(exc)


@router.post("/host/join")
def mirror_host_join(payload: Optional[dict] = _JSON_BODY):
    """主持台进场。原 socket 事件 ``mirror:host:join``。

    ★ 不鉴权 —— 原 handler 也没调 _require_user()，只有 start / reveal / reset / kick
      这四个**改状态**的动作才要求登录。拿得到 token 就看得到名单，照搬。
    """
    return _host_snapshot_response(payload)


@router.post("/host/sync")
def mirror_host_sync(payload: Optional[dict] = _JSON_BODY):
    """主持台重新拉一份自己的 snapshot。原 socket 事件 ``mirror:host:sync``。

    这是本模块「薄广播 + 各自拉」模型里的「拉」：收到 mirror:state / mirror:progress
    之后调它。同样不鉴权，原实现如此。
    """
    return _host_snapshot_response(payload)


@router.post("/guest/join")
def mirror_guest_join(payload: Optional[dict] = _JSON_BODY):
    """参与者报名入场。原 socket 事件 ``mirror:guest:join``。

    与原实现的对应：
      · ``join_room(...)`` 去掉了 —— 订阅 SSE 就是加入房间。
      · ``add_member(..., sid=request.sid)`` 里的 sid 换成客户端上报的
        ``connection_id``。**可以不带**：不带只是 sid_map 里少一条，
        断线时标不回离线；真正的登记在 SSE 建连时由 RealtimeApp.on_connect
        调 service.attach_connection 补上（见文件末尾）。
      · 原来给发送者发了**两个**事件（``mirror:joined`` 的 {id,name} 和
        ``mirror:player`` 的整份 snapshot），HTTP 只有一个响应体，
        所以两份都放进去：joined + session。

    幂等：add_member 是「有就更新、没有就建」，断线重连重发一次是安全的
    （joined_at_ms 只在第一次写，排序不会跳）。
    """
    data = payload or {}
    try:
        token = service.normalize_token(data.get("room_token") or data.get("token"))
        session, member = service.add_member(
            token, data.get("guest_id"), data.get("guest_name"), sid=data.get("connection_id") or None
        )
        # ★ 顺序照搬：先算好要回给本人的 snapshot，再广播进度。
        snapshot = service.player_snapshot(session, member)
        _broadcast_progress(session)
        return json_response(
            {
                "status": "success",
                "joined": {"id": member["id"], "name": member["name"]},
                "session": snapshot,
            }
        )
    except Exception as exc:
        return _event_error(exc)


@router.post("/guest/sync")
def mirror_guest_sync(payload: Optional[dict] = _JSON_BODY):
    """参与者重新拉自己那一份。原 socket 事件 ``mirror:guest:sync``。

    ★ 「自己那一份」是字面意思：player_snapshot 里只有自己要评的人、自己打过的分、
      以及揭晓后自己的结果。别人的分数一个字节都不在里面。
    ★ 没 join 过（members 里没这个人）→ 409 not_joined，照搬 _member_from。
    """
    data = payload or {}
    try:
        token = service.normalize_token(data.get("room_token") or data.get("token"))
        session = service.require_session(token)
        member = _member_from(session["room_token"], data.get("guest_id"))
        return json_response({"status": "success", "session": service.player_snapshot(session, member)})
    except Exception as exc:
        return _event_error(exc)


@router.post("/host/start")
def mirror_host_start(payload: Optional[dict] = _JSON_BODY):
    """开始评分。原 socket 事件 ``mirror:host:start``。

    start_round 会把此刻大厅里的人冻结成本轮名单（少于 2 人 → 400 not_enough_members）。
    原 handler 广播完就结束、什么都不回给主持台（主持台靠收到 mirror:state 再去 sync）；
    这里顺手把 host_snapshot 放进响应，省掉那一次往返（16 号文档 §一）。
    """
    data = payload or {}
    try:
        _require_user()
        token = service.normalize_token(data.get("room_token") or data.get("token"))
        session = service.start_round(token)
        _broadcast_state(session)
        _broadcast_progress(session)
        return json_response({"status": "success", "session": service.host_snapshot(session)})
    except Exception as exc:
        return _event_error(exc)


@router.post("/host/reveal")
def mirror_host_reveal(payload: Optional[dict] = _JSON_BODY):
    """揭晓结果。原 socket 事件 ``mirror:host:reveal``。

    ★ ``changed`` 为 False（已经是 reveal 阶段了）时**不广播**，照搬原实现 ——
      重复点一下不该让所有人的页面再闪一次。
    ★ 揭晓只是把阶段改成 "reveal"，分数仍然只走每个人自己的 player_snapshot；
      主持台这份响应里依旧没有任何分数。
    """
    data = payload or {}
    try:
        _require_user()
        token = service.normalize_token(data.get("room_token") or data.get("token"))
        session, changed = service.reveal_results(token)
        if changed:
            _broadcast_state(session)
        return json_response({"status": "success", "session": service.host_snapshot(session)})
    except Exception as exc:
        return _event_error(exc)


@router.post("/host/reset")
def mirror_host_reset(payload: Optional[dict] = _JSON_BODY):
    """退回大厅并清空评分。原 socket 事件 ``mirror:host:reset``。人不用重新加入。"""
    data = payload or {}
    try:
        _require_user()
        token = service.normalize_token(data.get("room_token") or data.get("token"))
        session = service.reset_round(token)
        _broadcast_state(session)
        _broadcast_progress(session)
        return json_response({"status": "success", "session": service.host_snapshot(session)})
    except Exception as exc:
        return _event_error(exc)


@router.post("/host/kick")
def mirror_host_kick(payload: Optional[dict] = _JSON_BODY):
    """把某个人移出房间。原 socket 事件 ``mirror:host:kick``。

    remove_member 会连他的照片和他打出去的评分一起删掉。
    ★ 它**不动已经冻结的 roster**（见 service.py 模块 docstring ②），
      所以本轮进行中踢人，roster_count 不变、别人还会看到他的卡片。原行为，别改。
    ★ guest_id 为空时 remove_member 直接返回 session 什么也不做，这里照样广播一次进度
      （原实现也是无条件广播），等于一次无害的重发。
    """
    data = payload or {}
    try:
        _require_user()
        token = service.normalize_token(data.get("room_token") or data.get("token"))
        session = service.remove_member(token, data.get("guest_id"))
        _broadcast_progress(session)
        return json_response({"status": "success", "session": service.host_snapshot(session)})
    except Exception as exc:
        return _event_error(exc)


@router.post("/guest/rate")
def mirror_guest_rate(payload: Optional[dict] = _JSON_BODY):
    """给某个人打分。原 socket 事件 ``mirror:guest:rate``。整个活动的核心动作。

    ★ **不幂等，但重复调用是安全的**：record_rating 用 hsetnx，一个被评者只认第一次，
      手抖连点两下是空操作。（客户端仍然不该自动重试 —— 失败要让用户自己再点。）

    ★ 几处必须逐字保留的顺序 / 分支：
      ① ``_member_from`` 在 ``record_rating`` **之后**调。于是有一条尴尬的路径：
         正在评分的人被主持人踢掉（members 里没了但 roster 里还在）时，
         这一票**已经记下了**，调用方却收到 409 not_joined、进度也不广播。
         TODO(迁移): 看着像 bug，原样保留 —— 前端把它当普通错误弹一下，
         下一次 sync 就自愈，而改顺序会让「踢人」的语义跟着变。
      ② 回给本人的 snapshot 是在**自动揭晓之前**算的，所以最后一个评完的人
         拿到的 status 还是 "rating"。他靠随后那条 ``mirror:state`` 进结果页 ——
         这就是本文件顶部说的「广播不能带 sender」的那条命。
      ③ reason 是 not_open / not_in_roster 时走的是原来的 ``mirror:rate_rejected``
         （只发给本人、形状是 {reason, message}），HTTP 版就是响应体，
         加上 status 字段对齐本模块的信封。其余异常（包括 ① 的 not_joined）
         走通用错误出口 —— 两者 reason 不同，前端按 reason 分支，别合并。
    """
    data = payload or {}
    try:
        token = service.normalize_token(data.get("room_token") or data.get("token"))
        session, all_done = service.record_rating(
            token, data.get("guest_id"), data.get("target_id"), data.get("score")
        )
        member = _member_from(session["room_token"], data.get("guest_id"))
        snapshot = service.player_snapshot(session, member)
        _broadcast_progress(session)
        if all_done:
            # 所有人都评完了：结果自己开，不用等主持人点「揭晓」。
            revealed, changed = service.reveal_results(session["room_token"])
            if changed:
                _broadcast_state(revealed)
        return json_response({"status": "success", "session": snapshot})
    except Exception as exc:
        if isinstance(exc, service.MirrorError) and exc.reason in ("not_open", "not_in_roster"):
            return json_response(
                {"status": "error", "reason": exc.reason, "message": str(exc)}, exc.status_code
            )
        return _event_error(exc)


# ════════════════════════════════════════════════════════════════════
#                  三、RealtimeApp 规约（SSE 的那一半）
# ════════════════════════════════════════════════════════════════════
#
# 端点不在本文件里：core.realtime.make_realtime_router 统一提供
#     GET {BASE}/mirror/realtime?room={token}&as={guest_id}
# 本文件只注册这个模块的 4 个回调。``as`` 是匿名 guest 的身份（在客户端的
# localStorage 里，不在 user 里），主持台**不带** as。
#
# 首帧就是原来 ``mirror:host:join`` / ``mirror:guest:join`` 里那次
# ``emit(..., to=request.sid)``：订上就推一份 snapshot，不用再发一条 POST。


def _rt_authorize(room_id, user, params):
    """谁能订这个房间：token 本身就是凭证，不看登录态。

    现场观众全是未登录的，Socket.IO 时代也是「谁知道 token 谁就能 join_room」，
    主持人和参与者在订阅这一层不做区分（改状态的动作才查登录，见 _require_user）。
    """
    try:
        token = service.normalize_token(room_id)
    except service.MirrorError:
        # ⚠️ 必须吞掉：authorize 里抛异常会变成 500，而非法 room_id 只是
        #    「这个房间不给订」，返回 False 让 realtime 静默剔除它。
        return False
    if token != room_id:
        # ★ 房间名必须**已经是**规范化后的 token。normalize_token 会顺手 lower()，
        #   所以 ?room=ABC 能通过校验 —— 但 realtime 拿 "ABC" 当房间键订阅，
        #   而广播用的是 session["room_token"]（"abc"），两边对不上，
        #   客户端会安安静静地一条推送都收不到。不如当场拒掉。
        return False
    return service.get_session(token) is not None


def _rt_snapshot(room_id, user, params):
    """首帧。主持台给 host_snapshot，参与者给**他自己那一份** player_snapshot。

    ★ 用 get_session 判空而不是直接上 require_session：后者会抛 MirrorError，
      而 snapshot 回调抛异常 = 整条 SSE 连接建不起来。房间刚好过期时应该是
      「没有首帧」（返回 None），不是 500。
    ★ 带了 ?as= 但这个人还没 join（还在输名字）时，player_snapshot(session, None)
      会回一份 ``me: null`` 的快照：标题、阶段、人数都有，就是没有「我」。
      这比返回 None 有用 —— 前端据此画报名表单。原 guest:sync 在这种情况下是
      409 not_joined，但首帧没有「报错」这个选项（抛了就没连接了）。
    """
    session = service.get_session(room_id)
    if not session:
        return None
    guest_id = params.get("as")
    if not str(guest_id or "").strip():
        return service.host_snapshot(session)
    return service.player_snapshot(session, _lookup_member(session["room_token"], guest_id))


def _rt_on_connect(conn):
    """SSE 建起来时把这条连接挂到成员身上：标回在线 + 登记 connection_id。

    原来这件事由 ``mirror:guest:join`` 里的 ``add_member(..., sid=request.sid)``
    顺带做掉（Socket.IO 的 join 和连接是同一件事）；SSE 拆成了两个请求，
    所以要在这里补一次，否则 sid_map 里是上一条连接的 id，
    on_disconnect 找不到人，主持台的在线小点就只亮不灭。

    ★ 主持台不带 ?as=，直接返回 —— 主持人不是成员，不进名单、不计人数。
    ★ attach_connection **不会创建成员**：没 join 过的人（没名字）返回 None，
      这里就什么也不做，不广播。
    """
    guest_id = conn.params.get("as")
    if not str(guest_id or "").strip():
        return
    for room_id in conn.rooms:
        if service.attach_connection(room_id, guest_id, conn.id) is None:
            continue
        session = service.get_session(room_id)
        if session:
            # 让主持台看到他（又）上线了。广播的是标准那份 progress，
            # 与 guest:join 走同一条路。
            _broadcast_progress(session)


def _rt_on_disconnect(conn):
    """断连清理。原 app/socket_events.py 里 handle_disconnect 的 mirror 那一段。

    ⚠️ payload 和 _broadcast_progress 的**不一样**：原代码在这里只发了
       members + member_count，没有 finished_count / roster_count。
       前端的 mirror:progress 处理是往已有 snapshot 上合并（缺的键保持原值），
       所以少发不会出错。逐字照搬，别「顺手补齐」—— 补齐意味着这条路径上
       多算一遍全员的 finished，而这是断线时每个人都会走一次的路。

    ⚠️ 原代码调了**两次** member_list（一次当 members、一次取 len 当 member_count），
       照搬。两次之间有人进出的话两个字段会对不上 —— 那是原行为，
       合并成一次算是顺手改行为，不在这次迁移里做。

    ⚠️ SSE 的「断开」比 Socket.IO 迟钝：客户端崩溃或手机锁屏要等到下一次心跳
       写失败才发现（最坏十几秒，经 nginx 可能更久）。在线状态的正路是
       members 这张 hash 上的 MIRROR_TTL_SECONDS 自己过期，这里只是兜底。
       外层 core.realtime._spawn_cleanup 已经把异常兜住并记日志了
       （原来那句 print("⚠️ Mirror presence cleanup error:") 的位置），这里不重复包 try。
    """
    token = service.mark_offline_by_sid(conn.id)
    if not token:
        return
    publish_sync(
        _REALTIME_APP,
        token,
        "mirror:progress",
        {
            "members": service.member_list(token),
            "member_count": len(service.member_list(token)),
        },
    )


register(
    RealtimeApp(
        name=_REALTIME_APP,
        authorize=_rt_authorize,
        snapshot=_rt_snapshot,
        on_connect=_rt_on_connect,
        on_disconnect=_rt_on_disconnect,
    )
)
