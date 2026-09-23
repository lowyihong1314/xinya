"""认证垫片：替掉 Flask-Login。

341 处 ``current_user.xxx``、168 处 ``@login_required``、193 处权限装饰器要原样能跑，
所以这里不是「重新设计认证」，而是**照着 flask_login 0.6.3 的既有行为重写一遍**。

有三条红线，改动前请先读完：

1. ★ **会话 Cookie 的格式必须与 Flask 逐字节兼容。**
   格式 = itsdangerous ``URLSafeTimedSerializer`` + 盐 ``cookie-session`` +
   Flask 的 ``TaggedJSONSerializer`` + ``key_derivation="hmac"`` + sha1 签名 + zlib。
   **换格式（比如改成 JWT、换盐、换 digest）= 线上所有已登录用户和 APK 全员掉线。**
   本项目的会话里有一个 128 字符的 ``_id``，payload 恒大于 zlib 压缩阈值，
   所以实际发出去的 Cookie **总是压缩过的**（base64 前带一个 "."）——
   解码端必须走 itsdangerous 本身，不能自己拼 base64。
   为了不 import flask，下面自己复刻了一份 TaggedJSONSerializer；复刻的目标是
   **字节一致**，不是「更好」，所以标签键、标签顺序、json.dumps 的参数都不许动。

2. ★ **两套未登录行为必须并存，不要「顺手统一」。**
   ``permission_required``（53 处）未登录返回 **500**，文案「无法验证用户权限，请联系管理员。」；
   ``permission_required_any``（140 处）内层套了 login_required，未登录返回 **401 unauthorized**。
   前端对这两个码的处理不同，统一了就是行为变更。

3. ★ **Bearer 与会话 Cookie 是两套互不相干的序列化器，不能抽公共函数。**
   会话 Cookie：盐 ``cookie-session`` + TaggedJSON + ``key_derivation="hmac"``。
   Bearer（见 app/mobile/session_service.py）：盐 ``xinya-mobile-session`` +
   itsdangerous 默认（``_CompactJSON`` + ``django-concat``）。
   两边参数只要串一个字符，对应那一侧的全部在飞令牌立刻失效。
   所以 Bearer 这条路径本文件**只负责取 header**，校验一律回调 session_service。

接中间件的方式（顺序要紧）：

    app.add_middleware(AuthContextMiddleware)   # 见文件末尾
    # 或者自己写：
    #   user = await resolve_user(request)      # 必须在 async 侧 set ContextVar
    #   try: ... finally: release_auth_context(request)

    ⚠️ **DB 会话的 scope 中间件必须在认证中间件的外层**（先设 scope，再解析用户）。
    认证要查库，如果查在 DB scope 之外，用户对象属于另一个 Session，
    视图里一访问 lazy 属性就是 DetachedInstanceError —— 而 permission_required
    会把这个异常吞掉变成 500，日志里只留一行「[权限错误]」，极难排查。

    ⚠️ 不要在 sync 视图里调 ``set_current_user()``：Starlette 把 sync 视图丢进线程池，
    contextvars 是**拷贝进去**的，线程里 set 不会传回来。写入一律在 async 侧。
"""

from __future__ import annotations

import base64
import dataclasses
import decimal
import hashlib
import hmac
import inspect
import json
import uuid as _uuid
from contextvars import ContextVar, Token
from datetime import date, datetime, timedelta, timezone
from email.utils import format_datetime, parsedate_to_datetime
from functools import wraps
from urllib.parse import unquote

from fastapi import HTTPException
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from backend.core.config import settings

__all__ = [
    "current_user",
    "UserMixin",
    "AnonymousUser",
    "login_required",
    "permission_required",
    "permission_required_any",
    "permission_denied_response",
    "unauthorized_response",
    "get_current_user_permissions",
    "current_user_permission_names",
    "current_user_has_any_permission",
    "resolve_user",
    "set_current_user",
    "reset_current_user",
    "release_auth_context",
    "current_request",
    "get_current_user",
    "get_current_user_optional",
    "require_permission",
    "AuthError",
    "auth_error_handler",
    "AuthContextMiddleware",
    "load_session_cookie",
    "dump_session_cookie",
    "build_remember_token",
    "parse_remember_token",
    "set_login_cookies",
    "clear_login_cookies",
    "SESSION_COOKIE_NAME",
    "REMEMBER_COOKIE_NAME",
]


# ─────────────────────────── 常量（都是线上既有值，别改）───────────────────────────

# ★ 从 settings 读，不要写死。"session" 只是今天的值：11 文档计划改名 xinya_session
# （同域名多项目时防止 Cookie 互相覆盖）。写死的后果是改了配置不生效 ——
# 现象是「改完名字谁也登不上，而两边日志都正常」。
# 用模块常量而不是每次现读：core.config 的约定本来就是「改配置必须重启」，
# 进程内这个值不会变，而 _cookie_values() 在每请求的热路径上。
SESSION_COOKIE_NAME = settings.session_cookie_name
SESSION_COOKIE_SALT = "cookie-session"   # Flask SecureCookieSessionInterface.salt
REMEMBER_COOKIE_NAME = "remember_token"  # flask_login COOKIE_NAME
EXEMPT_METHODS = {"OPTIONS"}             # flask_login 对预检请求的豁免

# 响应文案：三条都是前端可能在做字符串匹配的字面量，改一个字都算行为变更。
UNAUTHORIZED_MESSAGE = "unauthorized"
PERMISSION_ERROR_MESSAGE = "无法验证用户权限，请联系管理员。"


def _secret_key() -> str:
    """会话 Cookie 与 remember_token 的签名密钥。

    改这个值 = 全员掉线，所以它只有一个来源（system_config.env → settings），
    绝不允许在代码里兜底成随机值：那会变成「重启一次全员掉线」且没人发现。
    """
    key = settings.secret_key
    if not key:
        raise RuntimeError("SECRET_KEY 未配置：会话 Cookie 无法签名/验签")
    return key


