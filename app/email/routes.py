"""公司邮箱：发送 + 已发送列表 + 改邮箱验证 + Cloudflare 转发。挂载于 /api/email。"""
import html
import re

from flask import Blueprint, Response, current_app, jsonify, request
from flask_login import current_user, login_required
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from models import db
from models.email_log import EmailLog
from models.user_data import User
from app.email.cloudflare import configure_forwarding
from app.email.service import company_email_for, send_via_resend

email_bp = Blueprint("email", __name__)

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

EMAIL_CHANGE_SALT = "email-change-v1"
EMAIL_TOKEN_MAX_AGE = 60 * 60 * 24  # 24 小时


def _valid_email(value):
    return bool(value and _EMAIL_RE.match(value.strip()))


def _email_serializer():
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt=EMAIL_CHANGE_SALT)


def _verify_page(title, message, ok=True):
    color = "#0f766e" if ok else "#b91c1c"
    safe_message = html.escape(message).replace("\n", "<br>")
    body = f"""<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title></head>
<body style="margin:0;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#eef5f4;">
<div style="max-width:440px;margin:12vh auto;padding:28px;background:#fff;border-radius:16px;
box-shadow:0 20px 50px rgba(15,23,42,.12);text-align:center;">
<h1 style="margin:0 0 12px;font-size:22px;color:{color};">{html.escape(title)}</h1>
<p style="margin:0;color:#334155;line-height:1.7;font-size:14px;">{safe_message}</p>
</div></body></html>"""
    return Response(body, mimetype="text/html")


@email_bp.get("/list")
@login_required
def list_emails():
    logs = (
        EmailLog.query.filter_by(user_id=current_user.id)
        .order_by(EmailLog.created_at.desc(), EmailLog.id.desc())
        .limit(100)
        .all()
    )
    return jsonify(
        {
            "status": "success",
            "data": [log.to_dict() for log in logs],
            "from_email": company_email_for(current_user.username),
        }
    )


@email_bp.post("/send")
@login_required
def send_email():
    payload = request.get_json(silent=True) or {}
    to_email = (payload.get("to_email") or "").strip()
    subject = (payload.get("subject") or "").strip()
    body = payload.get("body") or ""
    cc_email = (payload.get("cc_email") or "").strip() or None
    bcc_email = (payload.get("bcc_email") or "").strip() or None

    if not _valid_email(to_email):
        return jsonify({"status": "error", "message": "请输入有效的收件人邮箱"}), 400
    if not subject:
        return jsonify({"status": "error", "message": "请输入邮件主题"}), 400
    if not str(body).strip():
        return jsonify({"status": "error", "message": "请输入邮件内容"}), 400
    if cc_email and not _valid_email(cc_email):
        return jsonify({"status": "error", "message": "抄送邮箱格式不正确"}), 400
    if bcc_email and not _valid_email(bcc_email):
        return jsonify({"status": "error", "message": "密送邮箱格式不正确"}), 400

    username = (current_user.username or "").strip()
    if not username:
        return jsonify({"status": "error", "message": "当前账号缺少用户名，无法确定发件邮箱"}), 400

    from_email = company_email_for(username)
    display_name = (current_user.display_name or username).strip()
    from_header = f"{display_name} <{from_email}>"

    log = EmailLog(
        user_id=current_user.id,
        from_email=from_email,
        to_email=to_email,
        cc_email=cc_email,
        bcc_email=bcc_email,
        subject=subject,
        body=body,
        direction="sent",
        status="pending",
    )
    db.session.add(log)
    db.session.commit()

    try:
        message_id = send_via_resend(
            from_header=from_header,
            to_email=to_email,
            subject=subject,
            text=body,
            cc=cc_email,
            bcc=bcc_email,
        )
        log.status = "success"
        log.message_id = message_id
        db.session.commit()
        return jsonify({"status": "success", "message": "邮件已发送", "data": log.to_dict()})
    except Exception as exc:  # noqa: BLE001 - 发送失败也要落库记录
        log.status = "failed"
        log.error_message = str(exc)[:1000]
        db.session.commit()
        return jsonify({"status": "error", "message": f"邮件发送失败：{exc}"}), 500


