"""APK 的登录命脉：Bearer 令牌的签发 / 刷新 / 吊销。

搬自 ``app/mobile/routes.py``（Flask Blueprint），业务逻辑一律回调
``app/mobile/session_service.py`` —— 那份没有抄，只改了取 SECRET_KEY 的方式。

★ 这个模块坏了 = 所有安卓用户登不进来，所以有三条不许动的约定：

1. **令牌的序列化参数与会话 Cookie 是两套，不能合并。**
   Bearer：盐 ``xinya-mobile-session`` + itsdangerous 默认序列化器（见 session_service）。
   会话 Cookie：盐 ``cookie-session`` + Flask 的 TaggedJSON（见 core/auth.py）。
   core/auth.py 的 ``load_user_from_bearer`` 只负责取 Authorization 头，
   校验整个回调 ``session_service.load_user_from_access_token`` —— 也就是说
   **签发端（本文件）与校验端（core/auth.py）共用同一份 session_service**，
   天然对得上；谁要是在这里自己拼一份序列化器，两边立刻错开。

2. **``/session/login`` 同时下发 Bearer 令牌和会话 Cookie。**
   原实现是 ``login_user(user, remember=True, duration=7天)``，APK 的 WebView 里
   那些走 Cookie 的老接口全靠它。少了这一步，APK 能拿到 token 却打不开任何页面。

3. **响应体形状保持原样**：成功是 ``{"success": true, ...}``、
   失败是 ``{"error": "中文"}``（不是统一信封的 ``{"error": {...}}``）。
   前端 frontend/src/mobile/native/mobileSession.ts 读的就是 ``result.error``，
   换成新信封会让所有登录失败都弹一句 "[object Object]"。
"""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, Request
from starlette.responses import Response

from app.mobile.session_service import (
    create_mobile_session,
    refresh_mobile_session,
    revoke_all_mobile_sessions_for_user,
    revoke_mobile_access_token,
    revoke_mobile_refresh_token,
)
from core.auth import current_user, login_required, set_login_cookies
from core.config import settings
from core.responses import json_response
from models.user_data import User

# 前缀跟着 asgi.py 里 make_realtime_router 的写法走：api_prefix 现在是空串
# （BASE_PATH 已经区分了项目，再套一层 /api 不带信息量），所以实际路径是 /mobile/...。
# 留着这个配置项是为了需要时还能把 /api 加回来，两处写法一致才不会只改一半。
router = APIRouter(prefix=f"{settings.api_prefix}/mobile", tags=["mobile"])


# ─────────────────────────── 参数提取 ───────────────────────────


async def _json_payload(request: Request) -> dict:
    """替掉 Flask 的 ``request.get_json(silent=True) or {}``。

    写成 async 依赖而不是 pydantic 模型，是为了保住 ``silent=True`` 的语义：
    上 pydantic 的话，APK 发来一个空 body 或者半截 JSON 会变成 422，
    而原来是「当成空字典往下走」，最终返回 400 + 中文文案。APK 那边只认 400/401 的
    ``error`` 字段，422 的形状它读不出来，表现是「点登录没反应」。

    与 Flask 的两处细微差异（都只在畸形输入上出现，属于放宽）：
      · Flask 要求 Content-Type 是 application/json，否则直接返回 None；这里不挑。
      · body 是 JSON 数组时 Flask 会让下游 ``.get()`` 抛 AttributeError → 500，
        这里统一当成空字典。
    """
    try:
        data = await request.json()
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _client_metadata(request: Request, data=None) -> dict:
    """设备信息三件套。原来在 routes.py 里读 ``request.user_agent.string``，
    现在从路由层拿 header —— 请求对象不再是「随处可取的全局」。

    werkzeug 的 ``user_agent.string`` 在没有 UA 头时是空串（不是 None），
    而 session_service._trim 会把空串收敛成 None，所以这里补一个 ``or ""`` 对齐。
    """
    payload = data or {}
    return {
        "device_id": payload.get("device_id") or payload.get("deviceId"),
        "platform": payload.get("platform"),
        "user_agent": (
            payload.get("user_agent")
            or payload.get("userAgent")
            or (request.headers.get("user-agent") or "")
        ),
    }


def _authorization_token(request: Request):
    """从 Authorization 头里取 Bearer 令牌；不是 Bearer 或者空的返回 None。

    ⚠️ 这里**故意**不复用 core/auth.py 的解析：那边取到 token 之后会立刻去校验、
    过期就返回 None，而登出需要的恰恰是「哪怕过期了也要把这条会话吊销掉」
    （revoke_mobile_access_token 走的是 enforce_age=False）。
    """
    header = (request.headers.get("authorization") or "").strip()
    if not header.lower().startswith("bearer "):
        return None
    token = header[7:].strip()
    return token or None


# ─────────────────────────── 路由 ───────────────────────────


