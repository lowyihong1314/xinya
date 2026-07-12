"""Resend 邮件发送封装。参考 docs/ERP_mail_system.md，改写为 Flask + requests 直连 Resend REST API。

Resend API Key 来自 .flaskenv 的 `Resend_API_KEY`（Flask CLI 会自动加载）。
"""
import os

import requests

RESEND_ENDPOINT = "https://api.resend.com/emails"

# 公司邮箱域名（{username}@{EMAIL_DOMAIN}）。可用环境变量覆盖，默认按文档使用 utba.my。
EMAIL_DOMAIN = os.environ.get("EMAIL_DOMAIN", "utba.my")

_PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def _read_flaskenv_value(name):
    """手动解析 .flaskenv 里某个 key（不依赖 python-dotenv，服务器 venv 可能没装）。"""
    path = os.path.join(_PROJECT_ROOT, ".flaskenv")
    try:
        with open(path, "r", encoding="utf-8") as fh:
            for raw in fh:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                if key.strip() == name:
                    return value.strip().strip('"').strip("'")
    except OSError:
        return None
    return None


def env_value(name):
    """先取进程环境变量；取不到再直接读 .flaskenv（gunicorn 等非 flask CLI 启动时的兜底）。"""
    value = os.environ.get(name)
    if value:
        return value.strip()
    return _read_flaskenv_value(name)


def get_resend_api_key():
    return env_value("Resend_API_KEY") or env_value("RESEND_API_KEY")


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
