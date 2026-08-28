"""报销单 AI 读单：直接调 BytePlus(Ark) 视觉 / 文本模型。

原本走的是外部网关 read_bill_api（https://nginx.yihong1031.com/read_bill_api/…），
那个服务已经没人维护了，所以改成本地直连 Ark。旧的网关实现保留在
app/account/services.py 里（整段注释掉），需要对照时可以翻。

API key 与既有 AI 功能共用 BYTEPLUS_API_KEY（另见 app/quiz_game/ai.py、
app/fahui/YLP/paiwei_ocr.py）。

返回结构刻意和旧网关保持一致 —— 前端 readBillFill.ts / lineItems.ts 直接吃这个：
    {"data": {...驼峰字段...}, "meta": {...}}
"""
from __future__ import annotations

import base64
import json
import re
import urllib.error
import urllib.request

from app.email.service import env_value

DEFAULT_ARK_BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3"
DEFAULT_ARK_VISION_MODEL = "seed-2-0-pro-260328"

# 和旧网关一致的分类词表，前端会把 OTHER 当成「没分类」处理
EXPENSE_CATEGORIES = (
    "FOOD", "TRANSPORT", "OFFICE", "UTILITIES", "MAINTENANCE",
    "EVENT", "DONATION", "MEDICAL", "PRINTING", "OTHER",
)

SYSTEM_PROMPT = (
    "你在读一张马来西亚的收据 / 发票 / 账单（佛教团体「地南佛学会」用来报销）。\n"
    "币别基本都是马币 RM。收据可能是中文、英文或马来文，也可能是水电费单、"
    "餐厅单据、五金店单据、网购订单截图。\n\n"
    "只输出一个 JSON 对象，不要任何解释文字、不要 markdown 代码块，格式：\n"
    "{\n"
    '  "merchantName": "商家名称",\n'
    '  "merchantAddress": "商家地址",\n'
    '  "merchantPhone": "商家电话",\n'
    '  "receiptNumber": "收据号 / 单据编号",\n'
    '  "receiptDate": "YYYY-MM-DD",\n'
    '  "purchaseDateTime": "YYYY-MM-DD HH:MM（收据上有时间才填）",\n'
    '  "currency": "RM",\n'
    '  "expenseCategory": "从 ' + "/".join(EXPENSE_CATEGORIES) + ' 里挑一个",\n'
    '  "description": "一句话说明这笔支出",\n'
    '  "amountBeforeTax": 税前金额或 null,\n'
    '  "taxAmount": 税额或 null,\n'
    '  "totalAmount": 应付总额的数字,\n'
    '  "receiptItems": [\n'
    '    {"itemNumber": 1, "description": "项目名", "expenseCategory": "分类",\n'
    '     "quantity": 数量, "lineTotal": 该行金额}\n'
    "  ]\n"
    "}\n\n"
    "要求：\n"
    "- totalAmount 取收据最终应付金额（TOTAL / 总计 / 应付），不是小计，也不含找零\n"
    "- receiptItems 按收据上的逐项抄，金额用该行的小计；读不清的行不要编\n"
    "- 金额一律输出数字，不要带 RM、不要带千分位逗号\n"
    "- 日期统一成 YYYY-MM-DD；收据写 dd/mm/yyyy 时按马来西亚习惯理解\n"
    "- 读不到的栏位给空字符串或 null，绝对不要猜测、不要编造"
)


def _api_key() -> str:
    return (env_value("BYTEPLUS_API_KEY") or env_value("ARK_API_KEY") or "").strip()


def _base_url() -> str:
    return (env_value("BYTEPLUS_BASE_URL") or DEFAULT_ARK_BASE_URL).strip()


def _model() -> str:
    return (env_value("BYTEPLUS_VISION_MODEL") or env_value("BYTEPLUS_MODEL") or DEFAULT_ARK_VISION_MODEL).strip()


def _extract_json(text: str) -> dict:
    raw = (text or "").strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.S)
    if fenced:
        raw = fenced.group(1)
    else:
        brace = re.search(r"\{.*\}", raw, re.S)
        if brace:
            raw = brace.group(0)
    try:
        data = json.loads(raw)
    except Exception:  # noqa: BLE001
        return {}
    return data if isinstance(data, dict) else {}


