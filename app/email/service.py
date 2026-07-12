"""Resend 邮件发送封装。参考 docs/ERP_mail_system.md，改写为 Flask + requests 直连 Resend REST API。

Resend API Key 来自 .flaskenv 的 `Resend_API_KEY`（Flask CLI 会自动加载）。
"""
import os

import requests

RESEND_ENDPOINT = "https://api.resend.com/emails"

# 公司邮箱域名（{username}@{EMAIL_DOMAIN}）。可用环境变量覆盖，默认按文档使用 utba.my。
EMAIL_DOMAIN = os.environ.get("EMAIL_DOMAIN", "utba.my")

_PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def get_resend_api_key():
    key = os.environ.get("Resend_API_KEY") or os.environ.get("RESEND_API_KEY")
    if key:
        return key.strip()
    # 兜底：直接从 .flaskenv 读取（非 flask CLI 启动时 os.environ 可能没有）。
    try:
        from dotenv import dotenv_values

        values = dotenv_values(os.path.join(_PROJECT_ROOT, ".flaskenv"))
        key = values.get("Resend_API_KEY") or values.get("RESEND_API_KEY")
        return key.strip() if key else None
    except Exception:
        return None


def company_email_for(username):
    return f"{(username or '').strip()}@{EMAIL_DOMAIN}"


def send_via_resend(*, from_header, to_email, subject, text, cc=None, bcc=None):
    """调用 Resend 发送邮件，成功返回 message id，失败抛出异常。"""
    api_key = get_resend_api_key()
    if not api_key:
        raise RuntimeError("邮件服务未配置 Resend API Key")

    payload = {
        "from": from_header,
        "to": [to_email],
        "subject": subject,
        "text": text,
    }
    if cc:
        payload["cc"] = [cc]
    if bcc:
        payload["bcc"] = [bcc]

    response = requests.post(
        RESEND_ENDPOINT,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=20,
    )

    data = {}
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
