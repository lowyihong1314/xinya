"""YLP 订单公开链接：CRM 生成 30 天有效的只读 token（存 Redis），
客户凭 /#/ylp-shared?token=xxx 查看订单与牌位预览，无需登录。
"""
from __future__ import annotations

import secrets

from flask import session

from app.redis_client import redis_client

SHARE_LINK_TTL_SECONDS = 30 * 24 * 3600  # 30 天


def _token_key(token: str) -> str:
    return f"ylp:share:token:{token}"


def _order_key(order_id: int) -> str:
    return f"ylp:share:order:{order_id}"


def get_or_create_share_token(order_id: int) -> tuple[str, int]:
    """已有未过期链接则复用（返回剩余秒数），否则注册一个新的。"""
    existing = redis_client.get(_order_key(order_id))
    if existing:
        ttl = redis_client.ttl(_token_key(existing))
        if isinstance(ttl, int) and ttl > 0:
            return existing, ttl

    token = secrets.token_urlsafe(24)
    redis_client.setex(_token_key(token), SHARE_LINK_TTL_SECONDS, str(order_id))
    redis_client.setex(_order_key(order_id), SHARE_LINK_TTL_SECONDS, token)
    return token, SHARE_LINK_TTL_SECONDS


def resolve_share_token(token: str | None) -> int | None:
    if not token:
        return None
    value = redis_client.get(_token_key(str(token).strip()))
    try:
        return int(value) if value else None
    except (TypeError, ValueError):
        return None


def grant_session_phone(phone: str | None) -> None:
    """token 有效后把订单手机号写进 session 的已验证列表，
    让详情 / 牌位预览等接口按「手机号主人」放行（与短信验证同一机制）。"""
    normalized = (phone or "").strip()
    if not normalized:
        return
    verified = session.get("verified_phones", [])
    if not isinstance(verified, list):
        verified = []
    if normalized not in verified:
        verified.append(normalized)
        session["verified_phones"] = verified