def _session_max_age() -> int:
    """会话 Cookie 的有效期（秒）。对应 Flask 的 PERMANENT_SESSION_LIFETIME=7 天。"""
    # 不写 getattr(..., 7) 这种兜底：字段在 core.config 里是必然存在的，
    # 兜底只会把「字段被改名/写错」变成静默回落到 7 天，出事时反而查不出来。
    return int(settings.session_lifetime_days) * 24 * 3600


def _remember_max_age() -> int:
    """remember_token 的有效期（秒）。

    与会话 Cookie 分开取：config 里本来就是两个键（REMEMBER_COOKIE_DAYS 与
    SESSION_LIFETIME_DAYS）。今天都是 7，看不出区别，但绑死等于把
    REMEMBER_COOKIE_DAYS 变成一个「写了不生效」的假配置。
    """
    return int(settings.remember_cookie_days) * 24 * 3600


def _cookie_security():
    """Cookie 的安全属性，一律从 settings 取，返回 (secure, httponly, samesite)。

    ★ 不能写死 secure=True：本地开发跑 http://127.0.0.1:5102 时浏览器会直接丢弃
    带 Secure 的 Cookie —— 现象是「登录接口返回 200，但下一个请求仍然 401」，
    而且 Set-Cookie 头在 DevTools 里看着完全正常，极难往这上面想。
    另外 SameSite=None 必须配 Secure（新版浏览器否则同样丢弃），
    所以关掉 Secure 时顺手把 SameSite 降成 lax，免得配出一个两头都不生效的组合。
    """
    secure = bool(settings.session_cookie_secure)
    samesite = str(settings.session_cookie_samesite or "lax").lower()
    if not secure and samesite == "none":
        samesite = "lax"
    # 大小写要还原成 Flask 发出去的那个写法（None / Lax / Strict）。
    # 规范说属性值不分大小写，主流浏览器也确实不分，但历史上有几个旧 WebView
    # 只认首字母大写的 "None"，不认的就退回 Strict —— 那正好就是「APK 跨站请求
    # 不带 Cookie」这种最难复现的掉线。对齐零成本，不赌。
    canonical = {"none": "None", "lax": "Lax", "strict": "Strict"}
    return secure, bool(settings.session_cookie_httponly), canonical.get(samesite, "Lax")


def _cookie_path() -> str:
    """Cookie 的 Path。

    多项目共用 utbabuddha.com 这一个域名时，各项目的会话 Cookie **同名**（都叫 session）。
    如果都写 path=/，浏览器只保留最后写的那一个 —— 表现为「在 A 项目登录后，
    B 项目就把人踢下线」，而且两边日志都正常，查不出来。
    所以 Path 必须收窄到本项目的 BASE_PATH。
    """
    # settings.session_cookie_path 是配置层归一化过的值（"" → "/"），优先用它，
    # 免得两边各归一化一次、哪天不一致了就变成「登录后一刷新就掉线」。
    path = getattr(settings, "session_cookie_path", None)
    if path:
        return str(path)
    path = str(getattr(settings, "app_base_path", "") or "").rstrip("/")
    return path or "/"


# ─────────────────────── 1. 会话 Cookie 编解码（与 Flask 同格式）───────────────────────


def _http_date(value: datetime) -> str:
    """复刻 werkzeug.http.http_date：naive datetime 按 UTC 处理。

    只在会话里真的塞了 datetime 时才会走到（本项目目前没有），保留是为了
    「Flask 写的 Cookie 一定解得开」这条兼容承诺不留缺口。
    """
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return format_datetime(value.astimezone(timezone.utc), usegmt=True)


def _parse_http_date(value):
    try:
        return parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None


def _json_default(obj):
    """对齐 Flask DefaultJSONProvider.default 的兜底转换。"""
    if isinstance(obj, date):
        return _http_date(datetime(obj.year, obj.month, obj.day))
    if isinstance(obj, (decimal.Decimal, _uuid.UUID)):
        return str(obj)
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        return dataclasses.asdict(obj)
    if hasattr(obj, "__html__"):
        return str(obj.__html__())
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


class _TaggedJSON:
    """flask.json.tag.TaggedJSONSerializer 的最小复刻。

    为什么要自己抄一遍：垫片的目的就是拆掉 flask 依赖，但 Cookie 的字节必须一模一样。
    标签键（" di" / " t" / " b" / " m" / " u" / " d"）、判定顺序、json.dumps 的
    ``sort_keys=True, ensure_ascii=True, separators=(",", ":")``
    都是 Flask 那边的既定值 —— 动任何一个，旧 Cookie 就解不开或者新 Cookie 换了字节。
    """

    # 顺序必须与 Flask 的 default_tags 一致：dict 的特判要排在普通 dict 前面，
    # 否则 {" t": ...} 这种「长得像标签」的业务数据会被错当成标签解回来。
    TAG_KEYS = (" di", " t", " b", " m", " u", " d")

    def tag(self, value):
        if isinstance(value, dict):
            if len(value) == 1:
                only = next(iter(value))
                if only in self.TAG_KEYS:
                    # TagDict：给键加 "__" 后缀转义，避免和真标签撞车
                    return {" di": {f"{only}__": self.tag(value[only])}}
            return {k: self.tag(v) for k, v in value.items()}
        if isinstance(value, tuple):
            return {" t": [self.tag(item) for item in value]}
        if isinstance(value, list):
            return [self.tag(item) for item in value]
        if isinstance(value, bytes):
            return {" b": base64.b64encode(value).decode("ascii")}
        if callable(getattr(value, "__html__", None)):
            return {" m": str(value.__html__())}
        if isinstance(value, _uuid.UUID):
            return {" u": value.hex}
        if isinstance(value, datetime):
            return {" d": _http_date(value)}
        return value

    def _untag(self, value):
        if len(value) != 1:
            return value
        key = next(iter(value))
        if key not in self.TAG_KEYS:
            return value
        inner = value[key]
        if key == " di":
            inner_key = next(iter(inner))
            return {inner_key[:-2]: inner[inner_key]}
        if key == " t":
            return tuple(inner)
        if key == " b":
            return base64.b64decode(inner)
        if key == " m":
            # Markup 退化成 str：不为了这个把 markupsafe 拖进 core。
            # 会话里没人存 Markup；真存了也只影响「是否自动转义」，不影响登录态。
            return str(inner)
        if key == " u":
            return _uuid.UUID(inner)
        if key == " d":
            return _parse_http_date(inner)
        return value

    def _untag_scan(self, value):
        if isinstance(value, dict):
            value = {k: self._untag_scan(v) for k, v in value.items()}
            return self._untag(value)
        if isinstance(value, list):
            return [self._untag_scan(item) for item in value]
        return value

    def dumps(self, value):
        return json.dumps(
            self.tag(value),
            separators=(",", ":"),
            sort_keys=True,
            ensure_ascii=True,
            default=_json_default,
        )

    def loads(self, value):
        return self._untag_scan(json.loads(value))