def _send_verification_link(user, target_email):
    """给 target_email 发验证链接（从 {username}@utba.my 发出），并记为 pending_email。发送失败抛异常。"""
    username = (user.username or "").strip()
    if not username:
        raise RuntimeError("当前账号缺少用户名，无法发送验证邮件")

    user.pending_email = target_email
    db.session.commit()

    token = _email_serializer().dumps({"uid": user.id, "email": target_email})
    verify_url = f"{request.host_url.rstrip('/')}/api/email/verify?token={token}"
    from_email = company_email_for(username)
    display_name = (user.display_name or username).strip()
    text = (
        f"你好 {display_name}，\n\n"
        f"请点击下面的链接验证你的接收邮箱：{target_email}\n\n"
        f"验证链接（24 小时内有效）：\n{verify_url}\n\n"
        f"验证通过后，发往 {from_email} 的邮件会通过 Cloudflare 转发到这个邮箱。\n"
        f"如果这不是你本人操作，请忽略本邮件。"
    )
    send_via_resend(
        from_header=f"{display_name} <{from_email}>",
        to_email=target_email,
        subject="验证你的接收邮箱",
        text=text,
    )


@email_bp.post("/change-request")
@login_required
def request_email_change():
    """改接收邮箱：先发一封验证邮件（从 {username}@utba.my 发出），点击链接后才真正生效。"""
    payload = request.get_json(silent=True) or {}
    new_email = (payload.get("email") or "").strip()

    if not _valid_email(new_email):
        return jsonify({"status": "error", "message": "请输入有效的邮箱地址"}), 400
    if current_user.email and new_email.lower() == current_user.email.lower():
        return jsonify({"status": "error", "message": "新邮箱与当前邮箱相同（如需验证，请点邮箱旁的「验证」）"}), 400

    existing = User.query.filter(User.email == new_email, User.id != current_user.id).first()
    if existing:
        return jsonify({"status": "error", "message": "这个邮箱已被其他账号使用"}), 400

    try:
        _send_verification_link(current_user, new_email)
    except Exception as exc:  # noqa: BLE001
        return jsonify({"status": "error", "message": f"验证邮件发送失败：{exc}"}), 500

    return jsonify(
        {
            "status": "success",
            "message": f"验证邮件已发送到 {new_email}，请查收并点击链接完成验证。验证前邮箱不会变更。",
        }
    )


@email_bp.post("/verify-request")
@login_required
def request_email_verify():
    """验证「已有但未验证」的当前邮箱：给当前邮箱发验证链接（老用户补验证用）。"""
    email = (current_user.email or "").strip()
    if not _valid_email(email):
        return jsonify({"status": "error", "message": "当前没有可验证的邮箱，请先设置邮箱"}), 400
    if current_user.email_verified:
        return jsonify({"status": "error", "message": "该邮箱已验证"}), 400

    try:
        _send_verification_link(current_user, email)
    except Exception as exc:  # noqa: BLE001
        return jsonify({"status": "error", "message": f"验证邮件发送失败：{exc}"}), 500

    return jsonify(
        {"status": "success", "message": f"验证邮件已发送到 {email}，请查收并点击链接完成验证。"}
    )


@email_bp.get("/verify")
def verify_email_change():
    """验证链接（从邮件里点开，无需登录）。通过后写入 email 并配置 Cloudflare 转发。"""
    token = request.args.get("token", "")
    try:
        payload = _email_serializer().loads(token, max_age=EMAIL_TOKEN_MAX_AGE)
    except SignatureExpired:
        return _verify_page("链接已过期", "验证链接已超过 24 小时失效，请回到资料页重新发起邮箱验证。", ok=False), 400
    except BadSignature:
        return _verify_page("链接无效", "验证链接无效或已被使用。", ok=False), 400

    user = User.query.get(payload.get("uid"))
    new_email = payload.get("email")
    if not user or not new_email:
        return _verify_page("验证失败", "找不到对应的账号。", ok=False), 400
    if (user.pending_email or "").lower() != str(new_email).lower():
        return _verify_page("链接已失效", "这个验证链接已被新的修改覆盖，或已经完成过验证。", ok=False), 400

    existing = User.query.filter(User.email == new_email, User.id != user.id).first()
    if existing:
        return _verify_page("邮箱已被占用", "这个邮箱在此期间已被其他账号使用。", ok=False), 400

    user.email = new_email
    user.email_verified = True
    user.pending_email = None
    db.session.commit()

    cf = configure_forwarding(user.username, new_email, old_rule_id=user.email_forward_rule_id)
    if cf.get("rule_id"):
        user.email_forward_rule_id = cf["rule_id"]
        db.session.commit()

    note = f"发往 {company_email_for(user.username)} 的邮件将转发到 {new_email}。"
    if cf.get("warning"):
        note += f"\n注意：{cf['warning']}"
    return _verify_page("验证成功 ✅", f"你的接收邮箱已更新为 {new_email}。\n{note}", ok=True)
