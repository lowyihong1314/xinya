"""AI 出题助手：复用 BytePlus/Ark 聊天补全，根据提示生成选择题草稿。

原 backend/app/quiz_game/ai.py。前端在「编辑题库」右侧抽屉里输入提示词，这里调用模型
返回严格 JSON（{"questions":[{section, zh, en, options:[{zh,en}], answer}]}），
清洗后回传给前端预览、勾选后插入编辑器。

── 搬迁改了什么 ────────────────────────────────────────────────────────
只换了**取配置的方式**：``env_value("BYTEPLUS_*")`` → ``settings.*``（迁移期不再碰
os.environ）。取值口径逐字不变：

  · ``_ark_api_key``  原本是 ``BYTEPLUS_API_KEY or ARK_API_KEY`` 再 strip，
    ``settings.byteplus_key`` 这个 property 就是为了还原这条顺序才存在的。
  · ``_ark_base_url`` / ``_ark_model`` 的 pydantic 默认值与本文件的 DEFAULT_* 常量
    **逐字相同**，所以 ``or DEFAULT_*`` 这层兜底留着也不会改变结果 ——
    留着是防有人把配置项显式设成空串。

其余（SYSTEM_PROMPT 的每一个字、temperature=0.6、max_tokens=4000、90 秒超时、
``thinking: disabled``、清洗规则、错误文案）一个字节没动。

── ★ 几处「看着像 bug、但故意保留」 ────────────────────────────────────

  ① SYSTEM_PROMPT 里写的是「2 到 4 个选项」，而 ``_sanitize`` 放行到 ``MAX_OPTIONS``=6。
     提示词和校验不一致，但校验宽、提示严，模型多给两个也不会被丢掉。保持。

  ② ``_sanitize`` 里 ``if not (MIN <= len(options) <= MAX): options = options[:MAX]``
     ——「少于 2 个」时截断一下毫无作用（还是少于 2 个），只有「多于 6 个」那半边有效，
     紧接着的 ``if len(options) < MIN_OPTIONS: continue`` 才是真正把少选项的题丢掉的地方。
     写法绕，但结果正确，不改。

  ③ 答案下标越界时是**静默改成 0**（``answer = 0``），不是丢掉这道题。
     于是模型给错下标时会得到一道「答案是第一个选项」的题 —— 这是给人工复核用的草稿，
     前端本来就要勾选才入库，不拦。

  ④ 与 api/event/ark.py 是两份几乎一样的 Ark 客户端（那边 temperature=0.3、
     max_tokens=1600）。TODO(收尾): form 也搬完之后三份合并成一份放进 core，
     别让超时/温度参数在几个文件里各漂各的。
"""

import json
import re
import urllib.error
import urllib.request

from backend.core.config import settings

DEFAULT_ARK_BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3"
DEFAULT_ARK_MODEL = "seed-2-0-pro-260328"

MAX_GENERATE = 20
MIN_OPTIONS = 2
MAX_OPTIONS = 6

SYSTEM_PROMPT = (
    "你是佛学与通识课程的测验出题助手，帮老师快速拟定选择题及答案。\n"
    "每道题必须包含：\n"
    "- section：题目分组/章节（可留空字符串）\n"
    "- zh：中文题干（必填）\n"
    "- en：英文题干（尽量提供，可留空字符串）\n"
    "- options：2 到 4 个选项，每个选项是 {\"zh\":\"中文\",\"en\":\"English\"}\n"
    "- answer：正确选项的下标（从 0 开始，必须落在 options 范围内）\n\n"
    "要求：\n"
    "- 题目难度、主题、数量都要贴合用户的要求。\n"
    "- 选项要有迷惑性但只有一个正确答案，避免『以上皆是』这类模糊选项。\n"
    "- 只输出一个 ```json 代码块，格式为 {\"questions\":[ ... ]}，不要输出任何多余文字或解释。"
)


def _ark_api_key():
    # 原 ``(env_value("BYTEPLUS_API_KEY") or env_value("ARK_API_KEY") or "").strip()``。
    # settings.byteplus_key 就是这条取值顺序 + strip 的还原，见 core/config.py。
    return settings.byteplus_key


def _ark_base_url():
    return (settings.byteplus_base_url or DEFAULT_ARK_BASE_URL).strip()


def _ark_model():
    return (settings.byteplus_model or DEFAULT_ARK_MODEL).strip()


def _call_ark_chat(messages, temperature=0.6, max_tokens=4000):
    key = _ark_api_key()
    if not key:
        raise ValueError("AI 未配置（缺少 BytePlus/Ark API key）")

    payload = {
        "model": _ark_model(),
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
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


def _extract_questions(text):
    block = None
    fenced = re.search(r"```(?:json)?\s*(\{[\s\S]*\}|\[[\s\S]*\])\s*```", text or "")
    if fenced:
        block = fenced.group(1)
    else:
        bare = re.search(r"(\{[\s\S]*\"questions\"[\s\S]*\}|\[[\s\S]*\])", text or "")
        if bare:
            block = bare.group(1)
    if not block:
        return []
    try:
        obj = json.loads(block)
    except Exception:  # noqa: BLE001
        return []
    if isinstance(obj, dict):
        obj = obj.get("questions")
    return obj if isinstance(obj, list) else []


def _sanitize(raw_questions):
    cleaned = []
    for raw in raw_questions:
        if not isinstance(raw, dict):
            continue
        zh = str(raw.get("zh") or "").strip()
        if not zh:
            continue
        options = []
        for opt in raw.get("options") or []:
            if isinstance(opt, dict):
                opt_zh = str(opt.get("zh") or "").strip()
                opt_en = str(opt.get("en") or "").strip()
            else:
                opt_zh, opt_en = str(opt or "").strip(), ""
            if opt_zh or opt_en:
                options.append({"zh": opt_zh, "en": opt_en})
        if not (MIN_OPTIONS <= len(options) <= MAX_OPTIONS):
            options = options[:MAX_OPTIONS]
        if len(options) < MIN_OPTIONS:
            continue
        try:
            answer = int(raw.get("answer", 0))
        except (TypeError, ValueError):
            answer = 0
        if not (0 <= answer < len(options)):
            answer = 0
        cleaned.append(
            {
                "section": str(raw.get("section") or "").strip(),
                "zh": zh,
                "en": str(raw.get("en") or "").strip(),
                "options": options,
                "answer": answer,
            }
        )
    return cleaned


def generate_questions(prompt, count=5, set_title=""):
    prompt = str(prompt or "").strip()
    if not prompt:
        raise ValueError("请先输入出题要求")
    try:
        count = int(count)
    except (TypeError, ValueError):
        count = 5
    count = max(1, min(MAX_GENERATE, count))

    user_lines = [f"请生成 {count} 道选择题。"]
    if set_title:
        user_lines.append(f"这些题目会加入题库《{set_title}》，风格请保持一致。")
    user_lines.append(f"出题要求：{prompt}")

    content = _call_ark_chat(
        [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": "\n".join(user_lines)},
        ]
    )
    questions = _sanitize(_extract_questions(content))
    if not questions:
        raise ValueError("AI 没有返回可用的题目，请调整提示词后重试")
    return questions[:count]