_TAGGED_JSON = _TaggedJSON()


def _session_serializer() -> URLSafeTimedSerializer:
    """会话 Cookie 的签名器。参数与 flask/sessions.py 的 SecureCookieSessionInterface 一致。

    zlib 压缩不用自己做：URLSafeSerializerMixin 会在压缩更短时自动压，
    并在 base64 前加一个 "."，读的时候也自动识别。
    """
    return URLSafeTimedSerializer(
        _secret_key(),
        salt=SESSION_COOKIE_SALT,
        serializer=_TAGGED_JSON,
        signer_kwargs={"key_derivation": "hmac", "digest_method": hashlib.sha1},
    )


def load_session_cookie(raw, *, max_age=None) -> dict:
    """解一个会话 Cookie 值；验签失败/过期一律当没登录（返回 {}），不抛。"""
    if not raw:
        return {}
    # 构造放在 try 外面：密钥没配是配置错误，要响亮地炸，不能被当成「没登录」吞掉。
    serializer = _session_serializer()
    try:
        data = serializer.loads(raw, max_age=_session_max_age() if max_age is None else max_age)
    except (BadSignature, SignatureExpired):
        return {}
    except Exception as exc:
        # zlib/JSON 层面的损坏也按未登录处理，但要留一行日志 —— 静默会让排查无从下手。
        print(f"[会话] Cookie 解析失败: {exc}")
        return {}
    return data if isinstance(data, dict) else {}


def dump_session_cookie(data: dict) -> str:
    """把会话字典签成 Cookie 值（Flask 读得回来，回滚时不掉线）。"""
    return _session_serializer().dumps(dict(data))


# ─────────────────────── 2. remember_token 编解码（flask_login 同格式）───────────────────────


def _remember_digest(user_id: str) -> str:
    # flask_login utils._cookie_digest：密钥按 latin1 编码（不是 utf-8），别改。
    return hmac.new(
        _secret_key().encode("latin1"), user_id.encode("utf-8"), hashlib.sha512
    ).hexdigest()


def build_remember_token(user_id) -> str:
    user_id = str(user_id)
    return f"{user_id}|{_remember_digest(user_id)}"


def parse_remember_token(raw):
    """校验 remember_token 并取出 user_id；不合法返回 None。

    注意这个值里**没有时间戳**，过期完全靠浏览器的 Expires —— 也就是说
    一个被导出保存的 remember_token 在密钥不变的前提下是永久有效的。
    这是 flask_login 的既有设计，垫片阶段原样保留。
    """
    if not raw or "|" not in raw:
        return None
    user_id, _, digest = raw.rpartition("|")
    if not user_id or not digest:
        return None
    if not hmac.compare_digest(_remember_digest(user_id), digest):
        return None
    return user_id


# ─────────────────────────── 3. current_user 代理 ───────────────────────────


class UserMixin:
    """给 models.user_data.User 用，替掉 flask_login.UserMixin。"""

    @property
    def is_authenticated(self):
        return True

    @property
    def is_active(self):
        # User 模型没覆盖它，历史上恒为 True（所以登录从不会因为「账号停用」失败）。
        return True

    @property
    def is_anonymous(self):
        return False

    def get_id(self):
        # 必须是 str：会话里的 _user_id 是字符串，写成 int 会让 Cookie 字节变形。
        return str(self.id)


class AnonymousUser:
    """未登录时 current_user 指向的对象。

    与 flask_login 的 AnonymousUserMixin 有一处**有意的差异**：
    未定义的属性这里返回 None，flask_login 会抛 AttributeError。
    放宽的理由是代码里绝大多数匿名分支写的是 getattr(current_user, "x", None)，
    真抛异常反而会把「未登录」变成 500。代价是打错属性名不再报错，
    这条差异要写进 07 的「已知允许差异」。
    """

    __slots__ = ()

    is_authenticated = False
    is_active = False
    is_anonymous = True
    id = None
    username = None

    def get_id(self):
        return None

    def __getattr__(self, name):
        # 双下划线属性照常抛 AttributeError：copy/pickle/inspect 都靠「取不到」来判断
        # 对象能力，这里返回 None 会让它们走进错误分支。
        if name.startswith("__") and name.endswith("__"):
            raise AttributeError(name)
        return None

    def __setattr__(self, name, value):
        # 匿名对象是模块级单例，允许写就会跨请求串场（A 请求写的值 B 请求读得到）。
        # 宁可炸得响一点。
        raise AttributeError(f"未登录用户不能写属性 {name}（current_user 此时是匿名对象）")

    def __repr__(self):
        return "<AnonymousUser>"