def _clean_money(value):
    if value is None or isinstance(value, (int, float)):
        return value
    text = re.sub(r"[^\d.\-]", "", str(value))
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _normalize(data: dict) -> dict:
    """把模型给的 JSON 收拾成前端认得的形状（多余的键原样留着，无害）。"""
    out = dict(data or {})

    for key in ("amountBeforeTax", "taxAmount", "totalAmount"):
        if key in out:
            out[key] = _clean_money(out.get(key))

    items = out.get("receiptItems") or out.get("receipt_items") or []
    normalized_items = []
    if isinstance(items, list):
        for index, item in enumerate(items, start=1):
            if not isinstance(item, dict):
                continue
            description = str(item.get("description") or "").strip()
            line_total = _clean_money(item.get("lineTotal") if "lineTotal" in item else item.get("line_total"))
            if not description and line_total is None:
                continue
            normalized_items.append(
                {
                    "itemNumber": item.get("itemNumber") or item.get("item_number") or index,
                    "description": description,
                    "expenseCategory": str(item.get("expenseCategory") or item.get("expense_category") or "").strip(),
                    "quantity": item.get("quantity"),
                    "lineTotal": line_total,
                }
            )
    out["receiptItems"] = normalized_items
    return out


def _confidence(data: dict) -> float:
    """没有网关那套打分了，就按「关键栏位读到了几个」粗略给一个 0~1。"""
    checks = [
        bool(str(data.get("merchantName") or "").strip()),
        bool(str(data.get("receiptDate") or "").strip()),
        data.get("totalAmount") not in (None, ""),
        bool(data.get("receiptItems")),
    ]
    return round(sum(1 for hit in checks if hit) / len(checks), 2)


def _chat(messages: list, timeout: int, attempts: int = 2) -> tuple[dict, str | None]:
    """调一次模型并抠出 JSON。偶尔会吐出解析不了的东西，所以默认多试一次。"""
    if not _api_key():
        return {}, "未配置 BYTEPLUS_API_KEY"

    last_error = None
    for _ in range(max(1, attempts)):
        data, error = _chat_once(messages, timeout)
        if data:
            return data, None
        last_error = error
    return {}, last_error


def _chat_once(messages: list, timeout: int) -> tuple[dict, str | None]:
    key = _api_key()
    if not key:
        return {}, "未配置 BYTEPLUS_API_KEY"

    payload = {
        "model": _model(),
        "messages": messages,
        "max_tokens": 3000,
        "temperature": 0.1,
        "thinking": {"type": "disabled"},
    }
    request_obj = urllib.request.Request(
        f"{_base_url()}/chat/completions",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )

    try:
        with urllib.request.urlopen(request_obj, timeout=timeout) as response:
            body = json.loads(response.read().decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:200]
        return {}, f"BytePlus 返回 {exc.code}：{detail}"
    except urllib.error.URLError as exc:
        return {}, f"BytePlus 连不上：{exc.reason}"
    except Exception as exc:  # noqa: BLE001
        return {}, f"BytePlus 读单失败：{exc}"

    try:
        content = body["choices"][0]["message"]["content"]
    except Exception:  # noqa: BLE001
        return {}, "BytePlus 返回格式异常"

    data = _extract_json(content)
    if not data:
        return {}, "AI 没有返回可解析的 JSON"
    return data, None


def read_bill_image(content: bytes, mimetype: str | None = None, timeout: int = 120) -> tuple[dict, str | None]:
    """读收据图片，返回 (payload, error)。payload 结构同旧网关。"""
    mime = (mimetype or "").strip().lower()
    if mime not in {"image/png", "image/jpeg", "image/webp"}:
        mime = "image/jpeg"
    encoded = base64.b64encode(content).decode()

    data, error = _chat(
        [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "读这张收据，按系统提示的 JSON 格式输出。"},
                    {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{encoded}"}},
                ],
            },
        ],
        timeout,
    )
    if error:
        return {}, error

    normalized = _normalize(data)
    return {
        "data": normalized,
        "meta": {"source": "byteplus-ark", "model": _model(), "confidence": _confidence(normalized)},
    }, None


def read_bill_text(text: str, timeout: int = 120) -> tuple[dict, str | None]:
    """PDF 能抽出文字时走纯文本，省一次图片编码，也更准。"""
    data, error = _chat(
        [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"下面是一张收据 PDF 抽出来的文字，按系统提示的 JSON 格式输出。\n\n{text[:20000]}"},
        ],
        timeout,
    )
    if error:
        return {}, error

    normalized = _normalize(data)
    return {
        "data": normalized,
        "meta": {"source": "byteplus-ark-text", "model": _model(), "confidence": _confidence(normalized)},
    }, None
