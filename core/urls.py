"""对外 URL 的唯一拼装口。

设计见 docs/flask_to_fastAPI/11-BASE_PATH.md §3–4。

为什么非要有这个模块 ——

`app/web.py` 现在的 ``_absolute_url()`` 是 ``request.url_root + path``，它成立的前提是
**应用住在域名根目录**。BASE_PATH 改造后这个前提没了：nginx 用
``location /UTBA_DEMO/ { proxy_pass http://127.0.0.1:5102/; }``（末尾斜杠）把前缀
**剥掉**再转进来，应用自己看到的 path 里压根没有 ``/UTBA_DEMO``。于是 url_root 拼出来的是
``https://utbabuddha.com/event/12`` —— 少了一段前缀，分享卡片点进去、二维码扫出来全是 404。
更隐蔽的是它还会在没配 ``proxy_set_header Host`` 的 location 上拼出 ``127.0.0.1:5102``。

FastAPI 阶段连 ``url_root`` 都没有：``root_path`` 只影响 ``request.url_for()``，
``RedirectResponse("/foo")`` 里的裸路径依旧是裸路径，照样掉前缀。

所以规矩是：**应用内部一律只写裸路径**（``/event/12``），凡是要交到外面去的 URL
（重定向、二维码、分享链接、OG 图、邮件短信里的链接）一律过一遍这里。

★ 没有请求上下文时也必须能用：ffmpeg 转码线程、paiwei_job 线程、
  ``python -m app.xxx_worker`` 子进程都要拼分享链接，它们碰不到 request。
  此时回落到 ``settings.app_base_path`` / ``settings.app_public_origin`` ——
  也就是说跑后台任务的环境里 ``APP_PUBLIC_ORIGIN`` 是**必填**的，
  不填 ``absolute_url()`` 只能退化成相对路径（会打一条 warning）。
"""

from __future__ import annotations

import logging
import re

from core.config import settings

log = logging.getLogger("core.urls")

__all__ = ["base_path", "public_url", "absolute_url"]

# 只认 http / https 开头的完整地址，与 app/web.py 现有的判断保持一致。
# 故意不认 ``//example.com`` 这种协议相对写法 —— 放行它等于放行开放重定向。
_HTTP_ABSOLUTE = re.compile(r"^https?://", re.IGNORECASE)

# 合法前缀 = 一段或多段 ASCII 路径。见 base_path() 里关于「这个头不可信」的说明。
_SAFE_PREFIX = re.compile(r"^/[A-Za-z0-9._~%-]+(?:/[A-Za-z0-9._~%-]+)*$")
_MAX_PREFIX_LENGTH = 64

# 缺 APP_PUBLIC_ORIGIN 的 warning 每进程只打一次：这条路径可能在循环里被调到上千次
# （比如给一百张相册图逐张拼分享链接），每次都打日志会把 journal 刷爆。
_warned_missing_origin = False


def _current_request():
    """当前请求对象；后台线程 / worker 子进程 / CLI 里返回 None。

    延迟 import core.auth 有两个理由：① ContextVar 是认证中间件写进去的，
    而 auth 将来很可能反过来要拼 URL（登录跳转、邮件里的重置链接），
    写在函数里就不会在 core 内部形成 import 环；
    ② 让这个模块在还没接中间件的脚本、单测里也能 import 成功。
    """
    try:
        from core.auth import current_request
    except Exception:  # pragma: no cover - 认证垫片不可用时照样退回 settings
        return None
    try:
        return current_request()
    except Exception:
        return None


def _normalize_prefix(raw):
    """把外部来的前缀收敛成 "" 或 "/UTBA_DEMO"（有前导斜杠、无尾随斜杠）。

    不合格就返回 ""（当作没这个头），不抛异常 —— 一个畸形的头不该让整个请求 500。
    """
    text = str(raw or "").strip().rstrip("/")
    if not text or text == "/":
        return ""
    if not text.startswith("/"):
        text = "/" + text
    if len(text) > _MAX_PREFIX_LENGTH or not _SAFE_PREFIX.match(text):
        log.warning("忽略非法的 X-Forwarded-Prefix（长度或字符不合法）")
        return ""
    # 点段要单独挡：_SAFE_PREFIX 允许 "." 出现在段里（合法前缀可能叫 v1.2），
    # 但 "." / ".." 作为**整段**就是路径穿越，会拼出 /../../etc/... 这种链接。
    # 实测发现：只靠上面那条正则，/../../etc 能通过。
    if any(seg in (".", "..") for seg in text.split("/")):
        log.warning("忽略含点段（. 或 ..）的 X-Forwarded-Prefix：疑似路径穿越")
        return ""
    return text


