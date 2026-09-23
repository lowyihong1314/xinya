"""公司邮箱：发送 + 已发送列表 + 改邮箱验证 + Cloudflare 转发。

原 app/email/routes.py（Flask Blueprint，挂在 /api/email）。只做框架适配，
校验顺序、状态码、文案、响应体形状逐字照搬 —— 前端按 status/message 分支。

URL 变化（BASE_PATH 由 nginx 剥掉，应用内部一律写裸路径）：

    /api/email/list            → /email/list
    /api/email/send            → /email/send
    /api/email/change-request  → /email/change-request
    /api/email/verify-request  → /email/verify-request
    /api/email/verify          → /email/verify

★ 两个迁移要点：

  ① **验证链接的 URL 必须走 core.urls.absolute_url()**，不能再用
     ``request.host_url + "/api/email/verify"``。两个原因：
       · /api 这一段没了，写死会生成 404 链接；
       · BASE_PATH（/UTBA_DEMO）是 nginx 加的，应用自己看不见，
         absolute_url 会从 X-Forwarded-Prefix 补回来。
     顺带修掉一个安全问题：``request.host_url`` 取自 **客户端可伪造的 Host 头**，
     攻击者用自己的 Host 打这个接口就能让我们往用户邮箱里发一条指向他域名的
     "验证链接"。absolute_url 优先用配置里的 APP_PUBLIC_ORIGIN。

  ② 本文件**不能写 ``from __future__ import annotations``** —— core.auth.login_required
     用 functools.wraps 包了一层，FastAPI 求值注解时用的是 core/auth.py 的命名空间，
     开了 future annotations 会在那里找不到 Optional 而**启动即 NameError**。
     详见 api/permission_mgmt.py 顶部那段。

  ③ 路由一律 ``def``（同步）：底下是 requests 同步调用 + DB commit，
     写成 async def 会把 worker 的事件循环焊死。
"""

import html
import re
from typing import Optional

from fastapi import APIRouter, Body
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from starlette.responses import HTMLResponse

from backend.api.email.cloudflare import configure_forwarding
from backend.api.email.service import company_email_for, send_via_resend
from backend.core.auth import current_user, login_required
from backend.core.config import settings
from backend.core.responses import json_response
from backend.core.urls import absolute_url
from backend.models import db
from backend.models.email_log import EmailLog
from backend.models.user_data import User

router = APIRouter(prefix=f"{settings.api_prefix}/email", tags=["email"])

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# 24 小时。salt 与有效期都不能随便改：改了等于让所有**已发出但还没点**的
# 验证链接立刻失效，用户看到的是「链接无效」。
EMAIL_TOKEN_MAX_AGE = 60 * 60 * 24

_JSON_BODY = Body(default=None)  # 对应 Flask 的 request.get_json(silent=True) or {}


def _valid_email(value):
    return bool(value and _EMAIL_RE.match(value.strip()))


def _email_serializer():
    # salt 从 current_app.config 换成 settings，值仍是 "email-change-v1"（见 core/config.py）。
    return URLSafeTimedSerializer(settings.secret_key, salt=settings.email_change_salt)


def _verify_page(title, message, ok=True, status_code=200):
    """验证结果页。这是**给人看的 HTML**，不是 JSON 接口——用户是从邮件里点进来的。"""
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
    return HTMLResponse(body, status_code=status_code)


@router.get("/list")
@login_required
def list_emails():
    logs = (
        EmailLog.query.filter_by(user_id=current_user.id)
        .order_by(EmailLog.created_at.desc(), EmailLog.id.desc())
        .limit(100)
        .all()
    )
    return json_response(
        {
            "status": "success",
            "data": [log.to_dict() for log in logs],
            "from_email": company_email_for(current_user.username),
        }
    )


@router.post("/send")
@login_required
def send_email(payload: Optional[dict] = _JSON_BODY):
    data = payload or {}
    to_email = (data.get("to_email") or "").strip()
    subject = (data.get("subject") or "").strip()
    body = data.get("body") or ""
    cc_email = (data.get("cc_email") or "").strip() or None
    bcc_email = (data.get("bcc_email") or "").strip() or None

    if not _valid_email(to_email):
        return json_response({"status": "error", "message": "请输入有效的收件人邮箱"}, 400)
    if not subject:
        return json_response({"status": "error", "message": "请输入邮件主题"}, 400)
    if not str(body).strip():
        return json_response({"status": "error", "message": "请输入邮件内容"}, 400)
    if cc_email and not _valid_email(cc_email):
        return json_response({"status": "error", "message": "抄送邮箱格式不正确"}, 400)
    if bcc_email and not _valid_email(bcc_email):
        return json_response({"status": "error", "message": "密送邮箱格式不正确"}, 400)

    username = (current_user.username or "").strip()
    if not username:
        return json_response({"status": "error", "message": "当前账号缺少用户名，无法确定发件邮箱"}, 400)

    from_email = company_email_for(username)
    display_name = (current_user.display_name or username).strip()

    # ★ 先落库再发送（status=pending），不是发完再记：发送那一步可能超时或进程被杀，
    #   先记录才能保证「发出去了但没记上」不会发生。失败时改成 failed，见下面的 except。
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
            from_header=f"{display_name} <{from_email}>",
            to_email=to_email,
            subject=subject,
            text=body,
            cc=cc_email,
            bcc=bcc_email,
        )
        log.status = "success"
        log.message_id = message_id
        db.session.commit()
        return json_response({"status": "success", "message": "邮件已发送", "data": log.to_dict()})
    except Exception as exc:  # noqa: BLE001 - 发送失败也要落库记录
        log.status = "failed"
        log.error_message = str(exc)[:1000]
        db.session.commit()
        return json_response({"status": "error", "message": f"邮件发送失败：{exc}"}, 500)


