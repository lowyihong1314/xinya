"""看板终端链接：每个 CRM 用户在 Redis 注册一个 token（30 天），
终端页（第二显示器，无 topbar）凭 /#/ylp-board-terminal?token=xxx 只读展示大板，
并通过实时房间接收该用户在 CRM 查板时的「点亮牌位」联动。

原 backend/app/fahui/YLP/board_terminal.py。Redis 那部分一个字没动；
会话的来源从 ``flask.session`` 换成 common/session_state.py 的 ``session_data()``。

★ ``terminal_room(user_id)`` 返回的 ``fahui:board-terminal:{user_id}`` 现在是
  core.realtime 的 **room_id**（频道 ``rt:fahui_board:fahui:board-terminal:{id}``）。
  原样保留这个带冒号的字符串，不是疏忽：core/realtime.py 的 RealtimeApp 文档里
  点名了这个房间（未登录终端凭 Redis token 进入，authorize 从 params["token"] 解析），
  前端订阅时也会原样带上它。

⚠️ ``grant_terminal_session`` 是**就地改**会话字典，本身不写 Cookie。调用它的路由
  （ylp/board_routes.py 的 ``/terminal/boards``）必须在出口调 ``persist_session``。
"""

import secrets

from backend.core.redis import redis_client

from ..common.session_state import session_data

TERMINAL_TTL_SECONDS = 30 * 24 * 3600  # 30 天

_SESSION_FLAG = "ylp_board_terminal"


def _token_key(token: str) -> str:
    return f"ylp:board-terminal:token:{token}"


def _user_key(user_id: int) -> str:
    return f"ylp:board-terminal:user:{user_id}"


def terminal_room(user_id: int) -> str:
    return f"fahui:board-terminal:{user_id}"


def get_or_create_terminal_token(user_id: int) -> tuple[str, int]:
    """一个用户一个 token：已有未过期的直接复用（返回剩余秒数）。"""
    existing = redis_client.get(_user_key(user_id))
    if existing:
        ttl = redis_client.ttl(_token_key(existing))
        if isinstance(ttl, int) and ttl > 0:
            return existing, ttl

    token = secrets.token_urlsafe(24)
    redis_client.setex(_token_key(token), TERMINAL_TTL_SECONDS, str(user_id))
    redis_client.setex(_user_key(user_id), TERMINAL_TTL_SECONDS, token)
    return token, TERMINAL_TTL_SECONDS


def resolve_terminal_token(token: str | None) -> int | None:
    if not token:
        return None
    value = redis_client.get(_token_key(str(token).strip()))
    try:
        return int(value) if value else None
    except (TypeError, ValueError):
        return None


def grant_terminal_session() -> None:
    """token 验证通过后给 session 打标，牌位预览图等只读资源按此放行。"""
    session_data()[_SESSION_FLAG] = True


def terminal_session_granted() -> bool:
    return bool(session_data().get(_SESSION_FLAG))
