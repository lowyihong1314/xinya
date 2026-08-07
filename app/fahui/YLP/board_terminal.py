"""看板终端链接：每个 CRM 用户在 Redis 注册一个 token（30 天），
终端页（第二显示器，无 topbar）凭 /#/ylp-board-terminal?token=xxx 只读展示大板，
并通过 socket 房间接收该用户在 CRM 查板时的「点亮牌位」联动。
"""
from __future__ import annotations

import secrets

from flask import session

from app.redis_client import redis_client

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
    session[_SESSION_FLAG] = True


def terminal_session_granted() -> bool:
    return bool(session.get(_SESSION_FLAG))