def _send_verification_link(user, target_email):
    """给 target_email 发验证链接（从 {username}@utba.my 发出），并记为 pending_email。

    发送失败抛异常，调用方转成 500 + 中文提示。
    """
    username = (user.username or "").strip()
    if not username:
        raise RuntimeError("当前账号缺少用户名，无法发送验证邮件")

    user.pending_email = target_email
    db.session.commit()

    token = _email_serializer().dumps({"uid": user.id, "email": target_email})
    # 原来是 f"{request.host_url.rstrip('/')}/api/email/verify?token={token}"。
    # 见本文件顶部 ①：/api 段没了，且 Host 头不可信。
    verify_url = absolute_url(f"/email/verify?token={token}")
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


@router.post("/change-request")
@login_required
def request_email_change(payload: Optional[dict] = _JSON_BODY):
    """改接收邮箱：先发一封验证邮件，点击链接后才真正生效。"""
    data = payload or {}
    new_email = (data.get("email") or "").strip()

    if not _valid_email(new_email):
        return json_response({"status": "error", "message": "请输入有效的邮箱地址"}, 400)
    if current_user.email and new_email.lower() == current_user.email.lower():
        return json_response(
            {"status": "error", "message": "新邮箱与当前邮箱相同（如需验证，请点邮箱旁的「验证」）"}, 400
        )

    existing = User.query.filter(User.email == new_email, User.id != current_user.id).first()
    if existing:
        return json_response({"status": "error", "message": "这个邮箱已被其他账号使用"}, 400)

    try:
        # current_user 是 ContextVar 代理，_send_verification_link 要的是真的 User 行对象，
        # 属性访问会穿透代理，所以直接传没问题（与 Flask-Login 时代一致）。
        _send_verification_link(current_user, new_email)
    except Exception as exc:  # noqa: BLE001
        return json_response({"status": "error", "message": f"验证邮件发送失败：{exc}"}, 500)

    return json_response(
        {
            "status": "success",
            "message": f"验证邮件已发送到 {new_email}，请查收并点击链接完成验证。验证前邮箱不会变更。",
        }
    )


@router.post("/verify-request")
@login_required
def request_email_verify():
    """验证「已有但未验证」的当前邮箱：给当前邮箱发验证链接（老用户补验证用）。"""
    email = (current_user.email or "").strip()
    if not _valid_email(email):
        return json_response({"status": "error", "message": "当前没有可验证的邮箱，请先设置邮箱"}, 400)
    if current_user.email_verified:
        return json_response({"status": "error", "message": "该邮箱已验证"}, 400)

    try:
        _send_verification_link(current_user, email)
    except Exception as exc:  # noqa: BLE001
        return json_response({"status": "error", "message": f"验证邮件发送失败：{exc}"}, 500)

    return json_response(
        {"status": "success", "message": f"验证邮件已发送到 {email}，请查收并点击链接完成验证。"}
    )


@router.get("/verify")
def verify_email_change(token: str = ""):
    """验证链接（从邮件里点开，**无需登录**）。通过后写入 email 并配置 Cloudflare 转发。

    Flask 版是 ``request.args.get("token", "")``；这里声明成带默认值的 str 查询参数，
    缺 token 时同样落到空串 → 下面 loads 抛 BadSignature → 400「链接无效」。
    声明成必填的话 FastAPI 会回 422，和原来的 400 页面不一样。
    """
    try:
        payload = _email_serializer().loads(token, max_age=EMAIL_TOKEN_MAX_AGE)
    except SignatureExpired:
        return _verify_page(
            "链接已过期", "验证链接已超过 24 小时失效，请回到资料页重新发起邮箱验证。", ok=False, status_code=400
        )
    except BadSignature:
        return _verify_page("链接无效", "验证链接无效或已被使用。", ok=False, status_code=400)

    user = User.query.get(payload.get("uid"))
    new_email = payload.get("email")
    if not user or not new_email:
        return _verify_page("验证失败", "找不到对应的账号。", ok=False, status_code=400)
    # pending_email 对不上 = 这条链接已被后来的修改覆盖，或已经用过一次。
    # 这是**一次性链接**的实现方式，别为了「方便重试」去掉。
    if (user.pending_email or "").lower() != str(new_email).lower():
        return _verify_page(
            "链接已失效", "这个验证链接已被新的修改覆盖，或已经完成过验证。", ok=False, status_code=400
        )

    existing = User.query.filter(User.email == new_email, User.id != user.id).first()
    if existing:
        return _verify_page("邮箱已被占用", "这个邮箱在此期间已被其他账号使用。", ok=False, status_code=400)

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
