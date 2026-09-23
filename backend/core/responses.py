"""统一响应信封 + Flask 时代 jsonify 的兼容垫片。

设计见 docs/flask_to_fastAPI/13-API重新设计.md §3.2、04-兼容层设计.md §3。

**两套形状会长期并存，这不是没想清楚，是有意的：**

- 新形状（本文件的 ok / page / fail）：
  成功 ``{"data": …}``、列表 ``{"data": […], "page": {…}}``、
  失败 ``{"error": {"code", "message", "detail"}}``。
  新接口、MCP 暴露的接口一律用它 —— 前端 21 个 parseJson 能收敛成 1 个就靠形状恒定。

- 旧形状 ``{"status": "error", "message": "…"}``：
  现有 1127 处 jsonify 里有 509 处是它，前端 400 个调用点还在按它分支
  （有些甚至在匹配中文文案）。R1「信封统一」是**跟着 R3 一起按模块推进**的，
  不是某天一刀切 —— 所以这个文件必须同时供得上两种形状。
  ⚠️ 谁都不许为了「统一风格」去动另一边：改旧形状 = 前端某个页面静默不弹错误提示。

本模块不 import core.auth（auth 里的 _error_response 也在发旧形状，
两边各留一份实现是为了避免 import 环）。
"""

from __future__ import annotations

import dataclasses
import decimal
import json
import logging
import uuid
from datetime import date, datetime, timezone
from email.utils import format_datetime

from fastapi import HTTPException
from itsdangerous import BadSignature, URLSafeSerializer
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import JSONResponse, Response

from backend.core.config import settings

log = logging.getLogger("backend.core.responses")

__all__ = [
    # 顺手再导出一次 starlette 版的 HTTPException：注册异常处理器时两边从同一个模块取，
    # 就不会出现「注册到 fastapi.HTTPException 结果漏掉 404/405」那个坑。
    "StarletteHTTPException",
    "json_response",
    "ok",
    "page",
    "fail",
    "jsonify",
    "make_http_exception_handler",
    "encode_cursor",
    "decode_cursor",
    "clamp_limit",
    "DEFAULT_LIMIT",
    "MAX_LIMIT",
]

# 13 文档 §3.3 定下的列表约定，放在这里是因为 page() 的调用方都要用到同一组数字。
DEFAULT_LIMIT = 50
MAX_LIMIT = 200


# ─────────────────────────── 1. JSON 编码 ───────────────────────────


def _json_default(obj):
    """Flask ``DefaultJSONProvider.default`` 的等价实现。

    为什么必须抄这一份：1127 处 jsonify 里塞的大多是 ORM 行对象，里面有 date 和
    Decimal（金额）。Flask 会把它们转成 HTTP 日期串和字符串，而 starlette 的
    JSONResponse 用的是裸 json.dumps —— 直接抛 TypeError。
    不抄的话，切换当天会在几十个接口上随机炸 500，且**只有带日期/金额字段的那几行会炸**，
    冒烟测试很容易漏掉。

    （core/auth.py 里有一份同规则的实现，那边是为了会话 Cookie 的字节兼容。
      两边各留一份是故意的：responses 与 auth 互相 import 会成环。）
    """
    if isinstance(obj, date):
        # datetime 是 date 的子类，这一条同时管两者。
        # 朴素时间按 UTC 处理 —— 与 werkzeug.http_date 的假设一致，不能改成本地时区，
        # 否则前端拿到的时间会随服务器 TZ 漂移 8 小时。
        moment = obj if isinstance(obj, datetime) else datetime(obj.year, obj.month, obj.day)
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=timezone.utc)
        return format_datetime(moment.astimezone(timezone.utc), usegmt=True)
    if isinstance(obj, (decimal.Decimal, uuid.UUID)):
        # Decimal 转字符串而不是 float：金额转 float 会出现 0.1+0.2 那种尾数，
        # 前端再 toFixed(2) 就可能差一分钱。
        return str(obj)
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        return dataclasses.asdict(obj)
    if hasattr(obj, "__html__"):
        return str(obj.__html__())
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