@router.post("/session/login")
def mobile_login(request: Request, data: dict = Depends(_json_payload)) -> Response:
    """APK 用账号密码换一对令牌，同时把会话 Cookie 也种上。

    原实现：``session.permanent = True`` → ``login_user(user, remember=True,
    duration=7天)`` → ``session["login_version"] = user.login_version``。
    这三步现在合并成 core/auth.py 的 ``set_login_cookies``（它内部写的会话字典里
    已经含 login_version，形状与 Flask 时代一致）。

    ⚠️ Cookie 必须写在**要返回的那个 Response 对象**上 —— FastAPI 里没有
    「先改全局 session、框架最后替你发出去」这回事，忘了这一步的症状是
    「登录接口 200、token 也拿到了，但 WebView 里每个页面都 401」。
    """
    username = str(data.get("username") or "").strip()
    password = data.get("password")
    if not username or not password:
        return json_response({"error": "用户名和密码不能为空"}, status_code=400)

    user = User.query.filter_by(username=username).first()
    if not user or not user.check_password(password):
        return json_response({"error": "用户名或密码错误"}, status_code=401)

    payload = create_mobile_session(user, **_client_metadata(request, data))
    response = json_response({"success": True, **payload})
    # duration 显式传 7 天：原实现写死在 login_user 里，虽然今天
    # REMEMBER_COOKIE_DAYS 也是 7，但不传就变成「跟着配置走」，算行为变更。
    set_login_cookies(response, user, remember=True, duration=timedelta(days=7))
    return response


@router.post("/session/exchange")
@login_required
def exchange_mobile_session(
    request: Request, data: dict = Depends(_json_payload)
) -> Response:
    """已经用 Cookie 登录过的 WebView，换一对 Bearer 令牌给原生层用。

    这条是「网页已登录 → APK 原生侧也登录」的唯一桥：APK 启动时先用 Cookie 拉用户，
    拿到了再调它同步 token（见 mobileSession.ts 的 ensureMobileSession）。
    """
    payload = create_mobile_session(current_user, **_client_metadata(request, data))
    return json_response({"success": True, **payload})


@router.post("/session/refresh")
def refresh_session(request: Request, data: dict = Depends(_json_payload)) -> Response:
    """用 refresh_token 换一对新令牌（旧的当场作废，轮换式刷新）。

    ★ 这条**不能**加登录校验：access_token 过期（30 分钟）之后 APK 就是靠它回血的，
    此时请求里既没有有效 Bearer 也可能没有 Cookie。
    刷新失败一律 401 —— 前端把 401 当成「该重新登录了」。
    """
    refresh_token = data.get("refresh_token") or data.get("refreshToken")
    if not refresh_token:
        return json_response({"error": "refresh_token is required"}, status_code=400)

    try:
        payload = refresh_mobile_session(refresh_token, **_client_metadata(request, data))
        return json_response({"success": True, **payload})
    except ValueError as exc:
        # session_service 用 ValueError 表达全部失败原因（无效 / 已吊销 / 过期 /
        # 改过密码），文案原样透出去 —— 前端在日志里靠它区分。
        return json_response({"error": str(exc)}, status_code=401)


@router.get("/session/me")
@login_required
def current_mobile_user() -> Response:
    """当前登录用户。身份可以来自 Bearer，也可以来自会话 Cookie（core/auth.py 都认）。"""
    return json_response({"success": True, "user": current_user.to_dict()})


@router.api_route("/session/logout", methods=["DELETE", "POST"])
def logout_mobile_session(
    request: Request, data: dict = Depends(_json_payload)
) -> Response:
    """吊销一条移动端会话。

    ★ 原实现没有 ``@login_required``，这里也不能加：APK 登出时 access_token 很可能
    已经过期，要是先卡一道登录校验，那条会话就永远吊销不掉（成了永久有效的 refresh_token）。
    安全性由令牌本身兜底 —— 拿得出 refresh_token / access_token 才吊销得了对应的会话。

    两种方法都收：前端用 DELETE，老版本 APK 里还有 POST 的写法。
    """
    revoked = False
    refresh_token = data.get("refresh_token") or data.get("refreshToken")
    if refresh_token:
        revoked = revoke_mobile_refresh_token(refresh_token) or revoked

    access_token = _authorization_token(request)
    if access_token:
        revoked = revoke_mobile_access_token(access_token) or revoked

    # 注意这条的形状是 {"status": "success"} 而不是 {"success": true}，
    # 与同文件其它接口不一致 —— 是既有行为，不要「顺手统一」。
    return json_response({"status": "success", "revoked": revoked})


@router.api_route("/session/logout_all", methods=["DELETE", "POST"])
@login_required
def logout_all_mobile_sessions() -> Response:
    """把当前用户所有设备上的移动端会话一次性吊销（换手机 / 怀疑被盗号时用）。

    这条要求已登录：它按 user_id 批量吊销，不校验身份就等于任何人都能把别人踢下线。
    """
    revoke_all_mobile_sessions_for_user(current_user)
    return json_response({"status": "success"})


# asgi.py 里：
#     from api import mobile
#     app.include_router(mobile.router)
# ⚠️ 必须挂在 AuthContextMiddleware 之下（asgi.py 现有装配顺序已满足）：
#    /session/me 与 /session/exchange 靠 current_user，身份是中间件解析好的。
