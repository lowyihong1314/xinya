from flask import jsonify, request, session
from twilio.rest import Client

from _token import TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, VERIFY_SERVICE_SID
from .rate_limit import check_rate_limit, check_send_rate_limit, increment_send_limit


client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)

# 内部万能验证码（本会人员应急用），前端不展示、失败响应也不再回传
SHORTCUT_OTP = "1031"


def get_remote_ip():
    if request.headers.get("X-Forwarded-For"):
        return request.headers["X-Forwarded-For"].split(",")[0].strip()
    return request.remote_addr


def send_otp(phone, channel):
    ip = get_remote_ip()

    if session.get("phone") == phone:
        return jsonify({"status": "cookie_true", "message": "使用浏览器密钥认证"}), 200

    if channel not in ("sms", "call"):
        channel = "sms"

    # IP 每小时 100 次 / 单个号码每小时 10 次，两层分开计数
    ok, limited_response, limited_code = check_send_rate_limit(ip, phone)
    if not ok:
        return limited_response, limited_code

    try:
        session["phone"] = phone
        verification = client.verify.v2.services(VERIFY_SERVICE_SID).verifications.create(
            to=phone,
            channel=channel,
        )
        increment_send_limit(ip, phone)
        return jsonify(
            {
                "status": "success",
                "message": "验证码已发送到你的手机",
                "twilio_result": {
                    "sid": verification.sid,
                    "channel": verification.channel,
                    "status": verification.status,
                    "to": verification.to,
                    "date_created": verification.date_created.isoformat()
                    if verification.date_created
                    else None,
                },
            }
        )
    except Exception as exc:
        return jsonify({"status": "fail", "message": f"发送验证码失败: {str(exc)}"}), 500


def verify_otp(otp, phone):
    if not otp or not phone:
        return jsonify({"status": "fail", "message": "验证码或手机号缺失"}), 400

    # 内部短路码：只保留 1031，且不再回传给前端（以前失败响应会把后门码明文吐出来）
    if otp == SHORTCUT_OTP:
        _mark_phone_verified(phone)
        return jsonify(
            {
                "status": "success",
                "message": "验证码验证成功（短路）",
                "data": {"phone": phone, "shortcut": True},
            }
        )

    ok, response, code = check_rate_limit(get_remote_ip(), phone)
    if not ok:
        return response, code

    try:
        verification_check = client.verify.v2.services(
            VERIFY_SERVICE_SID
        ).verification_checks.create(to=phone, code=otp)

        if verification_check.status == "approved":
            _mark_phone_verified(phone)
            return jsonify(
                {"status": "success", "message": "验证码验证成功", "data": {"phone": phone}}
            )
        return jsonify({"status": "fail", "message": "验证码错误或已过期"}), 401
    except Exception as exc:
        return jsonify({"status": "fail", "message": f"验证码验证失败: {str(exc)}"}), 500


def debug_session():
    return jsonify({"session_phone": session.get("phone"), "all_session": dict(session)})


def test_send_otp(phone):
    if session.get("logged_in") is True or session.get("phone") == phone:
        return (
            jsonify(
                {
                    "status": "cookie_true",
                    "message": "已存在手机号 cookie 或已登录，无需重复发送",
                }
            ),
            200,
        )

    session["phone"] = phone
    return jsonify({"status": "success", "message": f"测试模式：验证码已“发送”到 {phone}"})


def test_verify_otp(otp):
    phone = session.get("phone")
    if not otp or not phone:
        return jsonify({"status": "fail", "message": "验证码或手机号缺失"}), 400

    if otp == "8888":
        _mark_phone_verified(phone)
        return jsonify({"status": "success", "message": "测试验证成功", "data": {"phone": phone}})
    return jsonify({"status": "fail", "message": "测试模式：验证码错误"}), 401


def clear_phone_session():
    session.pop("phone", None)
    return jsonify({"status": "success", "message": "已清除手机号 session"})


def _mark_phone_verified(phone):
    # 验证结果保存 7 天（PERMANENT_SESSION_LIFETIME），供公开页读取本人记录用。
    session.permanent = True
    verified_phones = session.get("verified_phones", [])
    if phone not in verified_phones:
        verified_phones.append(phone)
        session["verified_phones"] = verified_phones
