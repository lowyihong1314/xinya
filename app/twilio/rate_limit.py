"""OTP 限流：IP 与手机号两层各自计数（Redis，滑动到期 1 小时）。

一个出口 IP 每小时 100 次、单个手机号每小时 10 次 —— 法会现场大家连同一个 WiFi 时
不会互相挤掉（约容得下 10 个号码各试 10 次），同时单号被刷也挡得住。
"""
from flask import jsonify

from app.redis_client import redis_client


IP_RATE_LIMIT = 100
PHONE_RATE_LIMIT = 10
RATE_LIMIT_TTL = 3600

# 兼容旧引用
RATE_LIMIT = IP_RATE_LIMIT


def _normalize_phone(phone) -> str:
    return "".join(ch for ch in str(phone or "") if ch.isdigit() or ch == "+")


def _send_keys(ip, phone):
    keys = [(f"sms_send_attempts:{ip}", IP_RATE_LIMIT, "该 IP 请求验证码过于频繁，请 1 小时后再试")]
    normalized = _normalize_phone(phone)
    if normalized:
        keys.append(
            (f"sms_send_attempts_phone:{normalized}", PHONE_RATE_LIMIT, "该号码请求验证码过于频繁，请 1 小时后再试")
        )
    return keys


def _verify_keys(ip, phone):
    keys = [(f"verify_attempts:{ip}", IP_RATE_LIMIT, "该 IP 提交次数已达上限，请 1 小时后再试")]
    normalized = _normalize_phone(phone)
    if normalized:
        keys.append(
            (f"verify_attempts_phone:{normalized}", PHONE_RATE_LIMIT, "该号码提交次数已达上限，请 1 小时后再试")
        )
    return keys


def _current(key) -> int:
    value = redis_client.get(key)
    try:
        return int(value) if value else 0
    except (TypeError, ValueError):
        return 0


def _bump(key) -> None:
    pipe = redis_client.pipeline()
    pipe.incr(key)
    pipe.ttl(key)
    _, ttl = pipe.execute()
    if ttl == -1:
        redis_client.expire(key, RATE_LIMIT_TTL)


def _exceeded(buckets):
    """返回第一个超限桶的提示文案，没超返回 None。"""
    for key, limit, message in buckets:
        if _current(key) >= limit:
            return message
    return None


def check_send_rate_limit(ip, phone):
    """发送前检查（不计数，计数在发送成功后）。返回 (ok, response, code)。"""
    try:
        message = _exceeded(_send_keys(ip, phone))
    except Exception as exc:  # noqa: BLE001 - Redis 挂了不能把用户堵死在门外
        return False, jsonify({"status": "fail", "message": f"限流检查出错: {exc}"}), 500
    if message:
        return False, jsonify({"status": "fail", "message": message}), 429
    return True, None, None


def increment_send_limit(ip, phone=None):
    """发送成功后给 IP 与手机号各记一次。"""
    for key, _limit, _message in _send_keys(ip, phone):
        _bump(key)


def check_rate_limit(ip, phone=None):
    """校验验证码：先看有没有超限，没超就给两个桶各记一次。"""
    try:
        message = _exceeded(_verify_keys(ip, phone))
        if message:
            return False, jsonify({"status": "fail", "message": message}), 429
        for key, _limit, _msg in _verify_keys(ip, phone):
            _bump(key)
        return True, None, None
    except Exception as exc:  # noqa: BLE001
        return False, jsonify({"status": "fail", "message": f"限流检查出错: {exc}"}), 500
