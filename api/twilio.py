"""Twilio OTP 路由（FastAPI 版，取代 app/twilio/routes.py 的 Flask Blueprint）。

这里只做三件事：参数提取、会话字典的读写、把 Flask 风格的 ``(响应, 状态码)``
元组还原成一个 Response。发短信/校验/限流的逻辑一个字没动，仍在
app/twilio/services.py 与 app/twilio/rate_limit.py 里。

六条路由**全部不需要登录** —— 这是 OTP 的本意：用户就是还没有身份才来验手机号。
原来的 Blueprint 上也没有任何 @login_required / @permission_required，照搬。

★ 为什么路由一律写 def 而不是 async def
  services 里是同步的 twilio SDK（底层 requests）和同步 redis-py。写成 async 会把这些
  阻塞调用直接压在事件循环上 —— 一次慢的 Twilio 请求就能让整个 worker 上所有连接
  一起卡住，而日志上什么都看不出来。写 def，FastAPI 会自动丢进线程池。
  本文件唯一的 async 是下面那个读请求体的依赖：它只 await 请求体，不碰阻塞 IO；
  依赖是 async、路由是 def 的组合完全合法，路由照样在线程池里跑。

★ 会话（session）怎么处理
  Flask 的 session 是「读写同一个代理对象，响应时框架自动回写 Cookie」。
  FastAPI 没有这层，core/auth.py 只给了只读的 read_session()。
  所以这里的做法是：进路由取出会话字典 → 交给 services 随便改 → 出路由时和进来时的
  快照比一比，**变了才**重签一份 Cookie 写回去。
  「变了才写」不能省：无条件写的话，匿名用户只是 GET 一下 debug_session 也会收到一个
  空会话 Cookie，此后每个请求都要多走一遍认证那条路（见 core/auth.py::_has_credentials）。
"""

from __future__ import annotations

import copy
import json

from fastapi import APIRouter, Depends, Form, Request
from starlette.responses import Response

from app.twilio import services
from core.config import settings

# ⚠️ 这里从 core.auth 借了两个下划线开头的私有函数（_set_cookie / _session_max_age）。
#    宁可依赖私有名字，也不要在本文件里复制一份 Secure / HttpOnly / SameSite / Path /
#    max_age 的取值规则 —— 复制出来的那份迟早和 core/auth.py 漂移，而漂移的症状是
#    「某些浏览器上验证过的手机号第二天就没了」这种查不动的问题。
#    core/auth.py 哪天愿意对外暴露一个 write_session(response, data)，这三行就能换掉。
from core.auth import (
    SESSION_COOKIE_NAME,
    _session_max_age,
    _set_cookie,
    dump_session_cookie,
    read_session,
)

# 前缀：原来是 API_PREFIX("/api") + "/twilio"，现在 settings.api_prefix 是空串
# （11 文档 §2：BASE_PATH 已经区分了项目，再套一层 /api 不带信息量），
# 所以对外就是 /twilio/*。写成拼接而不是写死 "/twilio"，是为了哪天要把 /api 加回来时
# 只改配置中心一处，不用回来翻每个模块。
router = APIRouter(prefix=f"{settings.api_prefix}/twilio", tags=["twilio"])


# ─────────────────────────── 请求体 / 客户端 IP ───────────────────────────


def _is_json_request(request: Request) -> bool:
    """与 Flask 的 ``request.is_json`` 逐字等价（mimetype 是 application/json 或 */*+json）。"""
    mimetype = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    return mimetype == "application/json" or (
        mimetype.startswith("application/") and mimetype.endswith("+json")
    )


async def silent_json(request: Request) -> dict:
    """等价于 Flask 的 ``request.get_json(silent=True) or {}``。

    为什么不用 pydantic 模型接：模型在 body 坏掉/不是 JSON 时会变成 422，
    而原来这两条路由是「解不出就当空字典」，继续往下走并返回 400「验证码或手机号缺失」。
    前端是按 message 文案分支的，422 会让错误提示变成空白。

    content-type 的判断也照抄 Flask：非 JSON 的 mimetype 直接当空字典，
    不顺手改成「有什么解什么」—— 那会让原本该 400 的请求突然成功，属于行为变更。
    """
    if not _is_json_request(request):
        return {}
    try:
        raw = await request.body()
    except Exception:
        return {}
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return {}
    # Flask 里 get_json() 解出数组/字符串时，后面的 .get() 会抛 AttributeError；
    # 这里统一收敛成空字典，效果与「缺参数」一致。
    return data if isinstance(data, dict) else {}