ANONYMOUS_USER = AnonymousUser()

_current_user: ContextVar = ContextVar("current_user", default=None)
_current_request: ContextVar = ContextVar("current_request", default=None)


class _CurrentUserProxy:
    """代理到 ContextVar，让 341 处 ``current_user.xxx`` 一个字不改地继续工作。"""

    __slots__ = ()

    def _get_current_object(self):
        user = _current_user.get()
        return ANONYMOUS_USER if user is None else user

    def __getattr__(self, name):
        return getattr(self._get_current_object(), name)

    def __setattr__(self, name, value):
        # app/user_control/routes.py:701-705 有 current_user.reject_local = True 这种写法，
        # 代理必须把写操作透传到真正的 ORM 对象上，否则那几行会静默失效（改了没保存）。
        setattr(self._get_current_object(), name, value)

    def __delattr__(self, name):
        delattr(self._get_current_object(), name)

    def __bool__(self):
        # 与 flask_login 的差异：flask_login 的代理即使匿名也是 truthy。
        # 这里 `if current_user:` == 「已登录」。全项目当前零处裸用（已 grep），
        # 改成这样是为了让新代码的直觉写法是对的。
        return _current_user.get() is not None

    def __eq__(self, other):
        return self._get_current_object() == other

    def __hash__(self):
        return hash(self._get_current_object())

    @property
    def __class__(self):
        # werkzeug 的 LocalProxy 也是这么干的。项目里有 8 处把 current_user 整个当参数
        # 传下去（record_signature / _save_claim_attachment / revoke_all_mobile_sessions…），
        # 不转发 __class__ 的话，下游哪天写个 isinstance(user, User) 就会无声地走错分支。
        return type(self._get_current_object())

    def __str__(self):
        # 不转发的话 f"{current_user}" 会印出 <CurrentUser ...>，
        # 这种字符串一旦被写进日志或快照 JSON，事后根本认不出是谁。
        return str(self._get_current_object())

    def __repr__(self):
        return f"<CurrentUser {self._get_current_object()!r}>"


current_user = _CurrentUserProxy()


def set_current_user(user) -> Token:
    """把用户绑到当前 context。**只能在 async 侧调**（见模块 docstring）。"""
    return _current_user.set(user)


def reset_current_user(token: Token) -> None:
    _current_user.reset(token)


def current_request():
    """当前请求对象；不在请求内返回 None。

    留这个口子是给 login_required 判 OPTIONS 用的，
    session 垫片要实现 has_request_context() 也可以建在它上面。
    """
    return _current_request.get()


# ─────────────────────────── 4. 用户解析 ───────────────────────────


def _cookie_values(request: Request, name: str):
    """从原始 Cookie 头里取出**所有**同名 Cookie。

    为什么不用 request.cookies：那是个 dict，同名只留一个。
    改 Cookie Path（/ → /UTBA_DEMO）的过渡期里，浏览器会同时持有两个都叫 session 的
    Cookie 并一起发上来，dict 取到哪个是未定义的 —— 表现为「随机掉线」。
    这里全部取出来逐个试签，谁验得过用谁。
    """
    header = request.headers.get("cookie") or ""
    values = []
    for chunk in header.split(";"):
        key, sep, value = chunk.partition("=")
        if sep and key.strip() == name:
            values.append(unquote(value.strip().strip('"')))
    return values


def read_session(request: Request) -> dict:
    """读出本请求的会话字典（验签通过的第一个）。结果挂在 request.state 上避免重复解。"""
    cached = getattr(request.state, "session_data", None)
    if cached is not None:
        return cached
    data = {}
    for raw in _cookie_values(request, SESSION_COOKIE_NAME):
        data = load_session_cookie(raw)
        if data:
            break
    try:
        request.state.session_data = data
    except Exception:
        pass
    return data


def load_user(user_id):
    """对应 flask_login 的 user_loader。"""
    from backend.models.user_data import User  # 延迟 import：core 不该在导入期拉起 models

    try:
        ident = int(user_id)
    except (TypeError, ValueError):
        # ★ 与现状的差异：现在 app/auth.py 是裸 int(user_id)，被篡改的 Cookie 会抛
        # ValueError 且 flask_login 不接 → 500。这里改成「解析不了就当匿名」。
        # 理由：在 FastAPI 里这个异常发生在中间件，会变成没有 JSON 体的裸 500，
        # 比 Flask 那时更难查。这是一处**有意识的修正**，已记入交接说明。
        return None
    return User.query.get(ident)


def load_user_from_bearer(request: Request):
    """APK 的 Bearer 令牌。校验逻辑一律回调 session_service，这里只负责取 header。"""
    header = (request.headers.get("authorization") or "").strip()
    if not header.lower().startswith("bearer "):
        return None

    access_token = header[7:].strip()
    if not access_token:
        return None

    try:
        # 延迟 import：session_service 会拉起 models，且它自己还在迁移中。
        from backend.core.mobile_session import load_user_from_access_token

        return load_user_from_access_token(access_token)
    except Exception as exc:
        print(f"[移动端登录] Bearer token 验证失败: {exc}")
        return None