class _CompatJSONResponse(JSONResponse):
    """带 Flask 兼容编码规则的 JSONResponse。"""

    def render(self, content) -> bytes:
        return json.dumps(
            content,
            # 不沿用 Flask 的 ensure_ascii=True：响应体是给 JSON.parse 的、不参与签名，
            # 中文不转义能省一半体积（JSON 规范本来就是 UTF-8）。
            ensure_ascii=False,
            # NaN / Infinity 不是合法 JSON，前端 JSON.parse 会直接抛。
            # 宁可在服务端炸出调用点，也不要让前端收到一个解析不了的响应体。
            allow_nan=False,
            separators=(",", ":"),
            default=_json_default,
        ).encode("utf-8")


def json_response(payload, status_code=200, headers=None):
    """本模块所有出口的底座。业务代码一般用 ok / page / fail，不直接调它。"""
    return _CompatJSONResponse(payload, status_code=int(status_code), headers=headers)


# ─────────────────────────── 2. 新信封 ───────────────────────────


def ok(data=None, status_code=200, headers=None):
    """成功（单体）：``{"data": …}``。

    data 恒定放在 "data" 键下，哪怕它是 null 或者一个裸字符串。
    前端 21 个 parseJson 能收敛成 1 个的前提是「形状与内容无关」——
    「单个对象就直接放外层省一层」这种写法会立刻把它变回两个。
    """
    return json_response({"data": data}, status_code=status_code, headers=headers)


def page(items, next_cursor=None, total=None, cursor=None, has_more=None,
         status_code=200, headers=None):
    """成功（列表）：``{"data": [...], "page": {...}}``。

    page 里的四个键恒存在（没有就是 null）—— 少一个键前端就得多写一个 if。

    - ``has_more`` 默认由 next_cursor 推导：**只有游标能证明还有下一页**。
      用 ``len(items) == limit`` 推是错的（正好整除时会多翻一次空页）；
      用 total 推更错 —— total 可能是 None，也可能是另一时刻的近似值。
    - ``total`` 允许为 None。别为了把这个键填满去跑 COUNT(*)：大表上它经常比正文还慢，
      而绝大多数列表页并不需要精确总数。
    """
    rows = list(items or [])
    return json_response(
        {
            "data": rows,
            "page": {
                "cursor": cursor,
                "next_cursor": next_cursor,
                "has_more": bool(next_cursor) if has_more is None else bool(has_more),
                "total": total,
            },
        },
        status_code=status_code,
        headers=headers,
    )


def fail(code, message, status=400, detail=None, headers=None):
    """失败：``{"error": {"code", "message", "detail"}}``。

    - ``code`` 是**稳定的机器可读串**（permission_denied / not_found / invalid_cursor…），
      前端和 MCP 按它分支。它一旦发布就等于 API 的一部分，改名是破坏性变更。
    - ``message`` 是给人看的中文，随时可以改文案 —— 前提是没人拿它做匹配，
      这正是新信封要有 code 的原因（旧形状只有 message，所以文案改不动）。
    - ⚠️ ``detail`` 会原样发给客户端：不要把 SQL、堆栈、别人的个资塞进去。
    """
    body = {"error": {"code": str(code), "message": str(message), "detail": detail}}
    return json_response(body, status_code=int(status), headers=headers)


def clamp_limit(value, default=DEFAULT_LIMIT, maximum=MAX_LIMIT):
    """把外部传进来的 limit 收进 [1, maximum]，解析不了就用默认值。

    上限是硬的：没有上限的 limit 等于把「一次吐一万行」的老问题原样搬过来，
    而 MCP 那边一次工具调用就能撑爆 LLM 的上下文（见 14 文档）。
    """
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    if number < 1:
        return default
    return min(number, maximum)


# ─────────────────────────── 3. 旧形状垫片 ───────────────────────────


def jsonify(obj=None, /, **kwargs):
    """【过渡件 · 新代码不要用】Flask ``jsonify`` 的等价物。

    存在的唯一理由：1127 处调用点不可能一次改完。新代码请直接用 ok / page / fail，
    或者 ``JSONResponse(...)``。

    语义与 Flask 对齐（含边角）：
      ``jsonify(d)`` → d；``jsonify(a=1)`` → {"a": 1}；``jsonify()`` → null；
      位置参数和关键字参数**不能同时给**（Flask 也是 TypeError）。
      ``obj`` 是位置参数专用（``/``），否则 ``jsonify(obj=1)`` 的含义会从
      「返回 {"obj": 1}」悄悄变成「返回 1」。

    ⚠️ **``return jsonify(...), 400`` 这种元组写法 FastAPI 不认**（672 处在用）。
      搬到 FastAPI 时要逐处改成 ``fail(...)`` 或 ``JSONResponse(payload, status_code=400)``。
      没法 sed —— 状态码的位置和上下文各不相同。详见 04 文档 §3。
    """
    if obj is not None and kwargs:
        raise TypeError("jsonify() 只能二选一：位置参数或关键字参数")
    payload = kwargs if (obj is None and kwargs) else obj
    return json_response(payload)


