"""Resend 邮件发送封装（HTTP 直连 REST API，不用官方 SDK）。

配置来源从 ``.flaskenv`` 换成了 core.config —— 原来这里自己手写了一个
``.flaskenv`` 解析器（因为服务器 venv 可能没装 python-dotenv，而 gunicorn
不像 flask CLI 会自动加载 .flaskenv）。现在 pydantic-settings 统一读
system_config.env，那套兜底逻辑连同 ``env_value`` 一起删掉了。

⚠️ ``env_value`` 是被 app/email/cloudflare.py import 过的，那边已同步改成读 settings。
"""

import requests

from backend.core.config import settings


def company_email_for(username):
    """公司邮箱：{username}@{EMAIL_DOMAIN}，默认 utba.my。"""
    return f"{(username or '').strip()}@{settings.email_domain}"


def send_via_resend(*, from_header, to_email, subject, text, cc=None, bcc=None):
    """调用 Resend 发送邮件，成功返回 message id，失败抛异常。

    失败一律抛 RuntimeError（不是返回 None）——调用方 api/email.py 靠 try/except
    把 EmailLog 标成 failed 并落库，吞掉异常会让失败的邮件在列表里显示成 pending。
    """
    api_key = settings.resend_api_key
    if not api_key:
        raise RuntimeError("邮件服务未配置 Resend API Key")

    payload = {"from": from_header, "to": [to_email], "subject": subject, "text": text}
    if cc:
        payload["cc"] = [cc]
    if bcc:
        payload["bcc"] = [bcc]

    response = requests.post(
        f"{settings.resend_base_url.rstrip('/')}/emails",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json=payload,
        timeout=20,
    )

    try:
        data = response.json()
    except ValueError:
        data = {}

    if response.status_code >= 400:
        message = None
        if isinstance(data, dict):
            error = data.get("error")
            if isinstance(error, dict):
                message = error.get("message")
            message = message or data.get("message") or (error if isinstance(error, str) else None)
        raise RuntimeError(message or response.text or "邮件发送失败")

    return data.get("id") if isinstance(data, dict) else None