def load_user_from_request(request: Request):
    """解析请求里的身份。**同步函数**，要查库，由 resolve_user 丢进线程池跑。

    ★ 顺序说明（这是一处行为变更，别当成照搬）：
      这里是 Bearer → 会话 Cookie → remember_token。
      flask_login 0.6.3 的真实顺序是 会话 Cookie → remember_token → Bearer，
      而且 remember_token 与 Bearer 是 if/elif：**只要请求带着 remember_token，
      request_loader 就一次都不会被调用**。APK 登录时 Cookie 和 Bearer 同时下发，
      所以今天线上 APK 走的其实是 Cookie 那条路。
      提到最前的收益：APK 的身份重新由 Bearer 决定，login_version 的校验
      （改密码后踢下线）才真的生效 —— Cookie 那条路至今没人校验 login_version。
      代价：APK 的 access_token 过期（30 分钟）后会回落到 Cookie，
      两条路解出的用户如果不是同一个人（换账号登录但旧 Cookie 还在），结果会变。
    """
    user = load_user_from_bearer(request)
    if user is not None:
        return user

    data = read_session(request)
    user_id = data.get("_user_id")
    if user_id is not None:
        user = load_user(user_id)
        if user is not None:
            return user

    # session["_remember"] == "clear" 是 flask_login 的登出标记，要尊重它，
    # 否则「登出后又被 remember_token 自动登回去」。
    if data.get("_remember") != "clear":
        for raw in _cookie_values(request, REMEMBER_COOKIE_NAME):
            remembered_id = parse_remember_token(raw)
            if remembered_id:
                user = load_user(remembered_id)
                if user is not None:
                    return user

    return None


def _has_credentials(request: Request) -> bool:
    """本请求是否带了任何一种身份凭据。

    ★ 为什么要这一步：flask_login 是惰性的（访问 current_user 时才加载），
    而中间件是每请求都跑。照搬会让全部匿名流量 —— 公开页、CORS 预检、健康检查、
    nginx 的 auth_request —— 每次平白多一趟 DB 往返，直接吃掉 PG 那 100 条连接的余量。
    这里只看 header，判断与 load_user_from_request 的三条路径完全等价：
    没有 Authorization、没有 session、没有 remember_token，那边也只会返回 None。
    """
    if (request.headers.get("authorization") or "").strip():
        return True
    header = request.headers.get("cookie") or ""
    if not header:
        return False
    return any(
        chunk.partition("=")[0].strip() in (SESSION_COOKIE_NAME, REMEMBER_COOKIE_NAME)
        for chunk in header.split(";")
    )


async def resolve_user(request: Request):
    """中间件入口：解析身份并绑到 ContextVar。

    查库是同步的，丢进线程池以免堵住事件循环；ContextVar 的 set 留在 async 侧 ——
    在线程里 set 不会传回来（线程拿到的是 context 的拷贝）。
    """
    request_token = _current_request.set(request)
    try:
        if _has_credentials(request):
            user = await run_in_threadpool(load_user_from_request, request)
        else:
            user = None
    except Exception:
        _current_request.reset(request_token)
        raise
    user_token = set_current_user(user)
    request.state.auth_tokens = (user_token, request_token)
    return user


def release_auth_context(request: Request) -> None:
    """请求结束时清场。不清会让线程池复用的 context 带着上一个用户 —— 即串号。"""
    tokens = getattr(request.state, "auth_tokens", None)
    if not tokens:
        return
    user_token, request_token = tokens
    request.state.auth_tokens = None
    try:
        reset_current_user(user_token)
    finally:
        _current_request.reset(request_token)


def _merge_vary_cookie(headers: list) -> None:
    """往响应头里并进 ``Vary: Cookie``（Flask 的 save_session 每次都会加）。

    下发了 Set-Cookie 却不声明 Vary，中间任何一层缓存（nginx proxy_cache / CDN）
    都可能把甲的响应连同甲的 Set-Cookie 一起喂给乙 —— 那是直接串号，不是掉线。
    """
    for index, (key, value) in enumerate(headers):
        if key.lower() == b"vary":
            if b"cookie" in value.lower():
                return
            headers[index] = (key, value + b", Cookie")
            return
    headers.append((b"vary", b"Cookie"))


def _refresh_session_cookie(request: Request, message: dict) -> None:
    """★ 会话滑动续期：把本请求带上来的会话 Cookie 原样重签一遍再发回去。

    没有这一步，会话就是「登录后固定 7 天，到点必掉」：Cookie 里的
    itsdangerous 时间戳停在登录那一刻，load_session_cookie 的 max_age 一到就 SignatureExpired。
    而 Flask 现在的行为是**每个响应都重写一次会话 Cookie**
    （SESSION_REFRESH_EACH_REQUEST 默认 True，permanent 会话必重写；
    再加上 REMEMBER_COOKIE_REFRESH_EACH_REQUEST=True 会 set 一个 session["_remember"]
    又立刻 pop 掉，把 session.modified 顶成 True），所以线上只要七天内来过一次就不会掉线。

    少了这段的现象很难往 Cookie 上想：切换当天一切正常，**整整七天后**，
    在切换那天重新登录的那一批人同一时刻集体 401 —— 看起来像「某次发版把大家踢了」。
    """
    if "cookie" not in request.headers:
        return
    data = read_session(request)
    if not data:
        return

    headers = message.get("headers")
    if headers is None:
        headers = []
        message["headers"] = headers

    # 登录/登出自己已经在这次响应里写了会话 Cookie，覆盖它等于把登出写回成登录。
    prefix = f"{SESSION_COOKIE_NAME}=".encode("latin-1")
    for key, value in headers:
        if key.lower() == b"set-cookie" and value.lstrip().startswith(prefix):
            return

    carrier = Response()
    _set_cookie(carrier, SESSION_COOKIE_NAME, dump_session_cookie(data), _session_max_age())
    for key, value in carrier.raw_headers:
        if key.lower() == b"set-cookie":
            headers.append((key, value))
    _merge_vary_cookie(headers)