# HTTP 状态码 → 新信封里的机器码。只列我们真正会返回的那些，其余按 4xx/5xx 兜底。
_CODE_BY_STATUS = {
    400: "bad_request",
    401: "unauthorized",
    403: "permission_denied",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    413: "payload_too_large",
    415: "unsupported_media_type",
    422: "unprocessable_entity",
    429: "rate_limited",
    500: "internal_error",
    502: "bad_gateway",
    503: "service_unavailable",
    504: "gateway_timeout",
}


def _code_for_status(status):
    if status in _CODE_BY_STATUS:
        return _CODE_BY_STATUS[status]
    return "client_error" if 400 <= status < 500 else "server_error"


def _legacy_error_body(detail):
    """渲染成旧形状 ``{"status": "error", "message": …}``。"""
    if isinstance(detail, dict):
        # 调用点自己已经拼好了形状（core/auth.py 的几条权限出口就是这样），原样透传，
        # 免得在外面再包一层让前端多剥一次。
        if "status" in detail or "error" in detail:
            return detail
        message = detail.get("message")
        if message is not None:
            body = {"status": "error", "message": message}
            # 多带一个 code 对老前端无害（它只读 message），新前端可以提前用起来。
            if detail.get("code"):
                body["code"] = detail["code"]
            return body
    if detail is None:
        return {"status": "error", "message": "服务器错误"}
    return {"status": "error", "message": detail if isinstance(detail, str) else str(detail)}


def _new_error_body(detail, status):
    """渲染成新信封 ``{"error": {...}}``。"""
    if isinstance(detail, dict):
        inner = detail.get("error")
        if isinstance(inner, dict):
            return detail
        return {
            "error": {
                "code": str(detail.get("code") or _code_for_status(status)),
                "message": str(detail.get("message") or _code_for_status(status)),
                "detail": detail.get("detail"),
            }
        }
    return {
        "error": {
            "code": _code_for_status(status),
            "message": str(detail) if detail is not None else _code_for_status(status),
            "detail": None,
        }
    }


def make_http_exception_handler(new_envelope=None):
    """造一个 HTTPException 处理器；**默认渲染旧形状**。

    为什么默认是旧形状：``raise HTTPException(404)`` 不只出现在我们的代码里 ——
    路由层找不到路径、方法不匹配时也会抛它。如果这个处理器直接上新信封，
    那么在 R1 还没推到的模块上，一次 404 会让老前端拿到一个它不认识的形状，
    表现是「转圈不停」或「报错提示是空白」。信封统一是随 R3 **按模块**推进的，
    所以这里必须能「一半新、一半旧」。

    参数 ``new_envelope`` 是 ``(request) -> bool``，返回 True 的请求改用新信封：

        from starlette.exceptions import HTTPException as StarletteHTTPException
        from backend.core.urls import base_path

        app.add_exception_handler(
            StarletteHTTPException,
            make_http_exception_handler(
                lambda r: r.url.path.startswith(f"{base_path(r)}/v1")
            ),
        )

    ★ 一定要注册在 ``starlette.exceptions.HTTPException`` 上，不是 ``fastapi.HTTPException``：
      404 / 405 是路由层抛的 starlette 版，只注册 fastapi 版会漏掉它们
      （fastapi 版是 starlette 版的子类，注册父类两边都覆盖得到）。

    ⚠️ 这个处理器不管 ``RequestValidationError``（422）—— 那是 FastAPI 自己的形状，
      要统一得另外注册一个；在老路由还没上 pydantic 模型之前它基本不会触发。
    """

    async def http_exception_handler(request, exc):
        status = int(getattr(exc, "status_code", 500))
        headers = getattr(exc, "headers", None)
        # 1xx / 204 / 304 按规范不能带正文。带了的话有些代理会判为坏响应直接掐连接，
        # 而浏览器那边只表现为「请求失败」，极难排查。
        if status < 200 or status in (204, 304):
            return Response(status_code=status, headers=headers)
        detail = getattr(exc, "detail", None)
        use_new = False
        if callable(new_envelope):
            try:
                use_new = bool(new_envelope(request))
            except Exception:
                # 判定函数自己炸了不能把异常处理器也带崩 —— 那会变成 500 套 500。
                log.exception("new_envelope 判定失败，回落旧形状")
                use_new = False
        body = _new_error_body(detail, status) if use_new else _legacy_error_body(detail)
        return json_response(body, status_code=status, headers=headers)

    return http_exception_handler


