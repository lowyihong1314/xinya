"""牌位登记单读图：直接调 BytePlus(Ark) 视觉模型。

报销那条 read_bill 走的是「收据」提示词，只认得印刷体，手写的功德主/电话/合共一律读不到；
这里改成直连 Ark，用针对法会登记单写的提示词，把手写栏位读成结构化 JSON。
API key 与既有 AI 功能共用 BYTEPLUS_API_KEY（见 app/quiz_game/ai.py）。
"""
from __future__ import annotations

import base64
import json
import re
import urllib.error
import urllib.request
from pathlib import Path

from app.email.service import env_value

DEFAULT_ARK_BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3"
DEFAULT_ARK_VISION_MODEL = "seed-2-0-pro-260328"

SYSTEM_PROMPT = (
    "你在读一张马来西亚佛教团体（地南佛学会）的盂兰盆法会「牌位登记单」照片。\n"
    "单据是印刷表格 + 手写内容：表格分 A/B/C/D/E/F 等区（超度历代祖先、超度亡灵、"
    "超度冤亲债主、无缘子女、随缘供斋等），每区有单价，信众手写姓名与数量，最后写「合共」金额。\n"
    "右上角常有红笔写的数字，那是去年同一位施主的订单编号，很重要。\n\n"
    "只输出一个 JSON 对象，不要任何解释文字，格式：\n"
    "{\n"
    '  "customer_name": "抬头/参加者姓名（手写，没有就空字符串）",\n'
    '  "phones": ["手写电话，原样保留"],\n'
    '  "total": 合共金额的数字（没有就 null）,\n'
    '  "red_pen_number": "右上角红笔数字（没有就空字符串）",\n'
    '  "person_names": ["单据上出现的所有人名"],\n'
    '  "item_count": 牌位笔数（估算，没有就 null）,\n'
    '  "summary": "一句话说明这张单写了什么"\n'
    "}\n"
    "读不到的栏位留空，不要猜测、不要编造。"
)


def _api_key() -> str:
    return (env_value("BYTEPLUS_API_KEY") or env_value("ARK_API_KEY") or "").strip()


def _base_url() -> str:
    return (env_value("BYTEPLUS_BASE_URL") or DEFAULT_ARK_BASE_URL).strip()


def _vision_model() -> str:
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


def read_paiwei_slip(image_path: Path, timeout: int = 120) -> dict:
    """读一张登记单，返回 {ok, data, error, model, raw}；失败不抛错。"""
    key = _api_key()
    if not key:
        return {"ok": False, "error": "未配置 BYTEPLUS_API_KEY", "data": {}, "model": None}
    if not image_path.is_file():
        return {"ok": False, "error": "图片不存在", "data": {}, "model": None}

    suffix = image_path.suffix.lower().lstrip(".")
    mime = "image/png" if suffix == "png" else "image/jpeg"
    encoded = base64.b64encode(image_path.read_bytes()).decode()

    payload = {
        "model": _vision_model(),
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "读这张牌位登记单，按系统提示的 JSON 格式输出。"},
                    {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{encoded}"}},
                ],
            },
        ],
        "max_tokens": 1500,
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
        return {"ok": False, "error": f"BytePlus 返回 {exc.code}：{detail}", "data": {}, "model": _vision_model()}
    except urllib.error.URLError as exc:
        return {"ok": False, "error": f"BytePlus 连不上：{exc.reason}", "data": {}, "model": _vision_model()}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"BytePlus 读图失败：{exc}", "data": {}, "model": _vision_model()}

    try:
        content = body["choices"][0]["message"]["content"]
    except Exception:  # noqa: BLE001
        return {"ok": False, "error": "BytePlus 返回格式异常", "data": {}, "model": _vision_model()}

    data = _extract_json(content)
    return {
        "ok": bool(data),
        "error": None if data else "模型没有返回可解析的 JSON",
        "data": data,
        "model": body.get("model") or _vision_model(),
        "raw": content[:800],
    }
