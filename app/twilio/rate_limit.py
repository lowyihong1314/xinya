from flask import jsonify

from app.redis_client import redis_client


RATE_LIMIT = 500000
RATE_LIMIT_TTL = 3600


def check_rate_limit(ip_key):
    try:
        current_attempts = redis_client.get(ip_key)
        if current_attempts and int(current_attempts) >= RATE_LIMIT:
            return (
                False,
                jsonify(
                    {
                        "status": "fail",
                        "message": "该 IP 提交次数已达上限，请 1 小时后再试",
                    }
                ),
                429,
            )

        pipe = redis_client.pipeline()
        pipe.incr(ip_key)
        pipe.ttl(ip_key)
        count, ttl = pipe.execute()
        del count
        if ttl == -1:
            redis_client.expire(ip_key, RATE_LIMIT_TTL)
        return True, None, None
    except Exception as exc:
        return (
            False,
            jsonify({"status": "fail", "message": f"限流检查出错: {str(exc)}"}),
            500,
        )


def increment_send_limit(ip_key):
    redis_client.incr(ip_key)
    redis_client.expire(ip_key, RATE_LIMIT_TTL)


def is_send_rate_limited(ip_key):
    current_attempts = redis_client.get(ip_key)
    return current_attempts and int(current_attempts) >= RATE_LIMIT