def base_path(request=None) -> str:
    """本项目挂在域名下的哪一段，形如 ``""`` 或 ``"/UTBA_DEMO"``。

    优先级：请求头 ``X-Forwarded-Prefix`` > ``settings.app_base_path``。
    头优先的理由：同一份代码可能被两条 nginx location 同时代理（灰度 /UTBA_DEMO 与
    生产的另一个前缀），谁转进来就按谁的前缀回链接，否则灰度用户复制出去的链接会指向生产。

    ⚠️ **这个头不一定可信。** nginx 的 ``proxy_set_header`` 会盖掉客户端同名头，
    但直连端口（开发机、内网、漏配 proxy_set_header 的 location）时它就是客户端说了算。
    被塞进 ``//evil.com`` 这类值，分享链接就变成了开放重定向。所以这里只接受
    「斜杠分段的 ASCII 路径」，不合格一律当没有（见 _normalize_prefix）。

    （FastAPI 的 ``request.scope["root_path"]`` 是等价信息源，但它本来就由
    ``settings.app_base_path`` 喂进去，再读一遍没有新信息，故不参与优先级。）
    """
    req = request if request is not None else _current_request()
    raw = ""
    if req is not None:
        try:
            # Starlette / Flask 的 headers 都是大小写不敏感的，写小写即可。
            raw = req.headers.get("x-forwarded-prefix") or ""
        except Exception:
            raw = ""
    return _normalize_prefix(raw) or (settings.app_base_path or "")


def public_url(path, request=None) -> str:
    """应用内部路径 → 对外可点的路径（带项目前缀，不带域名）。

    模板里的 href / src、``redirect()`` 的目标、下发给前端的资源地址都走这个。

    空输入返回 ``""`` —— 沿用 ``app/web.py._absolute_url`` 的既有行为。模板里普遍写
    ``{% if url %}`` 判空，这里若改成返回 ``"/"``，空头像会变成一个指向首页的链接。
    """
    text = str(path or "").strip()
    if not text:
        return ""
    if _HTTP_ABSOLUTE.match(text):
        # 已经是完整地址（外链、对象存储直链），原样放行。
        return text
    if not text.startswith("/"):
        text = "/" + text

    prefix = base_path(request)
    if not prefix:
        return text
    # 幂等：调用点是分批迁移的，难免有人把「已经带前缀」的地址又传进来一次。
    # 拼成 /UTBA_DEMO/UTBA_DEMO/... 的表现是 404，而且肉眼很难一下看出来。
    # ⚠️ 代价：当项目前缀恰好与应用内部第一段路由同名时，这里会少拼一层。
    #    本项目前缀是 /UTBA_DEMO，内部没有同名路由，安全；
    #    以后定生产前缀（09 D10）时必须避开内部第一段路由名。
    if text == prefix or text.startswith(prefix + "/"):
        return text
    return prefix + text


def _origin_from_request(req) -> str:
    """从请求推断 ``scheme://host``；推不出来返回 ""。

    scheme 优先取 ``X-Forwarded-Proto``：uvicorn 在 nginx 后面看到的是 http，
    直接用 ``request.url.scheme`` 会在 https 页面里插进 http 链接，被浏览器当混合内容拦掉。
    转发头可能是 ``https,http`` 这种逗号串（多层代理各追加一段），取第一段。
    """
    if req is None:
        return ""
    try:
        headers = req.headers
        scheme = (headers.get("x-forwarded-proto") or "").split(",")[0].strip()
        host = (headers.get("x-forwarded-host") or headers.get("host") or "").split(",")[0].strip()
        url = getattr(req, "url", None)
        if not scheme:
            scheme = getattr(url, "scheme", "") or "http"
        if not host:
            host = getattr(url, "netloc", "")
        if not host:
            return ""
        return f"{scheme}://{host}"
    except Exception:
        return ""


def absolute_url(path, request=None) -> str:
    """带域名的完整 URL：二维码、分享卡片的 canonical / og:url、邮件短信里的链接。

    origin 取值顺序：``settings.app_public_origin`` > 当次请求推断。
    配置优先而不是请求优先，是因为 **Host 头是客户端可伪造的**：
    攻击者拿自己的 Host 打一个「生成分享链接」的接口，就能让我们生成指向他域名的链接，
    再把它发给用户（钓鱼）。写死在配置里的 origin 没有这个问题。
    """
    text = str(path or "").strip()
    if not text:
        return ""
    if _HTTP_ABSOLUTE.match(text):
        return text

    req = request if request is not None else _current_request()
    origin = (settings.app_public_origin or "").strip().rstrip("/") or _origin_from_request(req)
    relative = public_url(text, req)
    if not origin:
        global _warned_missing_origin
        if not _warned_missing_origin:
            _warned_missing_origin = True
            log.warning(
                "拿不到 origin（无请求上下文且 APP_PUBLIC_ORIGIN 未配置），"
                "absolute_url() 退化成相对路径。后台任务生成的分享链接会缺域名。"
            )
        return relative
    return origin + relative