class AuthContextMiddleware:
    """纯 ASGI 中间件。

    为什么不用 BaseHTTPMiddleware：它把下游跑在另一个 task 里，
    contextvars 的传播方向有坑（写回来不保证）。纯 ASGI 中间件里
    set 的值对下游一定可见，也一定能在同一个 context 里 reset。

    它同时负责会话 Cookie 的滑动续期（见 _refresh_session_cookie）——
    放这里是因为这是唯一一个「每个 HTTP 响应都一定经过、且已经解过会话」的地方，
    等价于 Flask 的 save_session 所在的位置。
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        request = Request(scope, receive=receive)
        await resolve_user(request)

        async def send_wrapper(message):
            # 只在响应头那一帧动手；body 帧原样放行，别影响 SSE / 大文件的流式。
            if message["type"] == "http.response.start":
                try:
                    _refresh_session_cookie(request, message)
                except Exception as exc:
                    # 续期失败顶多让用户七天后重登一次，绝不能因此把整个响应搞挂。
                    print(f"[会话] Cookie 续期失败: {exc}")
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            release_auth_context(request)


# ─────────────────────────── 5. 权限计算 ───────────────────────────


def get_current_user_permissions(user):
    """照搬 app/auth.py:99。

    走的是 lazy 关系（user.departments → dept.permissions），所以 user 必须还挂在
    当前 DB session 上。跨请求缓存 user 对象会在这里抛 DetachedInstanceError，
    然后被 permission_required 吞成 500 —— 别缓存。
    """
    permissions = set()
    for dept in getattr(user, "departments", []):
        for perm in getattr(dept, "permissions", []):
            permissions.add(perm.name)
    return permissions


def current_user_permission_names():
    if not current_user.is_authenticated:
        return set()
    return set(get_current_user_permissions(current_user))


def current_user_has_any_permission(permission_names):
    return bool(current_user_permission_names() & set(permission_names))


# ─────────────────────── 6. 响应契约（字面量都是对前端的承诺）───────────────────────


def _error_response(message, status_code):
    return JSONResponse({"status": "error", "message": message}, status_code=status_code)


def unauthorized_response():
    """契约 1：login_required / permission_required_any 未登录时的唯一出口。"""
    return _error_response(UNAUTHORIZED_MESSAGE, 401)


def _permission_error_response():
    """契约 2 与契约 3 共用同一串字面量（500）。

    「没登录」和「读权限时炸了」在响应体上分不出来 —— 这是现状，不要顺手加区分度，
    前端很可能在按这串文案做匹配。
    """
    return _error_response(PERMISSION_ERROR_MESSAGE, 500)


def permission_denied_response(permission_names):
    """契约 5：permission_required_any 的 403。

    分隔符是「空格 / 空格」、按字母序、冒号是**全角**「：」——
    与 permission_required 的 403（ASCII 冒号）不是同一套文案，别对齐。
    """
    joined = " / ".join(sorted(set(permission_names)))
    return _error_response(f"缺少权限，需要以下任一权限：{joined}", 403)


# ─────────────────────────── 7. 装饰器 ───────────────────────────


def _make_wrapper(func, guard):
    """按被包函数是 async 还是 sync 生成对应的包装。

    必须分两种：FastAPI 用 inspect.iscoroutinefunction 判断要不要丢线程池，
    用 sync 包装去裹 async 视图会让它把协程对象当响应返回（表现为 500 且日志难看）。
    functools.wraps 会带上 __wrapped__，FastAPI 取签名时会穿透到原函数，
    所以依赖注入的参数照常工作。
    """
    if inspect.iscoroutinefunction(func):

        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            denied = guard()
            if denied is not None:
                return denied
            return await func(*args, **kwargs)

        async_wrapper.__xinya_auth_guard__ = guard
        return async_wrapper

    @wraps(func)
    def sync_wrapper(*args, **kwargs):
        denied = guard()
        if denied is not None:
            return denied
        return func(*args, **kwargs)

    # ★ 把 guard 挂在包装函数上，给 backend/main.py 的 422 处理器用。
    #   原因：Flask 里装饰器**先于**请求体解析执行，未登录一律先拿 401；
    #   FastAPI 反过来 —— 请求体校验发生在调用被装饰函数之前，于是
    #   「会话过期 + body 不合法」会得到 422 而不是 401，前端按 401 做的
    #   重新登录跳转就不触发了（用户卡在一个看不懂的报错上）。
    #   422 处理器拿到这个 guard 就能补回「鉴权优先」的顺序。
    #   注意不能用 functools.wraps 传递：wraps 只拷 __dict__ 里已有的键，
    #   而这里是在 wraps 之后才赋值的，不会污染原函数。
    sync_wrapper.__xinya_auth_guard__ = guard
    return sync_wrapper


def _login_guard():
    request = current_request()
    if request is not None and request.method in EXEMPT_METHODS:
        # flask_login 的 EXEMPT_METHODS：CORS 预检不带凭证也要能过。
        # 漏了这条，跨域预检会 401，浏览器侧只报「跨域被拦」，查起来非常痛苦。
        return None
    # ⚠️ core/config.py 目前**没有** login_disabled 这个字段，所以这一行恒为 False，
    # 等于 LOGIN_DISABLED 尚未接通。要真的用起来（压测 / e2e 跳过登录），
    # 必须先去 core/config.py 加 `login_disabled: bool = False`，
    # 那个文件不归本模块改。留 getattr 兜底是为了字段加上之后这里不用再动。
    if getattr(settings, "login_disabled", False):
        return None
    if not current_user.is_authenticated:
        return unauthorized_response()
    return None


def login_required(func):
    """168 处在用。未登录 → 401 + {"status":"error","message":"unauthorized"}。"""
    return _make_wrapper(func, _login_guard)


def permission_required(permission_name):
    """53 处在用。**未登录返回 500，不是 401**（契约 2）——这是现状，必须保留。

    能真正触发 500 分支的只有 6 个没垫 @login_required 的路由
    （camera 3 + public_api 1 + content 2），但契约照抄。
    """

    def decorator(func):
        def guard():
            if not current_user.is_authenticated:
                return _permission_error_response()

            try:
                user_permissions = get_current_user_permissions(current_user)
            except Exception as exc:
                print(f"[权限错误] 读取权限失败: {exc}")
                return _permission_error_response()

            if permission_name not in user_permissions:
                username = current_user.username or "未知用户"
                message = f"用户 {username} 没有权限: {permission_name}"
                print("[权限拒绝]", message)
                return _error_response(message, 403)
            return None

        return _make_wrapper(func, guard)

    return decorator


def permission_required_any(*permission_names):
    """140 处在用。未登录走 401（因为原实现内层套了 @login_required）。

    原实现是 @wraps(func) 在外、@login_required 在内，所以最终函数的 __name__ 是视图名。
    这里保持同样的效果（只包一层，名字仍是视图名）：名字变了会让
    FastAPI 的路由名 / OpenAPI operationId 全部变成 decorated_view。
    """
    required_names = tuple(sorted(set(permission_names)))

    def decorator(func):
        def guard():
            denied = _login_guard()
            if denied is not None:
                return denied
            if not current_user_has_any_permission(required_names):
                return permission_denied_response(required_names)
            return None

        return _make_wrapper(func, guard)

    return decorator


# ─────────────────────── 8. 新代码用的 FastAPI 依赖 ───────────────────────


class AuthError(HTTPException):
    """认证/授权错误。

    带着 payload 走，是为了让响应体仍然是 {"status":"error","message":...}；
    FastAPI 默认的 HTTPException 处理器会包成 {"detail": ...}，形状就变了。
    在 backend/main.py 里注册：app.add_exception_handler(AuthError, auth_error_handler)
    """

    def __init__(self, status_code, message, payload=None):
        super().__init__(status_code=status_code, detail=message)
        self.payload = payload or {"status": "error", "message": message}


async def auth_error_handler(request: Request, exc: AuthError) -> Response:
    return JSONResponse(exc.payload, status_code=exc.status_code)


async def _resolved_user(request: Request):
    """取本请求已经解析好的用户；只有中间件没跑过时才现解析一次。

    ★ 不能只判 `_current_user.get() is None`：匿名用户解析出来就是 None，
    那样写等于「每个匿名请求都被依赖再解析一遍」—— 双倍 DB 往返，
    而且第二次 resolve_user 会覆盖掉 request.state.auth_tokens，
    让中间件在 finally 里 reset 错 token，ContextVar 泄漏一层。
    auth_tokens 存在与否才是「中间件跑没跑过」的可靠信号。
    """
    if getattr(request.state, "auth_tokens", None):
        return _current_user.get()
    return await resolve_user(request)


async def get_current_user(request: Request):
    """新代码用：Depends(get_current_user)。未登录 → 401（与契约 1 同体）。

    老代码继续用全局 current_user 代理，不强制改 —— 341 处的机械改写不划算。
    """
    user = await _resolved_user(request)
    if user is None:
        raise AuthError(401, UNAUTHORIZED_MESSAGE)
    return user


async def get_current_user_optional(request: Request):
    """要「登录了就认，没登录也放行」的接口用这个。"""
    return await _resolved_user(request)


def require_permission(permission_name):
    """新代码用：Depends(require_permission("cctv"))。

    注意它的未登录行为是 **401**（合理的那种），与老的 permission_required 的 500 不同。
    老路由不要改用它 —— 那会悄悄改掉前端看到的状态码。
    """

    async def dependency(request: Request):
        user = await get_current_user(request)
        try:
            user_permissions = get_current_user_permissions(user)
        except Exception as exc:
            print(f"[权限错误] 读取权限失败: {exc}")
            raise AuthError(500, PERMISSION_ERROR_MESSAGE)
        if permission_name not in user_permissions:
            username = getattr(user, "username", None) or "未知用户"
            message = f"用户 {username} 没有权限: {permission_name}"
            print("[权限拒绝]", message)
            raise AuthError(403, message)
        return user

    return dependency


# ─────────────────────── 9. 登录 / 登出时的 Cookie 下发 ───────────────────────


def _session_identifier(request) -> str:
    """flask_login 的 _create_identifier：sha512("<ip>|<UA>")。

    写它只为一件事：万一要回滚到 Flask，旧会话不会被判成 _fresh=False。
    本项目没有任何地方读 _fresh（fresh_login_required 零使用），
    SESSION_PROTECTION 也走默认 basic（只降 _fresh、不登出），所以保护机制本身不实现。
    """
    if request is None:
        return ""
    # ★ 下面这段「先 encode 成 bytes 再塞进 f-string」看着像写错了，但**必须这么写**。
    # flask_login 0.6.3 的 _create_identifier / _get_remote_addr 就是这么干的：
    # 两个值都先 .encode("utf-8") 变成 bytes，再 f"{addr}|{ua}" ——
    # 于是真正参与 sha512 的字符串是 "b'1.2.3.4'|b'Mozilla/5.0...'"（带 b'' 字面量）。
    # 按「正常」写法用 str 拼，算出来的 _id 与线上既有会话里的那个对不上，
    # 回滚到 Flask 时 SESSION_PROTECTION=basic 会判定 _id 不符、把 _fresh 抹成 False，
    # 这一条写进来的唯一理由就是保证回滚不出岔子，写成 str 等于白写。
    address = request.headers.get("x-forwarded-for")
    if address is None:
        client = getattr(request, "client", None)
        address = getattr(client, "host", None)
    if address is not None:
        # XFF 是逗号分隔的链，第一个才是真实客户端；flask_login 在 bytes 上切。
        address = address.encode("utf-8").split(b",")[0].strip()
    user_agent = request.headers.get("user-agent")
    if user_agent is not None:
        user_agent = user_agent.encode("utf-8")
    base = f"{address}|{user_agent}"
    return hashlib.sha512(base.encode("utf-8")).hexdigest()


def build_session_payload(user, *, fresh=True, extra=None) -> dict:
    """拼出与 flask_login 写法一致的会话字典。

    _remember / _remember_seconds 故意不写：那两个键是 flask_login 用来通知自己
    after_request 钩子的瞬态标记，它自己也会 pop 掉。这里 Cookie 直接写，用不上。
    login_version 是业务键，照旧写入 —— 虽然全项目**零处读取**
    （即「改密码不会让 Cookie 会话失效」，只有 Bearer 那条路真的比对了 ver）。
    这是现存的安全缺口，垫片阶段不改行为，已记入待决。
    """
    payload = {
        "_user_id": user.get_id() if hasattr(user, "get_id") else str(user.id),
        "_fresh": bool(fresh),
        "_permanent": True,
        "_id": _session_identifier(current_request()),
        "login_version": getattr(user, "login_version", 0) or 0,
    }
    if extra:
        payload.update(extra)
    return payload


def _set_cookie(response: Response, name: str, value: str, max_age: int) -> None:
    # 生产默认值（见 core/config.py）就是线上现状：Secure + HttpOnly + SameSite=None。
    # SameSite 必须是 None：APK WebView 是 https://localhost → https://utbabuddha.com
    # 的跨站请求，不是 None 浏览器就不带 Cookie。
    # Domain 不设 → host-only。**不要**为了方便设成 .utbabuddha.com：
    # 那会把会话 Cookie 漏给同域名下的其它项目。
    secure, httponly, samesite = _cookie_security()
    response.set_cookie(
        name,
        value,
        max_age=max_age,
        path=_cookie_path(),
        secure=secure,
        httponly=httponly,
        samesite=samesite,
    )


# utbabuddha.com 这一个域名下跑着 6 个项目（BearBad / devops / fahui / kellytools /
# sengchong / xinya），它们全是 Flask + flask_login，Cookie 名字都是框架默认值。
# 也就是说 path=/ 上叫这两个名字的 Cookie **不一定是我们的**。
_SHARED_COOKIE_NAMES = frozenset({"session", "remember_token"})


def _delete_legacy_path_cookies(response: Response) -> None:
    """把老的 path=/ 同名 Cookie 删掉。

    改 Path 不会覆盖旧 Cookie：浏览器会同时持有 path=/ 和 path=/UTBA_DEMO 两份，
    并在同一个 Cookie 头里一起发上来；logout 时只删得掉新 path 那份，
    旧的永远留着 —— 表现就是「登出了又自动登回去」。
    所以每次下发/清除登录态时，都顺手对 path=/ 发一条删除。

    ★ 但只能删**项目专属**的名字。删 Cookie 靠的是 name+path，分不出「这份是
    迁移前的 xinya 留下的」还是「这份是 BearBad 现在正在用的」——
    名字还是 session / remember_token 时删下去，等于每次登录登出都把用户从
    另外 5 个项目踢下线，而那边日志上什么都看不到。
    所以想清掉旧 path 的残留，前提是先在 system_config.env 把名字改成专属的
    （现在 SESSION_COOKIE_NAME=xinya_session，所以会话那份是删得掉的）。
    跳过 remember_token 的代价是零：登出时会话里写了 _remember="clear"，
    load_user_from_request 会认这个标记，旧 remember_token 登不回来。
    """
    if _cookie_path() == "/":
        return
    secure, httponly, samesite = _cookie_security()
    for name in (SESSION_COOKIE_NAME, REMEMBER_COOKIE_NAME):
        if name in _SHARED_COOKIE_NAMES:
            continue
        response.delete_cookie(
            name, path="/", secure=secure, httponly=httponly, samesite=samesite
        )


def set_login_cookies(response: Response, user, *, remember=True, duration=None, extra_session=None):
    """登录成功后下发 Cookie（替掉 login_user）。

    对应现状：session.permanent = True → login_user(user, remember=True, duration=7天)
    → session["login_version"] = user.login_version。
    """
    max_age = _session_max_age()
    _set_cookie(response, SESSION_COOKIE_NAME, dump_session_cookie(
        build_session_payload(user, extra=extra_session)
    ), max_age)

    if remember:
        # duration 为空时走 REMEMBER_COOKIE_DAYS，不是会话那条 ——
        # 两个键分开配才有意义（见 _remember_max_age）。
        remember_age = (
            int(duration.total_seconds())
            if isinstance(duration, timedelta)
            else _remember_max_age()
        )
        _set_cookie(response, REMEMBER_COOKIE_NAME, build_remember_token(user.get_id()), remember_age)

    _delete_legacy_path_cookies(response)
    # 同一个请求里后续代码也能读到 current_user。注意 sync 视图跑在线程池里，
    # 这个 set 只在本次调用的 context 拷贝里生效 —— 正好够用，也不会污染别的请求。
    set_current_user(user)
    return response


def clear_login_cookies(response: Response):
    """登出（替掉 logout_user）。

    会话 Cookie 不是简单删掉，而是写一个带 _remember="clear" 的空会话：
    这样即使浏览器因为 Path/Domain 的历史遗留没删掉 remember_token，
    也不会被它自动登回去（load_user_from_request 会尊重这个标记）。
    """
    _set_cookie(
        response,
        SESSION_COOKIE_NAME,
        dump_session_cookie({"_remember": "clear", "_permanent": True}),
        _session_max_age(),
    )
    secure, httponly, samesite = _cookie_security()
    response.delete_cookie(
        REMEMBER_COOKIE_NAME,
        path=_cookie_path(),
        secure=secure,
        httponly=httponly,
        samesite=samesite,
    )
    _delete_legacy_path_cookies(response)
    set_current_user(None)
    return response