def _client_ip(request: Request):
    """照搬原 services.get_remote_ip()：优先 X-Forwarded-For 的第一段，否则对端地址。

    ★ 不直接用 request.client.host。ProxyHeadersMiddleware 只在可信回环代理上才改写
      client，而这里要的是「限流按哪个 IP 计数」—— 取法一变，线上已有的
      sms_send_attempts:<ip> 计数桶就整批对不上号，等于限流被静默重置。
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    client = request.client
    return client.host if client else None


# ─────────────────────────── 会话读写 ───────────────────────────


def _open_session(request: Request):
    """取出本请求的会话字典，并留一份深拷贝快照用于出口比对。

    深拷贝不能省成 dict(...) 浅拷贝：services._mark_phone_verified 是就地 append
    verified_phones 那个列表，浅拷贝里存的是**同一个列表对象**，比出来永远「没变」——
    症状是验证明明成功了、Cookie 却没写回去，用户下次进来还得再验一次。
    """
    session = read_session(request)
    try:
        snapshot = copy.deepcopy(session)
    except Exception:
        # 拷不动（理论上不会，会话里都是 JSON 原生类型）就当它一定变了：
        # 多写一次 Cookie 无害，漏写一次是丢数据。
        snapshot = None
    return session, snapshot


def _as_response(result) -> Response:
    """把 services 里 Flask 风格的返回值收成一个 Response。

    services 保留了 ``return jsonify(...), 400`` 这种写法（迁移期不重构业务代码），
    而 FastAPI 不认元组。core.responses.jsonify 返回的已经是 Response 对象，
    所以这里只补一个状态码 —— 响应体一个字节都不动，前端的分支逻辑照旧。
    """
    if isinstance(result, tuple):
        response, status_code = result
        response.status_code = int(status_code)
        return response
    return result


def _finish(session: dict, snapshot, result) -> Response:
    """出口：拼响应 +（会话变了的话）把整份会话重签回 Cookie。

    整份重签而不是「只写 phone 这一个键」：会话 Cookie 是一个签名整体，拆不开；
    Flask 的 save_session 也是整份写，所以这里和原来一致 —— 顺带保住了同一个会话里
    的登录态（clear_phone_session 只 pop 掉 phone，_user_id 还在，用户不会被登出）。

    ⚠️ 一处有意识的差异：Flask 对非 permanent 的会话发的是「关浏览器就没」的 Cookie，
      这里一律带 max_age（=7 天）。因为 core/auth.py 的滑动续期本来就是这么写回每个
      响应的，两边行为不一致反而更难查。对 OTP 来说，后果只是「手机号记得更久」。
    """
    response = _as_response(result)
    if snapshot is not None and session == snapshot:
        # 会话没动：交给 AuthContextMiddleware 去做常规的滑动续期，这里不插手。
        return response
    _set_cookie(response, SESSION_COOKIE_NAME, dump_session_cookie(session), _session_max_age())
    # 下发了 Set-Cookie 就必须声明 Vary: Cookie，否则中间任何一层缓存都可能把甲的
    # Set-Cookie 连着响应喂给乙 —— 那是串号，不是掉线。
    # 这里得自己加：中间件发现响应里已经有会话 Cookie 就整段跳过，连 Vary 也不会补。
    if "cookie" not in (response.headers.get("vary") or "").lower():
        response.headers.append("vary", "Cookie")
    return response


# ─────────────────────────── 路由 ───────────────────────────


@router.post("/send_otp")
def send_otp(
    request: Request,
    phone: str | None = Form(None),
    channel: str = Form("sms"),
) -> Response:
    """发验证码。旧：POST /api/twilio/send_otp。无需登录。

    参数走 form-data：前端 frontend/src/js/get_phone_on_localhost.tsx 用的是 FormData，
    改成 JSON 会让所有旧页面一起坏掉。
    两个字段都给默认值而不是必填 —— Flask 的 request.form.get 拿不到时是 None，
    services 里自有分支（phone 为 None 时会撞上「session 里也没有 phone」而返回
    cookie_true，这是原有行为，不在本次迁移里改）；改成必填会把同一种坏请求
    从 200/400 变成 422，前端读不到 message。
    """
    session, snapshot = _open_session(request)
    result = services.send_otp(phone, channel, ip=_client_ip(request), session=session)
    return _finish(session, snapshot, result)


@router.post("/verify")
def verify_otp(request: Request, data: dict = Depends(silent_json)) -> Response:
    """校验验证码。旧：POST /api/twilio/verify。无需登录。

    phone 缺省回落到会话里的 phone —— 与原来 ``data.get("phone") or session.get("phone")``
    逐字一致（注意是 or 不是 if-in：空字符串也会回落）。
    """
    session, snapshot = _open_session(request)
    result = services.verify_otp(
        data.get("otp"),
        data.get("phone") or session.get("phone"),
        ip=_client_ip(request),
        session=session,
    )
    return _finish(session, snapshot, result)


@router.get("/debug_session")
def debug_session(request: Request) -> Response:
    """把整个会话字典吐出来。旧：GET /api/twilio/debug_session。无需登录。

    只读，不会写回 Cookie。
    TODO(迁移遗留)：这条路由对任何人无条件吐出 _user_id、_id 指纹和全部会话内容，
    既没鉴权也没开关。本次只搬不改；要收口的话应当加 login_required 或直接删掉，
    删之前先确认没有运维脚本在打它。
    """
    return _as_response(services.debug_session(read_session(request)))


@router.get("/test_send_otp")
def test_send_otp(request: Request, phone: str | None = Form(None)) -> Response:
    """测试模式：假装发出去。旧：GET /api/twilio/test_send_otp。无需登录。

    ⚠️ 方法是 GET，参数却取自 request.form —— 这是原来就有的写法，意味着 phone
      **几乎永远是 None**（GET 通常没有表单体）。照搬不改：改成 query 参数会让
      「phone 恒为 None」这个既有行为突然变了，而这条路由本来就只在联调时用。
      TODO(迁移遗留)：要修的话是把它改成 query 参数或直接删掉。
    """
    session, snapshot = _open_session(request)
    return _finish(session, snapshot, services.test_send_otp(phone, session=session))


@router.post("/test_verify")
def test_verify_otp(request: Request, data: dict = Depends(silent_json)) -> Response:
    """测试模式：万能码 8888。旧：POST /api/twilio/test_verify。无需登录。"""
    session, snapshot = _open_session(request)
    return _finish(session, snapshot, services.test_verify_otp(data.get("otp"), session=session))


@router.post("/clear_phone_session")
def clear_phone_session(request: Request) -> Response:
    """清掉会话里的手机号。旧：POST /api/twilio/clear_phone_session。无需登录。

    只 pop phone 一个键，登录态（_user_id / verified_phones）原样保留 —— 与原来一致。
    """
    session, snapshot = _open_session(request)
    return _finish(session, snapshot, services.clear_phone_session(session))


# asgi.py 里：app.include_router(twilio.router)
#   from api import twilio
