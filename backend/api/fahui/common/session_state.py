"""法会各流程共用的会话（session）读写。

原 backend/app/fahui/common/session_state.py。Flask 那边 ``session`` 是一个
「读写同一个代理对象、响应时框架自动把它签回 Cookie」的全局；FastAPI 没有这层，
core/auth.py 只给了只读的 ``read_session(request)``。所以本文件补两件事：

  · **读**：``session_data()`` 取出本请求的会话字典。``read_session`` 会把结果
    缓存在 ``request.state`` 上，所以同一次请求里拿到的**始终是同一个 dict 对象**
    —— 这一点是下面「写」能成立的前提。
  · **写**：``open_session()`` 取字典 + 深拷贝快照，路由出口处 ``persist_session()``
    比一比，**变了才**重签一份 Cookie 写回去。做法与 api/twilio/router.py 一致
    （那是本项目第一处这么干的地方，两边的注意事项也一样）。

「变了才写」不能省：无条件写的话，匿名访客随便 GET 一下也会收到一个空会话 Cookie，
此后每个请求都要多走一遍认证那条路（见 core/auth.py::_has_credentials）。

★ 本包只有两处**写**会话：
    ylp/share_link.py::grant_session_phone   （公开链接 token 有效 → 记下订单手机号）
    ylp/board_terminal.py::grant_terminal_session（终端 token 有效 → 打个只读标）
  两处都发生在未登录访客的请求里，AuthContextMiddleware 的滑动续期对它们
  **不起作用**（那段要求请求本身带了 Cookie 头，而这些访客一个 Cookie 都没有），
  所以必须由路由自己调 persist_session 收尾。

⚠️ 一处有意识的差异，与 twilio 那边相同：Flask 对非 permanent 的会话发的是
   「关浏览器就没」的 Cookie，这里一律带 max_age（=7 天）。理由是 core/auth.py
   的滑动续期本来就是这么写回每个响应的，两边不一致反而更难查。对法会来说，
   后果只是「验证过的手机号 / 终端标记记得更久」。
"""

import copy

# ⚠️ 这里从 core.auth 借了两个下划线开头的私有函数（_set_cookie / _session_max_age）。
#    宁可依赖私有名字，也不要在本文件里复制一份 Secure / HttpOnly / SameSite / Path /
#    max_age 的取值规则 —— 复制出来的那份迟早和 core/auth.py 漂移，而漂移的症状是
#    「分享链接打开当场能看，刷新一次又要重新验证」这种查不动的问题。
#    core/auth.py 哪天对外暴露一个 write_session(response, data)，这几行就能换掉。
#    （api/twilio/router.py 也是这么借的，两处一起改。）
from backend.core.auth import (
    SESSION_COOKIE_NAME,
    _session_max_age,
    _set_cookie,
    current_request,
    dump_session_cookie,
    read_session,
)


def has_request_context() -> bool:
    """等价 Flask 的 ``has_request_context()``。

    ContextVar 由 AuthContextMiddleware 在 async 侧 set，同步路由跑在线程池里
    （拿到的是 context 的拷贝）照样读得到。后台线程 / CLI 里是 None —— 那正是
    order_log._actor() 要的「不在请求里就别去翻 session」。
    """
    return current_request() is not None


def session_data() -> dict:
    """本请求的会话字典。不在请求上下文里返回空字典（只读用，不要往里写）。"""
    request = current_request()
    if request is None:
        return {}
    return read_session(request)


def current_session_phone() -> str | None:
    if not has_request_context():
        return None
    value = session_data().get("phone")
    return str(value).strip() if value else None


def current_verified_phones() -> set[str]:
    if not has_request_context():
        return set()
    values = session_data().get("verified_phones", [])
    if not isinstance(values, list):
        return set()
    return {str(item).strip() for item in values if item}


# ─────────────────────────── 写回 ───────────────────────────


def open_session():
    """取出本请求的会话字典，并留一份深拷贝快照用于出口比对。

    深拷贝不能省成 ``dict(...)`` 浅拷贝：grant_session_phone 是**就地 append**
    verified_phones 那个列表，浅拷贝里存的是同一个列表对象，比出来永远「没变」——
    症状是 token 明明有效、Cookie 却没写回去，访客点开分享链接看得到订单，
    一刷新又变成「请先完成手机验证」。
    """
    session = session_data()
    try:
        snapshot = copy.deepcopy(session)
    except Exception:  # noqa: BLE001
        # 拷不动（理论上不会，会话里都是 JSON 原生类型）就当它一定变了：
        # 多写一次 Cookie 无害，漏写一次是丢数据。
        snapshot = None
    return session, snapshot


def persist_session(response, session, snapshot):
    """出口：会话变了就把**整份**会话重签回 Cookie。返回传进来的 response。

    整份重签而不是「只写 verified_phones 这一个键」：会话 Cookie 是一个签名整体，
    拆不开；Flask 的 save_session 也是整份写，所以这里和原来一致 ——
    顺带保住了同一个会话里的登录态（管理员点自己生成的分享链接不会被登出）。
    """
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
