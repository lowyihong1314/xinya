"""BytePlus / Ark 聊天补全的最小客户端（活动 AI Agent 用）。

原来 agent.py 是从 ``backend.app.form.ai_grouping`` 里借 ``_ark_api_key`` /
``_call_ark_chat`` 的。**那条 import 不能留**：ai_grouping.py 顶部有
``from flask import jsonify``，借两个函数会把整个 Flask 栈拉回进程 ——
而 agent 的活儿是在 ``agent_worker`` **子进程**里干的，那个进程更不该背 Flask。
form 模块还没搬，所以这里把那三十行照抄过来，逐字一致（只换了取配置的方式）。

取配置从 ``env_value("BYTEPLUS_*")`` 换成 ``settings.*``，取值顺序没变：
  · ``_ark_api_key``  = BYTEPLUS_API_KEY or ARK_API_KEY，再 strip
    （``settings.byteplus_key`` 这个 property 就是为了还原这条顺序才有的）
  · ``_ark_base_url`` / ``_ark_model`` 的 pydantic 默认值与这里的
    DEFAULT_* 常量**逐字相同**，所以 ``or DEFAULT_*`` 那层兜底保留着也不会改变结果
    （留着是防有人把配置项设成空串）。

TODO(收尾): form 搬进 backend/api/ 之后，两边合并成一份放进 core 或 shared，
别让 Ark 的超时/温度参数在两个文件里各漂各的。
"""

import json
import urllib.error
import urllib.request

from backend.core.config import settings

DEFAULT_ARK_BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3"
DEFAULT_ARK_MODEL = "seed-2-0-pro-260328"


def _ark_api_key():
    return settings.byteplus_key


def _ark_base_url():
    return (settings.byteplus_base_url or DEFAULT_ARK_BASE_URL).strip()


def _ark_model():
    return (settings.byteplus_model or DEFAULT_ARK_MODEL).strip()


def _call_ark_chat(messages, temperature=0.3, max_tokens=1600):
    key = _ark_api_key()
    if not key:
        raise ValueError("AI 未配置（缺少 BytePlus/Ark API key）")

    payload = {
        "model": _ark_model(),
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        # 关闭「深度思考」，把这类任务从 ~12s 降到 ~3.5s，避免上游超时。
        "thinking": {"type": "disabled"},
    }
    request_obj = urllib.request.Request(
        f"{_ark_base_url()}/chat/completions",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request_obj, timeout=90) as response:
            data = json.loads(response.read().decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:300]
        raise ValueError(f"AI 服务错误（{exc.code}）：{detail}")
    except urllib.error.URLError as exc:
        raise ValueError(f"AI 服务暂时无法连接：{exc.reason}")

    try:
        return data["choices"][0]["message"]["content"]
    except Exception as exc:  # noqa: BLE001
        raise ValueError("AI 返回格式异常") from exc
