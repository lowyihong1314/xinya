# ⚠️ 已停用：本文件是 Flask 时代的路由，现由 api/twilio.py（FastAPI）接管。
#    留着只为迁移对照 —— 它调用的 services 签名已经变了（多了 ip / session 两个
#    关键字参数），照这份代码跑必然报 TypeError。确认无人引用后可以直接删。

from flask import Blueprint, request, session

from . import services


twilio_bp = Blueprint("twilio", __name__)


@twilio_bp.route("/send_otp", methods=["POST"])
def send_otp():
    return services.send_otp(
        request.form.get("phone"),
        request.form.get("channel", "sms"),
    )


@twilio_bp.route("/verify", methods=["POST"])
def verify_otp():
    data = request.get_json(silent=True) or {}
    return services.verify_otp(data.get("otp"), data.get("phone") or session.get("phone"))


@twilio_bp.route("/debug_session")
def debug_session():
    return services.debug_session()


@twilio_bp.route("/test_send_otp", methods=["GET"])
def test_send_otp():
    return services.test_send_otp(request.form.get("phone"))


@twilio_bp.route("/test_verify", methods=["POST"])
def test_verify_otp():
    data = request.get_json(silent=True) or {}
    return services.test_verify_otp(data.get("otp"))


@twilio_bp.route("/clear_phone_session", methods=["POST"])
def clear_phone_session():
    return services.clear_phone_session()