# ─────────────────────────── 4. 游标分页 ───────────────────────────

# 盐单独写死在这里而不是进配置：它只是「这串签名是给游标用的」的域分隔符，
# 没有保密价值，换它只会让在飞的游标全部失效。与 auth 的各种盐同理。
_CURSOR_SALT = "xinya-cursor-v1"

# URLSafeSerializer = 紧凑 JSON + URL 安全 base64 + HMAC-SHA1 签名，
# 不引入新依赖（itsdangerous 本来就在，会话 Cookie 用的就是它）。
_cursor_serializer = URLSafeSerializer(settings.secret_key, salt=_CURSOR_SALT)


def encode_cursor(payload) -> str:
    """把「下一页从哪继续」打包成一串不透明文本。

    内容通常是上一行的排序键，例如 ``{"id": 8123, "created_at": "2026-09-23T10:00:00"}``。

    ★ **必须签名。** 游标会原样交到客户端手里再传回来：不签的话它可以被改成任意值 ——
      轻则构造出类型不对的值让 SQL 报错（PG 比 MySQL 严格，会直接抛而不是隐式转换），
      重则把游标里的租户/用户约束（``{"user_id": 我}``）改成别人的 id 直接翻到别人的数据。
      签了之后服务端可以无条件信任解出来的内容，调用点不必再逐字段校验。

    ⚠️ 值必须是 JSON 原生类型 —— itsdangerous 这条路径没有 default 钩子，
      datetime 请先 ``.isoformat()``、Decimal 先 ``str()``。
    ⚠️ 签名用的是 SECRET_KEY：改 SECRET_KEY 会让所有在飞的游标失效（表现为翻页回到第一页）。
      这与「改 SECRET_KEY 全员掉线」是同一量级的事，可以接受。

    建议把筛选条件的指纹一起放进 payload（如 ``{"q": hash(filters), ...}``），
    这样换了筛选条件还沿用旧游标时能被识别出来，而不是给出一页语义错乱的结果。
    """
    if payload is None:
        payload = {}
    if not isinstance(payload, dict):
        raise TypeError("游标内容只接受 dict")
    return _cursor_serializer.dumps(payload)


def decode_cursor(raw, strict=False):
    """解游标；解不开返回 None（= 从头开始），``strict=True`` 时改抛 400。

    默认容错的理由：游标出现在 URL 里，会被用户收藏、被聊天软件截断、会在我们轮换
    SECRET_KEY 之后失效。这些都**不是攻击**，回到第一页比甩一个 400 体验好得多。

    真正需要严格的场景（对账导出、MCP 工具翻页）传 ``strict=True`` ——
    那里「悄悄从头开始」会变成一份带重复行的报表，比报错更糟。
    """
    if not raw:
        return None
    try:
        value = _cursor_serializer.loads(str(raw))
    except (BadSignature, ValueError, TypeError) as exc:
        # 只记异常类型，不记 raw 本体：里面可能有内部主键，日志会流到 journalctl。
        log.info("游标解析失败（%s），按第一页处理", type(exc).__name__)
        if strict:
            raise HTTPException(
                status_code=400,
                detail={"code": "invalid_cursor", "message": "分页游标无效或已过期，请从第一页重新开始。"},
            ) from None
        return None
    if not isinstance(value, dict):
        # 签名过但形状不对：只可能是我们自己旧版本写出来的游标，同样按第一页处理。
        log.info("游标内容不是 dict，按第一页处理")
        return None
    return value
