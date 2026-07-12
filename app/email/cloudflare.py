"""Cloudflare Email Routing 封装。

参考 docs/ERP_mail_system.md 的 CloudflareService，用 requests 直连 Cloudflare API。
凭据来自 .flaskenv：
  - Email_Routing_Address_API_KEY_Cloudflare  （API Token）
  - Zone_ID_Cloudflare                          （utba.my 的 Zone ID，规则用）
  - Account_ID_Cloudflare                       （账号 ID，目的地址用）

注意：当前 Token 可管理「目的地址」(account 级)，但对「路由规则」(zone 级) 会返回 403。
所以 configure_forwarding 会尽力创建规则，失败时记 warning 但不打断验证流程。
"""
import os

import requests

CF_BASE = "https://api.cloudflare.com/client/v4"
EMAIL_DOMAIN = os.environ.get("EMAIL_DOMAIN", "utba.my")

_PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def _env(name):
    value = os.environ.get(name)
    if value:
        return value.strip()
    try:
        from dotenv import dotenv_values

        values = dotenv_values(os.path.join(_PROJECT_ROOT, ".flaskenv"))
        got = values.get(name)
        return got.strip() if got else None
    except Exception:
        return None


def cf_config():
    token = _env("Email_Routing_Address_API_KEY_Cloudflare")
    zone_id = _env("Zone_ID_Cloudflare")
    account_id = _env("Account_ID_Cloudflare")
    if not token or not zone_id or not account_id:
        return None
    return {"token": token, "zone_id": zone_id, "account_id": account_id}


def _headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def ensure_destination_address(config, email):
    """确保 email 是账号里的转发目的地址；不存在则创建（Cloudflare 会向该地址发验证邮件）。

    返回 {"exists": bool, "verified": bool}。
    """
    headers = _headers(config["token"])
    account_id = config["account_id"]

    listing = requests.get(
        f"{CF_BASE}/accounts/{account_id}/email/routing/addresses",
        headers=headers,
        params={"per_page": 50},
        timeout=15,
    )
    data = listing.json() if listing.content else {}
    for item in data.get("result") or []:
        if (item.get("email") or "").lower() == email.lower():
            return {"exists": True, "verified": bool(item.get("verified"))}

    created = requests.post(
        f"{CF_BASE}/accounts/{account_id}/email/routing/addresses",
        headers=headers,
        json={"email": email},
        timeout=15,
    )
    cdata = created.json() if created.content else {}
    if created.status_code >= 400 and not cdata.get("success"):
        raise RuntimeError(_first_error(cdata) or f"添加转发目的地址失败({created.status_code})")
    result = cdata.get("result") or {}
    return {"exists": True, "verified": bool(result.get("verified"))}


def set_forwarding_rule(config, username, email, old_rule_id=None):
    """创建/替换 {username}@utba.my -> email 的转发规则，返回新规则 id。

    规则是 zone 级操作，需要「Email Routing Rules: Edit」权限。可以用一个单独的 token 承载
    该权限：若配置了 Email_Routing_Rules_API_KEY_Cloudflare 就用它，否则退回地址 token。
    """
    rules_token = _env("Email_Routing_Rules_API_KEY_Cloudflare") or config["token"]
    headers = _headers(rules_token)
    zone_id = config["zone_id"]

    if old_rule_id:
        try:
            requests.delete(
                f"{CF_BASE}/zones/{zone_id}/email/routing/rules/{old_rule_id}",
                headers=headers,
                timeout=15,
            )
        except Exception:
            pass

    payload = {
        "matchers": [{"type": "literal", "field": "to", "value": f"{username}@{EMAIL_DOMAIN}"}],
        "actions": [{"type": "forward", "value": [email]}],
        "enabled": True,
        "name": f"forward {username}@{EMAIL_DOMAIN}",
        "priority": 0,
    }
    response = requests.post(
        f"{CF_BASE}/zones/{zone_id}/email/routing/rules",
        headers=headers,
        json=payload,
        timeout=15,
    )
    data = response.json() if response.content else {}
    if response.status_code >= 400 or not data.get("success"):
        raise RuntimeError(_first_error(data) or f"创建转发规则失败({response.status_code})")
    return (data.get("result") or {}).get("id")


def configure_forwarding(username, email, old_rule_id=None):
    """总入口：加目的地址 + 建转发规则。

    返回 {"rule_id": str|None, "address_verified": bool, "warning": str|None}。
    规则创建失败（例如 Token 无 zone 级邮件路由权限）不抛异常，只带 warning 回去。
    """
    config = cf_config()
    if not config:
        return {"rule_id": None, "address_verified": False, "warning": "Cloudflare 未配置（缺 Zone/Account ID 或 Token）"}

    warning = None
    address_verified = False
    try:
        addr = ensure_destination_address(config, email)
        address_verified = addr.get("verified", False)
        if not address_verified:
            warning = "Cloudflare 已把该邮箱加为转发目的地址，但仍需在 Cloudflare 发来的验证邮件中确认后转发才会真正生效。"
    except Exception as exc:  # noqa: BLE001
        return {"rule_id": None, "address_verified": False, "warning": f"添加转发目的地址失败：{exc}"}

    rule_id = None
    try:
        rule_id = set_forwarding_rule(config, username, email, old_rule_id=old_rule_id)
    except Exception as exc:  # noqa: BLE001
        rule_warning = f"转发规则未自动创建（{exc}）。当前 Token 可能只有目的地址权限，需要补上 zone 级 Email Routing 编辑权限。"
        warning = f"{warning} {rule_warning}".strip() if warning else rule_warning

    return {"rule_id": rule_id, "address_verified": address_verified, "warning": warning}


def _first_error(data):
    if isinstance(data, dict):
        errors = data.get("errors")
        if isinstance(errors, list) and errors:
            first = errors[0]
            if isinstance(first, dict):
                return first.get("message")
    return None
